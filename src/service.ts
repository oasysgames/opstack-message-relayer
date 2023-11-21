import { promises as fs } from 'fs'
import * as path from 'path'
import { BigNumber, Contract, Signer } from 'ethers'
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
import { Multicaller, CallWithHeight } from './multicaller'

type MessageRelayerOptions = {
  l1RpcProvider: Provider
  l2RpcProvider: Provider
  l1Wallet: Signer
  fromL2TransactionIndex?: number
  addressManager?: string
  multicall?: string
  multicallTargetGas?: number
  l1CrossDomainMessenger?: string
  l1StandardBridge?: string
  l2StandardBridge?: string
  stateCommitmentChain?: string
  canonicalTransactionChain?: string
  bondManager?: string
  pollInterval?: number
  receiptTimeout?: number
  gasMultiplier?: number
  depositConfirmationBlocks?: number
  l1BlockTimeSeconds?: number
  stateFilePath?: string
}

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
        multicall: {
          validator: validators.str,
          desc: 'Address of the multicall2 on Layer1.',
        },
        multicallTargetGas: {
          validator: validators.num,
          desc: 'gas target for multicall contract when the relay',
          default: 1500000,
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
        stateFilePath: {
          validator: validators.str,
          desc: 'the file of state file whitch holds the last state',
          default: '~/.message-relayer/state.json',
        },
      },
      metricsSpec: {
        highestKnownL2: {
          type: Gauge,
          desc: 'Highest known L2 height',
        },
        highestProvenL2: {
          type: Gauge,
          desc: 'Highest L2 tx that has been proven',
        },
        highestFinalizedL2: {
          type: Gauge,
          desc: 'Highest L2 tx that has been finalized',
        },
        numRelayedMessages: {
          type: Counter,
          desc: 'Number of messages relayed by the service',
        },
      },
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
  }

  async routes(router: ExpressRouter): Promise<void> {
    router.get('/status', async (req: any, res: any) => {
      return res.status(200).json({
        highestProvenL2: this.state.highestProvenL2,
        highestKnownL2: this.state.highestKnownL2,
      })
    })
  }

  protected async main(): Promise<void> {
    await this.handleMultipleBlock()
  }

  // override to write the last state
  public async stop(): Promise<void> {
    await this.writeStateToFile(this.state)
    await super.stop()
  }

  protected async handleMultipleBlock(): Promise<void> {
    const latest = await this.messenger.l2Provider.getBlockNumber()

    if (latest === this.state.highestKnownL2) {
      return
    } else if (latest < this.state.highestKnownL2) {
      // Reorg detected
    }

    // update latest known L2 height
    this.state.highestKnownL2 = latest
    this.metrics.highestKnownL2.set(this.state.highestKnownL2)
    this.logger.debug(`highestKnownL2: ${this.state.highestKnownL2}`)

    let calldatas: CallWithHeight[] = []
    const target = this.messenger.contracts.l1.OptimismPortal.target
    const updateHeightCallback = (hash: string, calls: CallWithHeight[]) => {
      this.logger.info(`relayer sent multicall: ${hash}`)
      if (this.updateHighestCheckedL2(calls)) {
        this.metrics.numRelayedMessages.inc(calls.length)
      }
    }
    // iterate block from the highest finalized at the start of the service
    const initalHeight = (): number => {
      if (this.initalIteration) {
        this.initalIteration = false
        return this.state.highestFinalizedL2
      }
      return this.state.highestProvenL2
    }

    for (let h = initalHeight(); h < this.state.highestKnownL2; h++) {
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
        calldatas.push({ target, callData, blockHeight: block.number })

        // go next when lower than multicall target gas
        if (!this.multicaller?.isOvertargetGas(calldatas.length)) {
          continue
        }

        // send multicall, then update the checked L2 height
        // return the remaining callcatas, those are failed due to gas limit
        calldatas = await this.multicaller?.multicall(
          calldatas,
          updateHeightCallback
        )
      }
    }

    // flush the left calldata
    if (0 < calldatas.length)
      await this.multicaller?.multicall(calldatas, updateHeightCallback)
  }

  protected updateHighestCheckedL2(calldatas: CallWithHeight[]): boolean {
    // assume the last element is the hightst, so doen't traverse all the element
    let highest = calldatas[calldatas.length - 1].blockHeight
    // const highest = calldatas.reduce((maxCall, currentCall) => {
    //   if (!maxCall || currentCall.blockHeight > maxCall.blockHeight) {
    //     return currentCall;
    //   }
    //   return maxCall;
    // }).blockHeight
    if (0 < highest) highest -= 1 // subtract `1` to assure the all transaction in block is finalized
    if (highest <= this.state.highestProvenL2) return false

    this.state.highestProvenL2 = highest
    this.metrics.highestProvenL2.set(this.state.highestProvenL2)
    this.logger.debug(`highestProvenL2: ${this.state.highestProvenL2}`)
    return true
  }

  protected async readStateFromFile(): Promise<MessageRelayerState> {
    try {
      const data = await fs.readFile(this.options.stateFilePath, 'utf-8')
      const json = JSON.parse(data)
      return {
        highestKnownL2: json.highestKnownL2,
        highestProvenL2: json.highestProvenL2,
        highestFinalizedL2: json.highestFinalizedL2,
      }
    } catch (err) {
      if (err.code === 'ENOENT') {
        // return nothing, if state file not found
        return { highestKnownL2: 0, highestProvenL2: 0, highestFinalizedL2: 0 }
      }
      throw new Error(
        `failed to read state file: ${this.options.stateFilePath}, err: ${err.message}`
      )
    }
  }

  protected async writeStateToFile(state: MessageRelayerState): Promise<void> {
    const dir = path.dirname(this.options.stateFilePath)

    try {
      await fs.access(dir)
    } catch (error) {
      // create dir if not exists
      await fs.mkdir(dir, { recursive: true })
    }

    const data = JSON.stringify(state, null, 2)
    await fs.writeFile(this.options.stateFilePath, data, 'utf-8')
  }
}

if (require.main === module) {
  const service = new MessageRelayerService()
  service.run()
}
