import { Logger, StandardMetrics } from '@eth-optimism/common-ts'
import {
  CrossChainMessenger,
  MessageStatus,
  MessageDirection,
} from '@eth-optimism/sdk'
import DynamicSizeQueue from './queue-storage'
import { Multicaller, CallWithMeta } from './multicaller'
import { readFromFile, writeToFile } from './utils'
import { MessageRelayerMetrics, MessageRelayerState } from './service_types'
import { L2toL1Message } from './finalize_worker'
import { TransactionManager, ManagingTx } from './transaction-manager'

// The original address of `L2ERC721Bridge` is `0x4200000000000000000000000000000000000014`
// But Oasys deployed the contract with the address bellow for backward compatibility
const OasysL2ERC721BridgeAddress = '0x6200000000000000000000000000000000000001'

export default class Prover {
  public state: MessageRelayerState
  public queue: DynamicSizeQueue<L2toL1Message>

  private metrics: MessageRelayerMetrics & StandardMetrics
  private logger: Logger
  private stateFilePath: string
  private fromL2TransactionIndex: number
  private l2blockConfirmations: number
  private reorgSafetyDepth: number
  private messenger: CrossChainMessenger
  private multicaller: Multicaller
  private postMessage: (succeeds: L2toL1Message[]) => void
  private initalIteration: boolean = true
  private txmgr: TransactionManager | undefined

