import { Worker } from 'worker_threads'
import { BigNumber, Contract, Signer } from 'ethers'
import { sleep } from '@eth-optimism/core-utils'
import {
  BaseServiceV2,
  StandardOptions,
  ExpressRouter,
  Gauge,
  Counter,
} from '@eth-optimism/common-ts'
import {
  CrossChainMessenger,
  StandardBridgeAdapter,
  DeepPartial,
  DEFAULT_L2_CONTRACT_ADDRESSES,
  MessageStatus,
  OEContractsLike,
  CrossChainMessage,
  MessageDirection,
} from '@eth-optimism/sdk'
import {
  MessageRelayerOptions,
  serviceName,
  serviceVersion,
  serviceOptionsSpec,
  serviseMetricsSpec,
} from './service_params'
import { Multicaller, CallWithMeta } from './multicaller'
import { FinalizerMessage, L2toL1Message } from './finalize_worker'
import { readFromFile, writeToFile } from './utils'

type MessageRelayerMetrics = {
  highestKnownL2: Gauge
  highestProvenL2: Gauge
  highestFinalizedL2: Gauge
  numRelayedMessages: Counter
}

type MessageRelayerState = {
  highestKnownL2: number
  highestProvenL2: number
  highestFinalizedL2: number
}

export class MessageRelayerService extends BaseServiceV2<
  MessageRelayerOptions,
  MessageRelayerMetrics,
  MessageRelayerState
