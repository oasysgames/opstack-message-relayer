import { Logger } from '@eth-optimism/common-ts'
import { CrossChainMessenger, MessageStatus } from '@eth-optimism/sdk'
import FixedSizeQueue from './queue'
import { Multicaller, CallWithMeta } from './multicaller'
import { L2toL1Message } from './finalize_worker'

export default class Finalizer {
  public highestFinalizedL2: number = 0
  public interval: NodeJS.Timeout | undefined
  public queue: FixedSizeQueue<L2toL1Message>

  private logger: Logger
  private messenger: CrossChainMessenger
  public multicaller: Multicaller
  private pollingInterval: number

  constructor(
    queueSize: number,
    logger: Logger,
    pollingInterval: number,
    messenger: CrossChainMessenger,
    multicaller: Multicaller
  ) {
    this.queue = new FixedSizeQueue<L2toL1Message>(queueSize)
    this.logger = logger
    this.pollingInterval = pollingInterval
    this.messenger = messenger
    this.multicaller = multicaller
  }

  public async start(): Promise<void> {
    this.interval = setInterval(async () => {
      let calldatas: CallWithMeta[] = []
      const target = this.messenger.contracts.l1.OptimismPortal.target

      // traverse the queue
      while (this.queue.count !== 0) {
        const head = this.queue.peek()
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

        // already finalized
        if (MessageStatus.READY_FOR_RELAY < status) {
          this.queue.dequeue() // evict the head from queue
          this.logger.debug(
            `[finalizer] message ${head.message} is already relayed, txhash: ${txHash}, blockHeight: ${head.blockHeight}`
          )
          continue
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
        calldatas.push({
          target,
          callData,
          blockHeight: head.blockHeight,
          txHash,
          message: head.message,
          err: null,
        })

        this.queue.dequeue() // evict the head from queue

        // go next when lower than multicall target gas
        if (!this.multicaller?.isOvertargetGas(calldatas.length)) {
          continue
        }

        // multicall, and handle the result
        this.handleMulticallResult(
          calldatas,
          await this.multicaller?.multicall(calldatas, null)
        )

        // reset calldata list
        calldatas = []
      }
    }, this.pollingInterval)
  }

  protected handleMulticallResult(
    calleds: CallWithMeta[],
    faileds: CallWithMeta[]
  ): void {
    const failedIds = new Set(faileds.map((failed) => failed.txHash))
    const succeeds = calleds.filter((call) => !failedIds.has(call.txHash))

    this.updateHighest(succeeds)

    // log the failed list with each error message
    for (const fail of faileds) {
      this.logger.warn(
        `[finalizer] failed to prove: ${fail.txHash}, err: ${fail.err.message}`
      )
    }
  }

  public stop(): void {
    this.logger.debug(`[finalizer] stopping...`)
    clearInterval(this.interval)
    this.logger.debug(`[finalizer] stopped`)
  }

  public appendMessage(...messages: L2toL1Message[]): void {
    if (this.queue.size < this.queue.count + messages.length) {
      throw new Error(
        `will exceed queue size, please increase queue size (current: ${this.queue.size})`
      )
    }
    this.queue.enqueue(...messages)
    this.logger.debug(
      `[finalizer] received txhashes: ${messages.map((m) => m.txHash)}`
    )
  }

  protected updateHighest(calldatas: CallWithMeta[]): boolean {
    // assume the last element is the hightst, so doen't traverse all the element
    let highest = calldatas[calldatas.length - 1].blockHeight
    if (0 < highest) highest -= 1 // subtract `1` to assure the all transaction in block is finalized
    if (highest <= this.highestFinalizedL2) return false

    this.highestFinalizedL2 = highest
    this.logger.info(`[finalizer] updated highest finalized L2: ${highest}`)
    return true
  }
}
