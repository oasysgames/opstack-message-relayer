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
import FinalizeWrorWrapper from './worker_wrapper'
import { FinalizerMessage, L2toL1Message } from './finalize_worker'
import { MessageRelayerMetrics, MessageRelayerState } from './service_types'
import Prover from './prover'

export class MessageRelayerService extends BaseServiceV2<
  MessageRelayerOptions,
  MessageRelayerMetrics,
  MessageRelayerState
> {
  private wallet: Signer
  private messenger: CrossChainMessenger
  private multicaller?: Multicaller
  private prover?: Prover
  private finalizeWorker?: FinalizeWrorWrapper

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

    const l1ChainId = (await this.wallet.provider.getNetwork()).chainId
    const l2ChainId = (await this.options.l2RpcProvider.getNetwork()).chainId
    this.messenger = new CrossChainMessenger({
      l1SignerOrProvider: this.wallet,
      l2SignerOrProvider: this.options.l2RpcProvider,
      l1ChainId,
      l2ChainId,
      depositConfirmationBlocks: this.options.depositConfirmationBlocks,
      l1BlockTimeSeconds: this.options.l1BlockTimeSeconds,
      // bridges: {
      //   Standard: {
      //     Adapter: StandardBridgeAdapter,
      //     l1Bridge: this.options.l1StandardBridge,
      //     l2Bridge: this.options.l2StandardBridge,
      //   },
      // },
      contracts,
      bedrock: true,
    })

    this.multicaller = new Multicaller(
      this.options.multicall,
      this.wallet,
      this.options.multicallTargetGas,
      this.options.gasMultiplier
    )

    this.prover = new Prover(
      this.metrics,
      this.logger,
      this.options.stateFilePath,
      this.options.fromL2TransactionIndex,
      this.options.l2blockConfirmations,
      this.options.reorgSafetyDepth,
      this.messenger,
      this.multicaller,
      (succeeds: CallWithMeta[]) => {
        const messages: L2toL1Message[] = succeeds.map((call) => {
          return {
            message: call.message,
            txHash: call.txHash,
            blockHeight: call.blockHeight,
          }
        })
        this.finalizeWorker?.postMessage(messages)
      }
    )
    await this.prover.init()

    const l1RpcEndpoint = (
      this.options.l1RpcProvider as providers.JsonRpcProvider
    ).connection.url
    this.finalizeWorker = new FinalizeWrorWrapper(
      this.logger,
      this.options.queueSize,
      this.options.pollInterval,
      this.options.logLevel,
      this.options.addressManager,
      this.options.l1CrossDomainMessenger,
      this.options.portalAddress,
      l1RpcEndpoint,
      l1ChainId,
      this.options.l1BlockTimeSeconds,
      this.options.finalizerPrivateKey,
      this.multicaller,
      (message: FinalizerMessage) =>
        this.prover?.updateHighestFinalizedL2(message.highestFinalizedL2)
    )
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
    await this.prover?.handleMultipleBlock()
  }

  // override to write the last state
  public async stop(): Promise<void> {
    await this.prover.writeState()
    this.finalizeWorker?.terminate()
    await super.stop()
  }
}

if (require.main === module) {
  const service = new MessageRelayerService()
  service.run()
}
