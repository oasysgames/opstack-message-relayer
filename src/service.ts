import { Signer, providers } from 'ethers'
import {
  BaseServiceV2,
  StandardOptions,
  ExpressRouter,
} from '@eth-optimism/common-ts'
import {
  CrossChainMessenger,
  DeepPartial,
  DEFAULT_L2_CONTRACT_ADDRESSES,
  OEContractsLike,
} from '@eth-optimism/sdk'
import {
  MessageRelayerOptions,
  serviceName,
  serviceVersion,
  serviceOptionsSpec,
  serviseMetricsSpec,
} from './service_params'
import { Multicaller, CallWithMeta } from './multicaller'
import FinalizeWorkCreator from './worker_creator'
import { FinalizerMessage, L2toL1Message } from './finalize_worker'
import { MessageRelayerMetrics, MessageRelayerState } from './service_types'
import Prover from './prover'
import { ZERO_ADDRESS, sleep } from './utils'
import { TransactionManager } from './transaction-manager'

export class MessageRelayerService extends BaseServiceV2<
  MessageRelayerOptions,
  MessageRelayerMetrics,
  MessageRelayerState
> {
  private wallet: Signer
  private messenger: CrossChainMessenger
  private multicaller?: Multicaller
  private prover?: Prover
  private finalizeWorkerCreator?: FinalizeWorkCreator

  constructor(options?: Partial<MessageRelayerOptions & StandardOptions>) {
    super({
      name: serviceName,
      version: serviceVersion,
      options: {
        ...options,
        // the default service main loop interval is 5 seconds
        // NOTE: failed to set the default value by below
        //       the value of `options` arugment is always `undefined`
        // loopIntervalMs: options?.loopIntervalMs ?? 5000,
      },
      optionsSpec: serviceOptionsSpec,
      metricsSpec: serviseMetricsSpec,
    })
  }

  protected async init(): Promise<void> {
    this.logger.info('[service] startup options', this.options)

    this.wallet = this.options.proverPrivateKey.connect(
      this.options.l1RpcProvider
    )
    const contracts: DeepPartial<OEContractsLike> = {
      l1: {
        AddressManager: this.options.addressManager,
        L1CrossDomainMessenger: this.options.l1CrossDomainMessenger,
        L1StandardBridge: ZERO_ADDRESS, // dummy address
        StateCommitmentChain: ZERO_ADDRESS, // dummy address
        CanonicalTransactionChain: ZERO_ADDRESS, // dummy address
        BondManager: ZERO_ADDRESS, // dummy address
        OptimismPortal: this.options.portalAddress,
        L2OutputOracle: this.options.OutputOracle,
      },
      l2: DEFAULT_L2_CONTRACT_ADDRESSES,
    }
    const l1ChainId = (await this.wallet.provider.getNetwork()).chainId
    const l2ChainId = (await this.options.l2RpcProvider.getNetwork()).chainId

    this.messenger = new CrossChainMessenger({
      l1SignerOrProvider: this.wallet,
      l2SignerOrProvider: this.options.l2RpcProvider,
      l1ChainId,
      l2ChainId,
      depositConfirmationBlocks: this.options.depositConfirmationBlocks,
      l1BlockTimeSeconds: this.options.l1BlockTimeSeconds,
      contracts,
      bedrock: true,
    })

    this.multicaller = new Multicaller(
      this.options.multicallAddress,
      this.wallet,
      this.options.multicallTargetGas,
      this.options.gasMultiplier
    )

    const l1RpcEndpoint = (
      this.options.l1RpcProvider as providers.JsonRpcProvider
    ).connection.url
    const l2RpcEndpoint = (
      this.options.l2RpcProvider as providers.JsonRpcProvider
    ).connection.url
    this.finalizeWorkerCreator = new FinalizeWorkCreator(
      this.logger,
      this.options.queuePath,
      this.options.loopIntervalMs,
      this.options.logLevel,
      this.options.addressManager,
      this.options.l1CrossDomainMessenger,
      this.options.OutputOracle,
      this.options.portalAddress,
      l1RpcEndpoint,
      l2RpcEndpoint,
      l1ChainId,
      l2ChainId,
      this.options.l1BlockTimeSeconds,
      this.options.finalizerPrivateKey,
      this.multicaller,
      this.options.maxPendingTxs,
      (message: FinalizerMessage) => {
        this.prover?.updateHighestFinalizedL2(message.highestFinalizedL2)
        this.metrics.numFinalizedMessages.inc(message.finalizedTxs)
      },
      (code: number) => {
        this.logger.error(`[service] worker exit with code: ${code}`)
        this.stop()
      }
    )

    const toMessages = (calls: CallWithMeta[]): L2toL1Message[] => {
      return calls.map((call) => {
        return {
          message: call.message,
          txHash: call.txHash,
          blockHeight: call.blockHeight,
        }
      })
    }
    let txmgr: TransactionManager
    if (1 < this.options.maxPendingTxs) {
      // temporary fixed as 0
      // If you're not using txmgr, the confirmationNumber will be zero.
      // tx.wait() will not confirm any blocks.
      const confirmationNumber = 0
      txmgr = new TransactionManager(
        this.wallet,
        this.options.maxPendingTxs,
        confirmationNumber
      )
    }
    this.prover = new Prover(
      this.metrics,
      this.logger,
      this.options.stateFilePath,
      this.options.fromL2TransactionIndex,
      this.options.depositConfirmationBlocks,
      this.options.reorgSafetyDepth,
      this.messenger,
      this.multicaller,
      txmgr,
      (succeeds: CallWithMeta[]) =>
        this.finalizeWorkerCreator?.postMessage(toMessages(succeeds))
    )
    await this.prover.init()
  }

  async routes(router: ExpressRouter): Promise<void> {
    router.get('/status', async (req: any, res: any) => {
      return res.status(200).json({
        highestKnownL2: this.prover?.state.highestKnownL2,
        highestProvenL2: this.prover?.state.highestProvenL2,
        highestFinalizedL2: this.prover?.state.highestFinalizedL2,
      })
    })
  }

  protected async main(): Promise<void> {
    await this.prover?.handleMultipleBlock()
    await this.prover.writeState()
  }

  // override to write the last state
  public async stop(): Promise<void> {
    this.logger.info(
      `[service] writing state to ${this.options.stateFilePath}. state:`,
      this.prover?.state
    )
    await this.prover.writeState()
    // forth to terminate the finalize worker after loopIntervalMs
    let workerTerminated = false
    setTimeout(() => {
      this.finalizeWorkerCreator?.terminate()
      workerTerminated = true
    }, this.loopIntervalMs)
    // post close message to finalize worker
    this.finalizeWorkerCreator?.postMessage({
      type: 'close',
      message: 'service request to close',
    })
    // stop the main loop
    await super.stop()
    // wait until the finalize worker is terminated
    this.logger.info(
      `[service] wait for a while(${this.loopIntervalMs}ms) until the finalize worker is terminated`
    )
    const waitForStopped = async () => {
      while (!workerTerminated) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
    await waitForStopped()
  }
}

if (require.main === module) {
  const service = new MessageRelayerService()
  service.run()
}
