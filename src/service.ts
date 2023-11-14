/* Imports: External */
import { BigNumber, Contract, Signer } from 'ethers'
import {
  BaseServiceV2,
  StandardOptions,
  ExpressRouter,
  validators,
  Gauge,
  Counter,
} from '@eth-optimism/common-ts'
import {
  CrossChainMessenger,
  DeepPartial,
  DEFAULT_L2_CONTRACT_ADDRESSES,
  MessageStatus,
  OEContractsLike,
  CrossChainMessage,
  MessageDirection,
} from '@eth-optimism/sdk'
import { Provider } from '@ethersproject/abstract-provider'
import { version } from '../package.json'
import Multicall2 from './contracts/Multicall2.json'

type MessageRelayerOptions = {
  l1RpcProvider: Provider
  l2RpcProvider: Provider
  l1Wallet: Signer
  fromL2TransactionIndex?: number
  addressManager?: string
  l1CrossDomainMessenger?: string
  l1StandardBridge?: string
  stateCommitmentChain?: string
  canonicalTransactionChain?: string
  bondManager?: string
  isMulticall?: string
  multicallGasLimit?: number
  maxBlockBatchSize?: number
  pollInterval?: number
  receiptTimeout?: number
  gasMultiplier?: number
  depositConfirmationBlocks?: number
  l1BlockTimeSeconds?: number
}

type MessageRelayerMetrics = {
  highestCheckableL2Tx: Gauge
  highestKnownL2Tx: Gauge
  numRelayedMessages: Counter
}

type MessageRelayerState = {
  wallet: Signer
  messenger: CrossChainMessenger
  multicall2Contract?: Contract
  highestCheckableL2Tx: number
  highestKnownL2Tx: number
}

export class MessageRelayerService extends BaseServiceV2<
  MessageRelayerOptions,
  MessageRelayerMetrics,
  MessageRelayerState
> {
  constructor(options?: Partial<MessageRelayerOptions & StandardOptions>) {
    super({
      name: 'Message_Relayer',
      version,
      options,
      optionsSpec: {
        l1RpcProvider: {
          validator: validators.provider,
          desc: 'Provider for interacting with L1.',
        },
        l2RpcProvider: {
          validator: validators.provider,
          desc: 'Provider for interacting with L2.',
        },
        l1Wallet: {
          validator: validators.wallet,
          desc: 'Wallet used to interact with L1.',
        },
        fromL2TransactionIndex: {
          validator: validators.num,
          desc: 'Index of the first L2 transaction to start processing from.',
          default: 0,
        },
        addressManager: {
          validator: validators.str,
          desc: 'Address of the Lib_AddressManager on Layer1.',
        },
        l1CrossDomainMessenger: {
          validator: validators.str,
          desc: 'Address of the Proxy__OVM_L1CrossDomainMessenger on Layer1.',
        },
        l1StandardBridge: {
          validator: validators.str,
          desc: 'Address of the Proxy__OVM_L1StandardBridge on Layer1.',
        },
        stateCommitmentChain: {
          validator: validators.str,
          desc: 'Address of the StateCommitmentChain on Layer1.',
        },
        canonicalTransactionChain: {
          validator: validators.str,
          desc: 'Address of the CanonicalTransactionChain on Layer1.',
        },
        bondManager: {
          validator: validators.str,
          desc: 'Address of the BondManager on Layer1.',
        },
        isMulticall: {
          validator: validators.str,
          desc: 'Whether use multicall contract when the relay.',
        },
        multicallGasLimit: {
          validator: validators.num,
          desc: 'gas limit for multicall contract when the relay',
          default: 1500000,
        },
        maxBlockBatchSize: {
          validator: validators.num,
          desc: 'If using multicall, max block batch size for multicall messaging relay.',
          default: 200,
        },
        pollInterval: {
          validator: validators.num,
          desc: 'Polling interval of StateCommitmentChain (unit: msec).',
          default: 1000,
        },
        receiptTimeout: {
          validator: validators.num,
          desc: 'Receipt wait timeout for relay transaction (unit: msec).',
          default: 15000,
        },
        gasMultiplier: {
          validator: validators.num,
          desc: 'Gas limit multiplier.',
          default: 1.1,
        },
        depositConfirmationBlocks: {
          validator: validators.num,
          desc: 'Blocks before a deposit is confirmed',
          default: 2,
        },
        l1BlockTimeSeconds: {
          validator: validators.num,
          desc: 'Block time in seconds for the L1 chain.',
          default: 15,
        },
      },
      metricsSpec: {
        highestCheckableL2Tx: {
          type: Gauge,
          desc: 'Highest L2 tx that has been checkable',
        },
        highestKnownL2Tx: {
          type: Gauge,
          desc: 'Highest known L2 transaction',
        },
        numRelayedMessages: {
          type: Counter,
          desc: 'Number of messages relayed by the service',
        },
      },
    })
  }

  protected async init(): Promise<void> {
    this.state.wallet = this.options.l1Wallet.connect(
      this.options.l1RpcProvider
    )

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

    const l1Network = await this.state.wallet.provider.getNetwork()
    const l1ChainId = l1Network.chainId
    const l2Network = await this.options.l2RpcProvider.getNetwork()
    const l2ChainId = l2Network.chainId
    this.state.messenger = new CrossChainMessenger({
      l1SignerOrProvider: this.state.wallet,
      l2SignerOrProvider: this.options.l2RpcProvider,
      l1ChainId,
      l2ChainId,
      depositConfirmationBlocks: this.options.depositConfirmationBlocks,
      l1BlockTimeSeconds: this.options.l1BlockTimeSeconds,
      // TODO: bridges: 
      contracts,
      bedrock: true,
    })

    if (this.options.isMulticall) {
      const multicall2ContractAddress =
        '0x5200000000000000000000000000000000000022'
      this.state.multicall2Contract = new Contract(
        multicall2ContractAddress,
        Multicall2.abi,
        this.state.wallet
      )
    }

    this.state.highestCheckableL2Tx = this.options.fromL2TransactionIndex || 1
    this.state.highestKnownL2Tx =
      await this.state.messenger.l2Provider.getBlockNumber()
  }

  async routes(router: ExpressRouter): Promise<void> {
    router.get('/status', async (req, res) => {
      return res.status(200).json({
        // ok: !this.state.diverged,
      })
    })
  }

  protected async main(): Promise<void> {
  }

}

if (require.main === module) {
  const service = new MessageRelayerService()
  service.run()
}
