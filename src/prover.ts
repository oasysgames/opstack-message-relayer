import { Logger, StandardMetrics } from '@eth-optimism/common-ts'
import {
  CrossChainMessenger,
  MessageStatus,
  CrossChainMessage,
  MessageDirection,
} from '@eth-optimism/sdk'
import { Multicaller, CallWithMeta } from './multicaller'
import { readFromFile, writeToFile } from './utils'
import { MessageRelayerMetrics, MessageRelayerState } from './service_types'
import { TransactionManager, ManagingTx } from './transaction-manager'

export default class Prover {
  public state: MessageRelayerState

  private metrics: MessageRelayerMetrics & StandardMetrics
  private logger: Logger
  private stateFilePath: string
  private fromL2TransactionIndex: number
  private l2blockConfirmations: number
  private reorgSafetyDepth: number
  private messenger: CrossChainMessenger
  private multicaller: Multicaller
  private postMessage: (succeeds: CallWithMeta[]) => void
  private initalIteration: boolean = true
  private txmgr: TransactionManager

  constructor(
    metrics: MessageRelayerMetrics & StandardMetrics,
    logger: Logger,
    stateFilePath: string,
    fromL2TransactionIndex: number | undefined,
    l2blockConfirmations: number,
    reorgSafetyDepth: number,
    messenger: CrossChainMessenger,
    multicaller: Multicaller,
    txmgr: TransactionManager | undefined,
    postMessage: (succeeds: CallWithMeta[]) => void
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
    this.txmgr = txmgr
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
    if (this.txmgr) {
      // setup the subscriber to handle the result of the multicall
      const subscriber = (txs: ManagingTx[]) => {
        const calleds = txs.map((tx) => tx.meta) // extract calls
        const faileds = txs // extract failed txs
          .filter((tx) => tx.err !== undefined)
          .map((tx) => {
            tx.meta.err = tx.err
            return tx.meta
          })
        this.handleMulticallResult(calleds, faileds)
      }
      this.txmgr.addSubscriber(subscriber)
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

  public async handleSingleBlock(
    height: number,
    calldatas: CallWithMeta[] = []
  ): Promise<CallWithMeta[]> {
    const block = await this.messenger.l2Provider.getBlockWithTransactions(
      height
    )
    if (block === null || block.transactions.length === 0) {
      return calldatas
    }

    this.logger.debug(
      `[prover] blockNumber: ${block.number}, txs: ${block.transactions.length}`
    )

    const target =
      this.messenger.contracts.l1.OptimismPortal.address ||
      this.messenger.contracts.l1.OptimismPortal.target

    for (let j = 0; j < block.transactions.length; j++) {
      const txHash = block.transactions[j].hash

      // Don't use toCrossChainMessage, as it call L1 endpont leading to slow down
      // try {
      //   message = await this.messenger.toCrossChainMessage(txHash)
      // } catch (err) {
      //   // skip if the tx is not a cross-chain message
      //   const noWithdrawMsg = 'withdrawal index 0 out of bounds'
      //   if (err.message.includes(noWithdrawMsg)) {
      //     this.logger.debug(`[prover] skip txHash: ${txHash}`)
      //     continue
      //   }
      //   // otherwise, throw the error
      //   throw err
      // }
      const messages = await this.messenger.getMessagesByTransaction(txHash, {
        direction: MessageDirection.L2_TO_L1,
      })
      if (messages.length === 0) {
        this.logger.debug(`[prover] skip txHash: ${txHash}`)
        continue
      }

      // pick the first message from the list, as follow the code inside of messenger.toCrossChainMessage
      const message: CrossChainMessage = messages[0]
      const status = await this.messenger.getMessageStatus(message)
      this.logger.debug(
        `[prover] txHash: ${txHash}, status: ${MessageStatus[status]})`
      )

      const callWithMeta = {
        target,
        callData: null,
        blockHeight: block.number,
        txHash,
        message,
        err: null,
      }

      if (status === MessageStatus.STATE_ROOT_NOT_PUBLISHED) {
        this.logger.info(`[prover] waits state root: ${txHash}`)
        // exit if the tx is not ready to prove
        throw new Error(`not state root published: ${txHash}`)
      } else if (status === MessageStatus.READY_TO_PROVE) {
        // ok
      } else if (
        status === MessageStatus.IN_CHALLENGE_PERIOD ||
        status === MessageStatus.READY_FOR_RELAY
      ) {
        // enqueue the message to the finalizer just in case
        this.logger.info(`[prover] enqueue to finalizer for sure: ${txHash}`)
        this.postMessage([callWithMeta])
        continue
      } else {
        // skip, mostly already finalized
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
      const faileds = await this.multicaller?.multicall(calldatas, this.txmgr)
      // handle the result if not using txmgr
      if (!this.txmgr) this.handleMulticallResult(calldatas, faileds)

      // reset calldata list
      calldatas = []
    }

    return calldatas
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

    let calldatas: CallWithMeta[] = []
    let waitsStateRoot = false

    for (let h = this.startScanHeight(); h <= this.endScanHeight(); h++) {
      try {
        calldatas = await this.handleSingleBlock(h, calldatas)
      } catch (err) {
        if (err.message.includes('not state root published')) {
          waitsStateRoot = true
          break
        }
        throw err
      }
    }

    // flush the left calldata
    if (0 < calldatas.length) {
      const faileds = await this.multicaller?.multicall(calldatas, this.txmgr)
      if (!this.txmgr) this.handleMulticallResult(calldatas, faileds)
    }

    // update the proven L2 height
    if (!waitsStateRoot) {
      this.updateHighestProvenL2(this.endScanHeight())
    }
  }

  // - update the checked L2 height with succeeded calls
  // - post the proven messages to the finalizer
  // - log the failed list with each error message
  protected handleMulticallResult(
    calleds: CallWithMeta[],
    faileds: CallWithMeta[]
  ): void {
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
      this.postMessage(succeeds)
    }

    // record log the failed list with each error message
    for (const fail of faileds) {
      this.logger.warn(
        `[prover] failed to prove: ${fail.txHash}, err: ${fail.err.message}`
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

  public endScanHeight(): number {
    const start = this.state.highestKnownL2 - this.l2blockConfirmations
    return start < 0 ? 0 : start
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
