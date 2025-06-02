import { Logger } from '@eth-optimism/common-ts'
import {
  CrossChainMessenger,
  MessageStatus,
  LowLevelMessage,
  hashLowLevelMessage,
} from '@eth-optimism/sdk'
import { Contract } from 'ethers'
import DynamicSizeQueue from './queue-storage'
import { Portal, WithdrawMsgWithMeta } from './portal'
import { L2toL1Message } from './finalize_worker'
import { FinalizerMessage } from './finalize_worker'
import { TransactionManager, ManagingTx } from './transaction-manager'

export default class Finalizer {
  public highestFinalizedL2: number = 0
  public queue: DynamicSizeQueue<L2toL1Message>
  public portal: Portal
  public running: boolean

  private outputOracle: Contract
  private pollingTimeout: NodeJS.Timeout
  private loopIntervalMs: number
  private logger: Logger
  private messenger: CrossChainMessenger
  private finalizedNotifyer: (msg: FinalizerMessage) => void
  private txmgr: TransactionManager | undefined

  constructor(
    queuePath: string,
    loopIntervalMs: number,
    logger: Logger,
    messenger: CrossChainMessenger,
    outputOracle: Contract,
    portal: Portal,
    txmgr: TransactionManager | undefined,
    notifyer: (msg: FinalizerMessage) => void
  ) {
    logger.info(`[finalizer] queuePath: ${queuePath}`)
    this.queue = new DynamicSizeQueue<L2toL1Message>(queuePath)
    this.loopIntervalMs = loopIntervalMs
    this.logger = logger
    this.messenger = messenger
    this.outputOracle = outputOracle
    this.portal = portal
    this.finalizedNotifyer = notifyer

    if (txmgr) {
      this.txmgr = txmgr

      // setup the subscriber to handle the result of the multicall
      const subscriber = (txs: ManagingTx[]) => {
        const calleds: WithdrawMsgWithMeta[] = []
        const faileds: WithdrawMsgWithMeta[] = []
        for (const tx of txs) {
          const calls = tx.meta as WithdrawMsgWithMeta[]
          calleds.push(...calls)
          if (tx.err !== undefined) {
            faileds.push(...calls.map((call) => ({ ...call, err: tx.err })))
          }
        }
        this.handleMulticallResult(calleds, faileds)
      }
      this.txmgr.addSubscriber(subscriber)
    }
  }

  public async start(): Promise<void> {
    this.logger.info(
      `[finalizer] starting..., loopIntervalMs: ${this.loopIntervalMs}ms`
    )

    const itr = async () => {
      let withdraws: WithdrawMsgWithMeta[] = []

      // iterate over entire queue
      const messages = this.queue.peekAll()
      for (const head of messages) {
        const txHash = head.txHash
        const message = head.message
        const status = await this.messenger.getMessageStatus(message)
        let lowLevelMessage: LowLevelMessage

        if (MessageStatus.READY_FOR_RELAY > status) {
          // still in challenge period
          lowLevelMessage = await this.messenger.toLowLevelMessage(message)

          if (await this.isInstantVerified(lowLevelMessage)) {
            // instant verified, so proceed with finalize
            // As important to note, the finalizer key should be same as the messageRelayer key of OasysPortal
            // Otherwise, the finalize will fail
          } else {
            // the head in queue is the oldest message, so we assume the rest of the queue is also in challenge period
            this.logger.info(
              `[finalizer] message is still in challenge period, txhash: ${txHash}, blockHeight: ${head.blockHeight}, status: ${status}`
            )
            break
          }
        } else if (MessageStatus.READY_FOR_RELAY === status) {
          // ready for finalize
          lowLevelMessage = await this.messenger.toLowLevelMessage(message)
        } else if (MessageStatus.READY_FOR_RELAY < status) {
          // already finalized
          this.logger.debug(
            `[finalizer] message ${message} is already relayed, txhash: ${txHash}, blockHeight: ${head.blockHeight}`
          )
          this.queue.evict(head) // evict the head from queue
          continue
        }

        // append to list
        const withdraw = {
          ...lowLevelMessage,
          l2toL1Msg: head,
          err: null,
        }
        withdraws.push(withdraw)

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
        if (!this.portal?.isOverTargetGas(withdraws.length) && this.running) {
          continue
        }

        // multicall
        const faileds = await this.portal?.finalizeWithdrawals(withdraws)
        // handle the result
        if (!this.txmgr) this.handleMulticallResult(withdraws, faileds)

        // reset calldata list
        withdraws = []
      }

      // flush the rest of withdraws
      if (0 < withdraws.length) {
        const faileds = await this.portal?.finalizeWithdrawals(withdraws)
        if (!this.txmgr) this.handleMulticallResult(withdraws, faileds)
      }

      // recursive call
      if (this.running) {
        this.pollingTimeout = setTimeout(itr, this.loopIntervalMs)
      }
    }

    // first call
    this.running = true
    try {
      await itr()
    } catch (err) {
      this.logger.error(
        `[finalizer] error occurred during finalization: ${err.message}`
      )
      throw err
    }
  }

