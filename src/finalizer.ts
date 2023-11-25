import { Logger } from '@eth-optimism/common-ts'
import { CrossChainMessenger, MessageStatus } from '@eth-optimism/sdk'
import Queue from './queue'
import { Multicaller, CallWithMeta } from './multicaller'
import { L2toL1Message } from './finalize_worker'

export default class Finalizer {
  public highestFinalizedL2: number

  private queue: Queue<L2toL1Message>
  private logger: Logger
  private messenger: CrossChainMessenger
  private multicaller: Multicaller
  private pollingInterval: number
  private interval: NodeJS.Timeout | undefined

  constructor(
    logger: Logger,
    pollingInterval: number,
    messenger: CrossChainMessenger,
    multicaller: Multicaller
  ) {
    this.queue = new Queue<L2toL1Message>(1024)
    this.logger = logger
    this.pollingInterval = pollingInterval
    this.messenger = messenger
    this.multicaller = multicaller
  }

  public async start(): Promise<void> {
    this.interval = setInterval(async () => {
      let calldatas: CallWithMeta[] = []
      const target = this.messenger.contracts.l1.OptimismPortal.target

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
        calldatas.push({
          target,
          callData,
          blockHeight: head.blockHeight,
          txHash,
          message: head.message,
          err: null,
        })

        // evict the head from queue
        this.queue.shift()

        // go next when lower than multicall target gas
        if (!this.multicaller?.isOvertargetGas(calldatas.length)) {
          continue
        }

        // send multicall
        this.handleMulticallResult(
          calldatas,
          await this.multicaller?.multicall(calldatas, null)
        )
      }

      // flush the left calldata
      if (0 < calldatas.length)
        this.handleMulticallResult(
          calldatas,
          await this.multicaller?.multicall(calldatas, null)
        )
    }, this.pollingInterval)
  }

  protected handleMulticallResult(
    calleds: CallWithMeta[],
    faileds: CallWithMeta[]
  ): void {
    const failedIds = new Set(faileds.map((failed) => failed.txHash))
    const succeeds = calleds.filter((call) => !failedIds.has(call.txHash))

    this.updateHighest(succeeds)

    // record log the failed list with each error message
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
    this.queue.push(...messages)
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
