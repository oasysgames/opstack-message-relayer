import { parentPort, workerData } from 'worker_threads'
import { Logger } from '@eth-optimism/common-ts'
import { CrossChainMessenger, MessageStatus } from '@eth-optimism/sdk'
import Queue from './queue'
import { Multicaller, CallWithHeight } from './multicaller'

export type L2toL1Message = {
  message: string
  txHash: string
  blockHeight: number
}

export type FinalizerMessage = {
  highestFinalizedL2: number
}

export class Finalizer {
  public highestFinalizedL2: number

  private port: any
  private queue: Queue<L2toL1Message>
  private logger: Logger
  private messenger: CrossChainMessenger
  private multicaller: Multicaller
  private pollingInterval: number
  private interval: NodeJS.Timeout | undefined

  constructor(
    port: any,
    logger: Logger,
    pollingInterval: number,
    messenger: CrossChainMessenger,
    multicaller: Multicaller
  ) {
    this.port = port
    this.queue = new Queue<L2toL1Message>(1024)
    this.logger = logger
    this.pollingInterval = pollingInterval
    this.messenger = messenger
    this.multicaller = multicaller
  }

  public async start(): Promise<void> {
    this.interval = setInterval(async () => {
      let calldatas: CallWithHeight[] = []
      const target = this.messenger.contracts.l1.OptimismPortal.target

      const updateHeightCallback = (hash: string, calls: CallWithHeight[]) => {
        this.logger.info(`[finalizer] relayer sent multicall: ${hash}`)
        if (this.updateHighest(calls)) {
          this.port.postMessage({
            highestFinalizedL2: this.highestFinalizedL2,
          } as FinalizerMessage)
        }
      }

      while (this.queue.getSize() !== 0) {
        const head = this.queue.head()
        const txHash = head.txHash
        const status = await this.messenger.getMessageStatus(head.message)

        // still in challenge period
        if (status < MessageStatus.READY_FOR_RELAY) {
          // the head in queue is the oldest message, so we assume the rest of the queue is also in challenge period
          this.logger.debug(
            `[finalizer] message ${head.message} is still in challenge period, txhash: ${txHash}, blockHeight: ${head.blockHeight}`
          )
          break
        }

        // Estimate gas cost for proveMessage
        if (this.multicaller?.singleCallGas === 0) {
          const estimatedGas = (
            await this.messenger.estimateGas.finalizeMessage(txHash)
          ).toNumber()
          this.multicaller.singleCallGas = estimatedGas
        }

        // Populate calldata, the append to the list
        const callData = (
          await this.messenger.populateTransaction.finalizeMessage(txHash)
        ).data
        calldatas.push({ target, callData, blockHeight: head.blockHeight })

        // evict the head from queue
        this.queue.shift()

        // go next when lower than multicall target gas
        if (!this.multicaller?.isOvertargetGas(calldatas.length)) {
          continue
        }

        // send multicall
        // return the remaining callcatas, those are failed due to gas limit
        calldatas = await this.multicaller?.multicall(
          calldatas,
          updateHeightCallback
        )
      }

      // flush the left calldata
      if (0 < calldatas.length)
        await this.multicaller?.multicall(calldatas, updateHeightCallback)
    }, this.pollingInterval)
  }

  public stop(): void {
    this.logger.debug(`[finalizer] stopping...`)
    clearInterval(this.interval)
    this.logger.debug(`[finalizer] stopped`)
  }

  public appendMessage(message: L2toL1Message): void {
    this.queue.push(message)
    this.logger.debug(`[finalizer] received txhash: ${message.txHash}`)
  }

  protected updateHighest(calldatas: CallWithHeight[]): boolean {
    // assume the last element is the hightst, so doen't traverse all the element
    let highest = calldatas[calldatas.length - 1].blockHeight
    if (0 < highest) highest -= 1 // subtract `1` to assure the all transaction in block is finalized
    if (highest <= this.highestFinalizedL2) return false

    this.highestFinalizedL2 = highest
    this.logger.info(`[finalizer] updated highest finalized L2: ${highest}`)
    return true
  }
}

interface InitData {
  logger: Logger
  pollingInterval: number
  messenger: CrossChainMessenger
  multicaller: Multicaller
}

const { logger, pollingInterval, messenger, multicaller } =
  workerData as InitData
const finalizer = new Finalizer(
  parentPort,
  logger,
  pollingInterval,
  messenger,
  multicaller
)

// Start finalizer
finalizer.start()

// Receive the proven txhash
parentPort?.on('message', (message: L2toL1Message) => {
  finalizer.appendMessage(message)
})

// Stop finalizer
parentPort.on('close', () => {
  finalizer.stop()
})
