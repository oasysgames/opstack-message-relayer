/* Imports: External */
import { BigNumber, Contract, Signer } from 'ethers'
import { BytesLike } from "@ethersproject/bytes";
import { sleep } from '@eth-optimism/core-utils'
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
  StandardBridgeAdapter,
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
  l2StandardBridge?: string
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
  highestCheckedL2: Gauge
  highestKnownL2: Gauge
  numRelayedMessages: Counter
}

type MessageRelayerState = {
  wallet: Signer
  messenger: CrossChainMessenger
  multicall2Contract?: Contract
  highestCheckedL2: number
  highestKnownL2: number
}

type Call = {
  target: string
  callData: BytesLike
}

type CallWithHeight = Call & {
  blockHeight: number;
}

const convertToCalls = (calls: CallWithHeight[]): Call[] => calls.map(({ blockHeight, ...callProps }) => callProps);

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
        l2StandardBridge: {
          validator: validators.str,
          desc: 'Address of the L2StandardBridge on Layer2.',
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
        highestCheckedL2: {
          type: Gauge,
          desc: 'Highest L2 tx that has been checked',
        },
        highestKnownL2: {
          type: Gauge,
          desc: 'Highest known L2 height',
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

    if (this.options.isMulticall) {
      const multicall2ContractAddress =
        '0x5200000000000000000000000000000000000022'
      this.state.multicall2Contract = new Contract(
        multicall2ContractAddress,
        Multicall2.abi,
        this.state.wallet
      )
    }

    this.state.highestCheckedL2 = this.options.fromL2TransactionIndex || 1
    this.state.highestKnownL2 =
      await this.state.messenger.l2Provider.getBlockNumber()
  }

  async routes(router: ExpressRouter): Promise<void> {
    router.get('/status', async (req: any, res: any) => {
      return res.status(200).json({
        highestCheckedL2: this.state.highestCheckedL2,
        highestKnownL2: this.state.highestKnownL2,
      })
    })
  }

  protected async main(): Promise<void> {
    await this.handleMultipleBlock()
  }

  // Compute expected gas cost of multicall
  // from multiplying the first gas cost of proveMessage by the number of messages
  protected computeExpectedMulticallGas(base: number, size: number): number {
    return base * size * this.options.gasMultiplier;
  }

  protected async handleMultipleBlock(): Promise<void> {
    // Should never happen.
    if (
      !this.state.multicall2Contract ||
      !this.options.l1CrossDomainMessenger
    ) {
      throw new Error(
        `You can not use mulitcall to handle multiple bridge messages`
      )
    }

    // Update metrics
    this.metrics.highestCheckedL2.set(this.state.highestCheckedL2)
    this.metrics.highestKnownL2.set(this.state.highestKnownL2)
    this.logger.debug(`highestCheckedL2: ${this.state.highestCheckedL2}`)
    this.logger.debug(`highestKnownL2: ${this.state.highestKnownL2}`)

    // If we're already at the tip, then update the latest tip and loop again.
    if (this.state.highestCheckedL2 > this.state.highestKnownL2) {
      this.state.highestKnownL2 =
        await this.state.messenger.l2Provider.getBlockNumber()

      // Sleeping for 1000ms is good enough since this is meant for development and not for live
      // networks where we might want to restrict the number of requests per second.
      await sleep(1000)
      this.logger.debug(`highestCheckedL2 > this.state.highestKnownL2`)
      return
    }


    let calldatas: CallWithHeight[] = []
    let gasProveMessage: number
    const target = this.state.messenger.contracts.l1.OptimismPortal.target

    for (
      let i = this.state.highestCheckedL2;
      i < this.state.highestCheckedL2 + this.options.maxBlockBatchSize;
      i++
    ) {
      const block =
        await this.state.messenger.l2Provider.getBlockWithTransactions(i)
      if (block === null) {
        break
      }

      // empty block is allowed
      if (block.transactions.length === 0) {
        continue
      }

      for (let j = 0; j < block.transactions.length; j++) {
        const txHash = block.transactions[j].hash
        const status = await this.state.messenger.getMessageStatus(txHash)
        this.logger.debug(`txHash: ${txHash}, status: ${MessageStatus[status]})`)

        if (status !== MessageStatus.READY_TO_PROVE) {
          continue
        }

        // Estimate gas cost for proveMessage
        if (gasProveMessage === undefined) {
          gasProveMessage = (await this.state.messenger.estimateGas.proveMessage(txHash)).toNumber()
        }

        // Populate calldata, the append to the list
        const callData = (await this.state.messenger.populateTransaction.proveMessage(txHash)).data
        calldatas.push({ target, callData, blockHeight: block.number })

        // go next when lower than multicall allowed gas limit
        const exGasWithSafety = this.computeExpectedMulticallGas(gasProveMessage, calldatas.length)
        if (exGasWithSafety < this.options.multicallGasLimit) {
          continue;
        }

        // send multicall, then update the checked L2 height
        // return the remaining callcatas, those are failed due to gas limit
        calldatas = await this.multicall(calldatas)
      }
    }

    // flush the left calldata
    if (0 < calldatas.length)  await this.multicall(calldatas);
  }

  protected async multicall(calldatas: CallWithHeight[]): Promise<CallWithHeight[]> {
    const requireSuccess = true
    let estimatedGas: BigNumber;
    try {
      estimatedGas = await this.state.multicall2Contract.estimateGas.tryAggregate(
        requireSuccess,
        convertToCalls(calldatas),
      )
    } catch (err) {
      // when the gas is higher than the block gas limit
      if (err.message.includes('gas required exceeds allowance')) {
        // ecursively call excluding the last element
        const remainingCalls = await this.multicall(calldatas.slice(0, -1));
        return [calldatas[calldatas.length-1], ...remainingCalls]
      } else {
        throw err
      }
    }
    const overrideOptions = {
      gasLimit: ~~(
        estimatedGas.toNumber() * (this.options.gasMultiplier || 1.0)
      ),
    }
    const tx = await this.state.multicall2Contract.tryAggregate(
      requireSuccess,
      convertToCalls(calldatas),
      overrideOptions
    )
    await tx.wait()
    this.logger.info(`relayer sent multicall: ${tx.hash}`)

    this.updateHighestCheckedL2(calldatas)
    this.metrics.numRelayedMessages.inc(calldatas.length)

    return []
  }

  protected updateHighestCheckedL2(calldatas: CallWithHeight[]): void {
    // assume the last element is the hightst, so doen't traverse all the element
    const highest = calldatas[calldatas.length-1].blockHeight
    // const highest = calldatas.reduce((maxCall, currentCall) => {
    //   if (!maxCall || currentCall.blockHeight > maxCall.blockHeight) {
    //     return currentCall;
    //   }
    //   return maxCall;
    // }).blockHeight
    this.state.highestCheckedL2 = highest
    this.logger.info(`updated highest checked L2: ${highest}`)
  }

}

if (require.main === module) {
  const service = new MessageRelayerService()
  service.run()
}
