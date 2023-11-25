import { Signer } from 'ethers'
import { Provider } from '@ethersproject/abstract-provider'
import { validators, Gauge, Counter } from '@eth-optimism/common-ts'
import { version } from '../package.json'

export type MessageRelayerOptions = {
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
  l2blockConfirmations?: number
  reorgSafetyDepth?: number
}

export const serviceName = 'Message_Relayer'
export const serviceVersion = version
export const serviceOptionsSpec: any = {
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
  l2blockConfirmations: {
    validator: validators.num,
    desc: 'Number of blocks to wait before checking for new messages',
    default: 8,
  },
  reorgSafetyDepth: {
    validator: validators.num,
    desc: 'Number of blocks addionally rolled back from detected heiht to ensure safety',
    default: 4,
  },
}

export const serviseMetricsSpec: any = {
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
}