> {
  private initalIteration: boolean = true
  private wallet: Signer
  private messenger: CrossChainMessenger
  private multicaller?: Multicaller
  private finalizeWorker?: Worker

  constructor(options?: Partial<MessageRelayerOptions & StandardOptions>) {
    super({
      name: serviceName,
      version: serviceVersion,
      options,
      optionsSpec: serviceOptionsSpec,
      metricsSpec: serviseMetricsSpec,
    })
  }

  protected async init(): Promise<void> {
    this.wallet = this.options.l1Wallet.connect(this.options.l1RpcProvider)

    const l1ContractOpts = [
      this.options.addressManager,
      this.options.l1CrossDomainMessenger,
      this.options.l1StandardBridge,
      this.options.stateCommitmentChain,
      this.options.canonicalTransactionChain,
      this.options.bondManager,
    ]

    let contracts: DeepPartial<OEContractsLike> = undefined
    if (l1ContractOpts.every((x) => x)) {
      contracts = {
        l1: {
          AddressManager: this.options.addressManager,
          L1CrossDomainMessenger: this.options.l1CrossDomainMessenger,
          L1StandardBridge: this.options.l1StandardBridge,
          StateCommitmentChain: this.options.stateCommitmentChain,
          CanonicalTransactionChain: this.options.canonicalTransactionChain,
          BondManager: this.options.bondManager,
        },
        l2: DEFAULT_L2_CONTRACT_ADDRESSES,
      }
    } else if (l1ContractOpts.some((x) => x)) {
      throw new Error('L1 contract address is missing.')
    }

    const l1Network = await this.wallet.provider.getNetwork()
    const l1ChainId = l1Network.chainId
    const l2Network = await this.options.l2RpcProvider.getNetwork()
    const l2ChainId = l2Network.chainId
    this.messenger = new CrossChainMessenger({
      l1SignerOrProvider: this.wallet,
      l2SignerOrProvider: this.options.l2RpcProvider,
      l1ChainId,
      l2ChainId,
      depositConfirmationBlocks: this.options.depositConfirmationBlocks,
      l1BlockTimeSeconds: this.options.l1BlockTimeSeconds,
      // TODO: bridges:
      bridges: {
        Standard: {
          Adapter: StandardBridgeAdapter,
          l1Bridge: this.options.l1StandardBridge,
          l2Bridge: this.options.l2StandardBridge,
        },
      },
      contracts,
      bedrock: true,
    })

    this.multicaller = new Multicaller(
      this.options.multicall,
      this.wallet,
      this.options.multicallTargetGas,
      this.options.gasMultiplier
    )

    this.state = await this.readStateFromFile()
    if (this.state.highestProvenL2 < this.options.fromL2TransactionIndex) {
      this.state.highestProvenL2 = this.options.fromL2TransactionIndex
      this.state.highestFinalizedL2 = this.options.fromL2TransactionIndex
    }

    this.finalizeWorker = new Worker('./src/finalize_worker.ts', {
      workerData: {
        logger: this.logger,
        pollingInterval: this.options.pollInterval,
        messenger: this.messenger,
        multicaller: this.multicaller,
      },
    })

    this.finalizeWorker.on('message', (message: FinalizerMessage) => {
      this.updateHighestFinalizedL2(message.highestFinalizedL2)
    })
  }

  async routes(router: ExpressRouter): Promise<void> {
    router.get('/status', async (req: any, res: any) => {
      return res.status(200).json({
        highestKnownL2: this.state.highestKnownL2,
        highestProvenL2: this.state.highestProvenL2,
        highestFinalizedL2: this.state.highestFinalizedL2,
      })
    })
  }

  protected async main(): Promise<void> {
    await this.handleMultipleBlock()
  }

  // override to write the last state
  public async stop(): Promise<void> {
    await this.writeStateToFile(this.state)
    await this.finalizeWorker?.terminate()
    await super.stop()
  }

  // TODO: incomplete handling
  // failed to handle when reorg started more deep than (proven height + reorgSafetyDepth)
  // to avoide this case, we assume the service is kept live, and the reorg is detected instantly
  protected handleL2Reorg(latest: number): void {
    this.updateHighestKnownL2(latest)

    // do nothing if the proven L2 height is lower than the latest - reorgSafetyDepth
    if (this.state.highestProvenL2 + this.options.reorgSafetyDepth < latest) {
      return
    }

    // reset proven l2 height as the (latest - reorgSafetyDepth)
    const currentProven = this.state.highestProvenL2
    const newProven = latest - this.options.reorgSafetyDepth
    if (newProven < currentProven) {
      this.logger.info(
        `reorg detected. highestProvenL2: ${this.state.highestProvenL2} -> ${
          latest - this.options.reorgSafetyDepth
        }`
      )
      this.updateHighestProvenL2(newProven)

      // rollback finalized l2 height as same depth as proven l2 height
      const diff = currentProven - newProven
      this.updateHighestFinalizedL2(this.state.highestFinalizedL2 - diff)
    }
  }

  protected async handleMultipleBlock(): Promise<void> {
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
    const target = this.messenger.contracts.l1.OptimismPortal.target

    for (let h = this.startScanHeight(); h < this.endScanHeight(); h++) {
      const block = await this.messenger.l2Provider.getBlockWithTransactions(h)
      if (block === null) {
        break
      }

      // empty block is allowed
      if (block.transactions.length === 0) {
        continue
      }

      for (let j = 0; j < block.transactions.length; j++) {
        const txHash = block.transactions[j].hash
        const message = await this.messenger.toCrossChainMessage(txHash)
        const status = await this.messenger.getMessageStatus(message)
        this.logger.debug(
          `txHash: ${txHash}, status: ${MessageStatus[status]})`
        )

        if (status !== MessageStatus.READY_TO_PROVE) {
          continue
        }

        // Estimate gas cost for proveMessage
        if (this.multicaller?.singleCallGas === 0) {
          const estimatedGas = (
            await this.messenger.estimateGas.proveMessage(txHash)
          ).toNumber()
          this.multicaller.singleCallGas = estimatedGas
        }

        // Populate calldata, the append to the list
        const callData = (
          await this.messenger.populateTransaction.proveMessage(txHash)
        ).data
        calldatas.push({
          target,
          callData,
          blockHeight: block.number,
          txHash,
          message,
          err: null,
        })

        // go next when lower than multicall target gas
        if (!this.multicaller?.isOvertargetGas(calldatas.length)) {
          continue
        }

        // send multicall
        // - update the checked L2 height with succeeded calls
        // - post the proven messages to the finalizer
        // - log the failed list with each error message
        this.handleMulticallResult(
          calldatas,
          await this.multicaller?.multicall(calldatas, null)
        )
      }
    }

    // flush the left calldata
    if (0 < calldatas.length)
      this.handleMulticallResult(
        calldatas,
        await this.multicaller?.multicall(calldatas, null)
      )
  }

  protected handleMulticallResult(
    calleds: CallWithMeta[],
    faileds: CallWithMeta[]
  ): void {
    const failedIds = new Set(faileds.map((failed) => failed.txHash))
    const succeeds = calleds.filter((call) => !failedIds.has(call.txHash))

    // update the highest checked L2 height
    if (this.updateHighestCheckedL2(succeeds)) {
      this.metrics.numRelayedMessages.inc(succeeds.length)
    }
    // send the proven messages to the finalizer
    const messages: L2toL1Message[] = succeeds.map((call) => {
      return {
        message: call.message,
        txHash: call.txHash,
        blockHeight: call.blockHeight,
      }
    })
    this.finalizeWorker?.postMessage(messages)

    // record log the failed list with each error message
    for (const fail of faileds) {
      this.logger.warn(
        `failed to prove: ${fail.txHash}, err: ${fail.err.message}`
      )
    }
  }

  protected startScanHeight(): number {
    if (this.initalIteration) {
      // iterate block from the highest finalized at the start of the service
      this.initalIteration = false
      return this.state.highestFinalizedL2
    }
    return this.state.highestProvenL2
  }

  protected endScanHeight(): number {
    return this.state.highestKnownL2 - this.options.l2blockConfirmations
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

  protected updateHighestKnownL2(latest: number): void {
    this.state.highestKnownL2 = latest
    this.metrics.highestKnownL2.set(this.state.highestKnownL2)
    this.logger.debug(`highestKnownL2: ${this.state.highestKnownL2}`)
  }

  protected updateHighestProvenL2(latest: number): void {
    this.state.highestProvenL2 = latest
    this.metrics.highestProvenL2.set(this.state.highestProvenL2)
    this.logger.debug(`highestProvenL2: ${this.state.highestProvenL2}`)
  }

  protected updateHighestFinalizedL2(latest: number): void {
    this.state.highestFinalizedL2 = latest
    this.metrics.highestFinalizedL2.set(this.state.highestFinalizedL2)
    this.logger.debug(`highestFinalizedL2: ${this.state.highestFinalizedL2}`)
  }

  protected async readStateFromFile(): Promise<MessageRelayerState> {
    return await readFromFile(this.options.stateFilePath)
  }

  protected async writeStateToFile(state: MessageRelayerState): Promise<void> {
    await writeToFile(this.options.stateFilePath, state)
  }
}

if (require.main === module) {
  const service = new MessageRelayerService()
  service.run()
}