  protected handleMulticallResult(
    calleds: WithdrawMsgWithMeta[],
    faileds: WithdrawMsgWithMeta[]
  ): void {
    // evict the processed messages, then enqueue the failed messages
    this.queue.evict(...calleds.map((call) => call.l2toL1Msg))
    this.queue.enqueue(...faileds.map((call) => call.l2toL1Msg))

    const failedIds = new Set(faileds.map((failed) => failed.l2toL1Msg.txHash))
    const succeeds = calleds.filter(
      (call) => !failedIds.has(call.l2toL1Msg.txHash)
    )
    if (0 < succeeds.length) {
      this.logger.info(
        `[finalizer] succeeded(${succeeds.length}) txHash: ${succeeds.map(
          (call) => call.l2toL1Msg.txHash
        )}`
      )
      // update the highest finalized L2
      if (this.updateHighestFinalized(succeeds)) {
        // notify the highest finalized L2 along with
        // the number of finalized transactions to the parent thread
        this.finalizedNotifyer({
          highestFinalizedL2: this.highestFinalizedL2,
          finalizedTxs: succeeds.length,
        })
      }
    }

    // log the failed list
    if (0 < faileds.length) {
      this.logger.warn(
        `[finalizer] failed(${faileds.length}), txHashes: ${faileds.map(
          (fail) => fail.l2toL1Msg.txHash
        )}, errs: ${faileds.map((fail) => fail.err.message).join(', ')}`
      )
    }
  }

  public async stop(): Promise<void> {
    this.logger.info(`[finalizer] stopping...`)
    this.running = false
    clearTimeout(this.pollingTimeout)
  }

  public appendMessage(...messages: L2toL1Message[]): void {
    // comment in if the queue is fixed size
    // if (this.queue.size < this.queue.count + messages.length) {
    //   throw new Error(
    //     `will exceed queue size, please increase queue size (current: ${this.queue.size})`
    //   )
    // }
    this.queue.enqueueNoDuplicate(...messages)
    this.logger.debug(
      `[finalizer] received txhashes: ${messages.map((m) => m.txHash)}`
    )
  }

  private async isInstantVerified(message: LowLevelMessage): Promise<boolean> {
    const provenWithdrawal =
      await this.messenger.contracts.l1.OptimismPortal.provenWithdrawals(
        hashLowLevelMessage(message)
      )
    const provenTimestamp = provenWithdrawal.timestamp.toNumber()
    const verifiedTimestamp = (
      await this.outputOracle.verifiedL1Timestamp()
    ).toNumber()
    // About instant verify logic, refer to here
    // https://github.com/oasysgames/oasys-opstack/blob/c95f16aa27b5400831a3e1b01c05911ea63a256c/packages/contracts-bedrock/src/oasys/L1/messaging/OasysPortal.sol#L68
    return provenTimestamp < verifiedTimestamp
  }

  protected updateHighestFinalized(withdraws: WithdrawMsgWithMeta[]): boolean {
    let highest = withdraws.reduce((maxCall, currentCall) => {
      if (
        !maxCall ||
        currentCall.l2toL1Msg.blockHeight > maxCall.l2toL1Msg.blockHeight
      ) {
        return currentCall
      }
      return maxCall
    }).l2toL1Msg.blockHeight
    if (0 < highest) highest -= 1 // subtract `1` to assure the all transaction in block is finalized
    if (highest <= this.highestFinalizedL2) return false

    this.highestFinalizedL2 = highest
    this.logger.info(`[finalizer] updated highest finalized L2: ${highest}`)
    return true
  }
}