  constructor(
    metrics: MessageRelayerMetrics & StandardMetrics,
    logger: Logger,
    stateFilePath: string,
    queuePath: string,
    fromL2TransactionIndex: number | undefined,
    l2blockConfirmations: number,
    reorgSafetyDepth: number,
    messenger: CrossChainMessenger,
    multicaller: Multicaller,
    txmgr: TransactionManager | undefined,
    postMessage: (succeeds: L2toL1Message[]) => void
  ) {
    this.stateFilePath = stateFilePath
    this.metrics = metrics
    this.logger = logger
    this.fromL2TransactionIndex = fromL2TransactionIndex
    this.l2blockConfirmations = l2blockConfirmations
    this.reorgSafetyDepth = reorgSafetyDepth
    this.messenger = messenger
    this.multicaller = multicaller
    this.postMessage = postMessage
    this.queue = new DynamicSizeQueue<L2toL1Message>(queuePath)

    if (txmgr) {
      this.txmgr = txmgr

      // setup the subscriber to handle the result of the multicall
      const subscriber = (txs: ManagingTx[]) => {
        const calleds: CallWithMeta[] = []
        const faileds: CallWithMeta[] = []
        for (const tx of txs) {
          const calls = tx.meta as CallWithMeta[]
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

  async init() {
    const state = await this.readStateFromFile()
    this.state = state || {
      highestKnownL2: 0,
      highestProvenL2: 0,
      highestFinalizedL2: 0,
    }
    if (this.state.highestProvenL2 < this.fromL2TransactionIndex) {
      this.state.highestProvenL2 = this.fromL2TransactionIndex
      this.state.highestFinalizedL2 = this.fromL2TransactionIndex
    }

    this.logger.info(`[prover] init: ${JSON.stringify(this.state)}`)
  }

  async writeState() {
    await this.writeStateToFile()
  }

  // TODO: incomplete handling
  // failed to handle when reorg started more deep than (proven height + reorgSafetyDepth)
  // to avoide this case, we assume this service is kept live, and the reorg is detected instantly
  // or this service is stopped and restarted after the reorg is resolved
  public handleL2Reorg(latest: number): void {
    this.updateHighestKnownL2(latest)

    // do nothing if the proven L2 height is lower than the latest - reorgSafetyDepth
    if (this.state.highestProvenL2 <= latest - this.reorgSafetyDepth) {
      return
    }

    // reset proven l2 height as the (latest - reorgSafetyDepth)
    const currentProven = this.state.highestProvenL2
    const newProven = latest - this.reorgSafetyDepth
    this.logger.info(
      `reorg detected. highestProvenL2: ${this.state.highestProvenL2} -> ${
        latest - this.reorgSafetyDepth
      }`
    )
    this.updateHighestProvenL2(newProven)

    // rollback finalized l2 height as same depth as proven l2 height
    const diff = currentProven - newProven
    const finalized =
      this.state.highestFinalizedL2 - diff < 0
        ? 0
        : this.state.highestFinalizedL2 - diff
    this.updateHighestFinalizedL2(finalized)
  }

  public async handleSingleBlock(height: number): Promise<void> {
    const block = await this.messenger.l2Provider.getBlockWithTransactions(
      height
    )
    if (!block || block.transactions.length === 0) return

    this.logger.info(
      `[prover] blockNumber: ${block.number}, txs: ${block.transactions.length}`
    )

    const l2StandardBridge = this.messenger.contracts.l2.L2StandardBridge
      .address
      ? this.messenger.contracts.l2.L2StandardBridge.address
      : this.messenger.contracts.l2.L2StandardBridge.target
    const bridges = [OasysL2ERC721BridgeAddress, l2StandardBridge]

    for (let j = 0; j < block.transactions.length; j++) {
      const txHash = block.transactions[j].hash
      const to = block.transactions[j].to

      // skip if the tx is not sent to the bridge
      if (bridges.indexOf(to) === -1) {
        continue
      }

      // NOTE: Don't use `toCrossChainMessage`, as it call L1 endpont leading to slow down
      const messages = await this.messenger.getMessagesByTransaction(txHash, {
        direction: MessageDirection.L2_TO_L1,
      })
      if (messages.length === 0) {
        this.logger.debug(`[prover] skip txHash: ${txHash}`)
        continue
      }

      // pick the first message from the list, as follow the code inside of messenger.toCrossChainMessage
      const l2toL1Msg = { message: messages[0], txHash, blockHeight: height }
      this.queue.enqueueNoDuplicate(l2toL1Msg)
    }

    return
  }

  public async handleMultipleBlock(): Promise<void> {
    const latest = await this.messenger.l2Provider.getBlockNumber()

    if (latest === this.state.highestKnownL2) {
      return
    } else if (latest < this.state.highestKnownL2) {
      // Reorg detected
      this.handleL2Reorg(latest)
    }

    // update latest known L2 height
    this.updateHighestKnownL2(latest)

    const start = this.startScanHeight()
    const end = this.endScanHeight(start)
    this.logger.info(`[prover] scan block: ${start} - ${end}`)

    // Extract l2ToL1 messages from the blocks
    for (let h = start; h <= end; h++) {
      await this.handleSingleBlock(h)
    }

    // Prove all messages in queue, in where there are 2 cases:
    // - messages in the range of (start, end) are not proven yet
    // - messages failed to prove in the previous iteration
    await this.proveAll()

    // update the proven L2 height
    this.updateHighestProvenL2(end)
  }

  public async proveAll() {
    let calldatas: CallWithMeta[] = []

    // Process all messages in the queue
    const messages = this.queue.peekAll()
    for (const l2toL1Msg of messages) {
      const txHash = l2toL1Msg.txHash
      const status = await this.messenger.getMessageStatus(l2toL1Msg.message)
      const callWithMeta = {
        target:
          this.messenger.contracts.l1.OptimismPortal.address ||
          this.messenger.contracts.l1.OptimismPortal.target,
        callData: null,
        blockHeight: l2toL1Msg.blockHeight,
        txHash,
        message: l2toL1Msg.message,
        err: null,
      }

      this.logger.debug(
        `[prover] txHash: ${txHash}, status: ${MessageStatus[status]})`
      )

      if (status === MessageStatus.STATE_ROOT_NOT_PUBLISHED) {
        this.logger.info(`[prover] waits state root: ${txHash}`)
        // exit if the tx is not ready to prove
        return
      } else if (status === MessageStatus.READY_TO_PROVE) {
        // ok
      } else if (
        status === MessageStatus.IN_CHALLENGE_PERIOD ||
        status === MessageStatus.READY_FOR_RELAY
      ) {
        // enqueue the message to the finalizer just in case
        this.logger.info(`[prover] enqueue to finalizer for sure: ${txHash}`)
        this.postMessage([l2toL1Msg])
        this.queue.evictIgnoreNotFound(l2toL1Msg) // evict from queue
        continue
      } else {
        // skip, mostly already finalized
        this.queue.evictIgnoreNotFound(l2toL1Msg) // evict from queue
        continue
      }

      // Estimate gas cost for proveMessage
      if (this.multicaller?.singleCallGas === 0) {
        const estimatedGas = (
          await this.messenger.estimateGas.proveMessage(txHash)
        ).toNumber()
        this.multicaller.singleCallGas = estimatedGas
        this.logger.info(`[prover] estimated gas: ${estimatedGas} wei`)
      }

      // Populate calldata, the append to the list
      callWithMeta.callData = (
        await this.messenger.populateTransaction.proveMessage(txHash)
      ).data
      calldatas.push(callWithMeta)

      // go next when lower than multicall target gas
      if (!this.multicaller?.isOverTargetGas(calldatas.length)) {
        continue
      }

      // multicall
      const faileds = await this.multicaller?.multicall(calldatas)
      // handle the result if not using txmgr
      if (!this.txmgr) this.handleMulticallResult(calldatas, faileds)
      // stop immediately iterating next tx
      if (faileds.length > 0) throw new Error('multicall failed')

      // reset calldata list
      calldatas.length = 0
    }

    // flush the left calldata
    if (0 < calldatas.length) {
      const faileds = await this.multicaller?.multicall(calldatas)
      if (!this.txmgr) this.handleMulticallResult(calldatas, faileds)
    }
  }

  // - update the checked L2 height with succeeded calls
  // - post the proven messages to the finalizer
  // - log the failed list with each error message
  protected handleMulticallResult(
    calleds: CallWithMeta[],
    faileds: CallWithMeta[]
  ): void {
    // log the called list
    if (0 < faileds.length) {
      this.logger.warn(
        `[prover] failed(${faileds.length}), txHash: ${faileds.map(
          (call) => call.txHash
        )}, errs: ${faileds.map((call) => call.err.message).join(', ')}`
      )
    }

    // evict the processed messages, then enqueue the failed messages
    this.queue.evictIgnoreNotFound(...calleds)
    this.queue.enqueueNoDuplicate(...faileds)

    const failedIds = new Set(faileds.map((failed) => failed.txHash))
    const succeeds = calleds.filter((call) => !failedIds.has(call.txHash))
    if (0 < succeeds.length) {
      this.logger.info(
        `[prover] succeeded(${succeeds.length}) txHash: ${succeeds.map(
          (call) => call.txHash
        )}`
      )
      // update the highest checked L2 height
      if (this.updateHighestCheckedL2(succeeds)) {
        this.metrics.numProvenMessages.inc(succeeds.length)
      }
      // post the proven messages to the finalizer
      this.postMessage(
        succeeds.map((call) => {
          return {
            txHash: call.txHash,
            message: call.message,
            blockHeight: call.blockHeight,
          } as L2toL1Message
        })
      )
    }
  }

  public startScanHeight(): number {
    if (this.initalIteration) {
      this.initalIteration = false
      // To begin scanning from a sufficiently early point
      // we use the L2 state submission interval as the specific prior number.
      const l2stateSubmissionInterval = 120
      const start = this.state.highestProvenL2 - l2stateSubmissionInterval
      return start < 0 ? 0 : start
      // iterate block from the highest finalized at the start of the service
      // return this.state.highestFinalizedL2
    }
    return this.state.highestProvenL2 + 1
  }

  public endScanHeight(start: number): number {
    const end = this.state.highestKnownL2 - this.l2blockConfirmations
    if (end < 0) return 0
    // limit the scan range to 100 blocks
    if (start + 100 < end) return start + 100
    return end
  }

  protected updateHighestCheckedL2(calldatas: CallWithMeta[]): boolean {
    let highest = calldatas.reduce((maxCall, currentCall) => {
      if (!maxCall || currentCall.blockHeight > maxCall.blockHeight) {
        return currentCall
      }
      return maxCall
    }).blockHeight
    if (0 < highest) highest -= 1 // subtract `1` to assure the all transaction in block is finalized
    if (highest <= this.state.highestProvenL2) return false
    this.updateHighestProvenL2(highest)
    return true
  }

  public highestKnownL2(): number {
    return this.state.highestKnownL2
  }

  public highestProvenL2(): number {
    return this.state.highestProvenL2
  }

  public highestFinalizedL2(): number {
    return this.state.highestFinalizedL2
  }

  public updateHighestKnownL2(latest: number): void {
    this.state.highestKnownL2 = latest
    this.metrics.highestKnownL2.set(this.state.highestKnownL2)
    this.logger.info(`[prover] highestKnownL2: ${this.state.highestKnownL2}`)
  }

  public updateHighestProvenL2(latest: number): void {
    this.state.highestProvenL2 = latest
    this.metrics.highestProvenL2.set(this.state.highestProvenL2)
    this.logger.info(`[prover] highestProvenL2: ${this.state.highestProvenL2}`)
  }

  public updateHighestFinalizedL2(latest: number): void {
    this.state.highestFinalizedL2 = latest
    this.metrics.highestFinalizedL2.set(this.state.highestFinalizedL2)
    this.logger.info(
      `[prover] highestFinalizedL2: ${this.state.highestFinalizedL2}`
    )
  }

  protected async readStateFromFile(): Promise<MessageRelayerState> {
    return await readFromFile(this.stateFilePath)
  }

  public async writeStateToFile(): Promise<void> {
    await writeToFile(this.stateFilePath, this.state)
  }
}
