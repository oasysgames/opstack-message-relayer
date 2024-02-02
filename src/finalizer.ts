import { Logger } from '@eth-optimism/common-ts'
import { CrossChainMessenger, MessageStatus } from '@eth-optimism/sdk'
import DynamicSizeQueue from './queue-storage'
import FixedSizeQueue from './queue-mem'
import { Portal, WithdrawMsgWithMeta } from './portal'
import { L2toL1Message } from './finalize_worker'

export default class Finalizer {
  public highestFinalizedL2: number = 0
  public queue: DynamicSizeQueue<L2toL1Message> | FixedSizeQueue<L2toL1Message>

  public stopping: boolean = false
  public stopped: boolean = false

  private pollingInterval: number
  private logger: Logger
  private messenger: CrossChainMessenger
  public portal: Portal

  constructor(
    queuePath: string,
    pollingInterval: number,
    logger: Logger,
    messenger: CrossChainMessenger,
    portal: Portal
  ) {
    if (queuePath !== '') {
      this.queue = new DynamicSizeQueue<L2toL1Message>(queuePath)
    } else {
      this.queue = new FixedSizeQueue<L2toL1Message>(1024)
    }
    this.pollingInterval = pollingInterval
    this.logger = logger
    this.messenger = messenger
    this.portal = portal
  }

  public async start(): Promise<void> {
    const itr = async () => {
      if (this.stopping) {
        this.stopped = true
        return
      }

      let withdraws: WithdrawMsgWithMeta[] = []

      // traverse the queue
      while (this.queue.count !== 0) {
        const head = this.queue.peek()
        const txHash = head.txHash
        const message = head.message
        const status = await this.messenger.getMessageStatus(message)

        // still in challenge period
        if (status < MessageStatus.READY_FOR_RELAY) {
          // the head in queue is the oldest message, so we assume the rest of the queue is also in challenge period
          this.logger.debug(
            `[finalizer] message ${message} is still in challenge period, txhash: ${txHash}, blockHeight: ${head.blockHeight}`
          )
          break
        }

        // already finalized
        if (MessageStatus.READY_FOR_RELAY < status) {
          this.queue.dequeue() // evict the head from queue
          this.logger.debug(
            `[finalizer] message ${message} is already relayed, txhash: ${txHash}, blockHeight: ${head.blockHeight}`
          )
          continue
        }

        const withdraw = {
          ...(await this.messenger.toLowLevelMessage(message)),
          blockHeight: head.blockHeight,
          txHash,
          err: null,
        }

        withdraws.push(withdraw) // append to list
        this.queue.dequeue() // evict the head from queue

        // Estimate gas cost for the future forecasting the finalize gas cost
        // Compute per withdraw gas by substracting double withdraw gas from single withdraw gas
        if (this.portal?.perWithdrawGas === 0) {
          const estimatedGas =
            await this.portal.contract.estimateGas.finalizeWithdrawalTransactions(
              this.portal.convertToCall(withdraws)
            )
          this.portal.setGasFieldsToEstimate(estimatedGas.toNumber())
        }

        // go next when lower than multicall target gas and if not stopping
        if (!this.portal?.isOverTargetGas(withdraws.length) && !this.stopping) {
          continue
        }

        // multicall, and handle the result
        this.handleMulticallResult(
          withdraws,
          await this.portal?.finalizeWithdrawals(withdraws, null)
        )

        // reset calldata list
        withdraws = []
      }

      // flush the rest of withdraws
      if (0 < withdraws.length) {
        this.handleMulticallResult(
          withdraws,
          await this.portal?.finalizeWithdrawals(withdraws, null)
        )
      }

      // recursive call
      setTimeout(itr, this.pollingInterval)
    }

    // first call
    itr()
  }

  protected handleMulticallResult(
    calleds: WithdrawMsgWithMeta[],
    faileds: WithdrawMsgWithMeta[]
  ): void {
    const failedIds = new Set(faileds.map((failed) => failed.txHash))
    const succeeds = calleds.filter((call) => !failedIds.has(call.txHash))

    if (0 < succeeds.length) {
      this.logger.info(
        `[finalizer] succeeded(${succeeds.length}) txHash: ${succeeds.map(
          (call) => call.txHash
        )}`
      )
      // update the highest finalized L2
      this.updateHighestFinalized(succeeds)
    }

    // log the failed list with each error message
    for (const fail of faileds) {
      this.logger.warn(
        `[finalizer] failed to prove: ${fail.txHash}, err: ${fail.err.message}`
      )
    }
  }

  public async stop(): Promise<void> {
    this.logger.debug(`[finalizer] stopping...`)
    this.stopping = true
    const waitForStopped = async () => {
      while (!this.stopped) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
    await waitForStopped()
    this.logger.debug(`[finalizer] stopped`)
  }

  public appendMessage(...messages: L2toL1Message[]): void {
    // comment in if the queue is fixed size
    // if (this.queue.size < this.queue.count + messages.length) {
    //   throw new Error(
    //     `will exceed queue size, please increase queue size (current: ${this.queue.size})`
    //   )
    // }
    this.queue.enqueue(...messages)
    this.logger.debug(
      `[finalizer] received txhashes: ${messages.map((m) => m.txHash)}`
    )
  }

  protected updateHighestFinalized(withdraws: WithdrawMsgWithMeta[]): boolean {
    // assume the last element is the hightst, so doen't traverse all the element
    let highest = withdraws[withdraws.length - 1].blockHeight
    if (0 < highest) highest -= 1 // subtract `1` to assure the all transaction in block is finalized
    if (highest <= this.highestFinalizedL2) return false

    this.highestFinalizedL2 = highest
    this.logger.info(`[finalizer] updated highest finalized L2: ${highest}`)
    return true
  }
}
