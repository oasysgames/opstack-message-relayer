import { Signer } from 'ethers'
import { Provider } from '@ethersproject/abstract-provider'
import { validators, Gauge, Counter } from '@eth-optimism/common-ts'
import { version } from '../package.json'

export type MessageRelayerOptions = {
  l1RpcProvider: Provider
  l2RpcProvider: Provider
  proverPrivateKey: Signer
  fromL2TransactionIndex?: number
  addressManager?: string
  l1CrossDomainMessenger?: string
  portalAddress?: string
  OutputOracle?: string
  multicallAddress?: string
  multicallTargetGas?: number
  receiptTimeout?: number
  gasMultiplier?: number
  depositConfirmationBlocks?: number
  l1BlockTimeSeconds?: number
  stateFilePath?: string
  // l2blockConfirmations?: number
  reorgSafetyDepth?: number
  queuePath?: string
  finalizerPrivateKey: string
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
  proverPrivateKey: {
    validator: validators.wallet,
    desc: 'Private key of the prover. Should not be the same as the finalizerPrivateKey.',
  },
  addressManager: {
    validator: validators.str,
    desc: 'Address of the Lib_AddressManager on Layer1.',
  },
  l1CrossDomainMessenger: {
    validator: validators.str,
    desc: 'Address of the Proxy__OVM_L1CrossDomainMessenger on Layer1.',
  },
  portalAddress: {
    validator: validators.str,
    desc: 'Address of the OasysPortal on Layer1.',
  },
  OutputOracle: {
    validator: validators.str,
    desc: 'Address of the L2OutputOracle on Layer1.',
  },
  multicallAddress: {
    validator: validators.str,
    desc: 'Address of the multicall2 on Layer1.',
  },
  multicallTargetGas: {
    validator: validators.num,
    desc: 'gas target for multicall contract when the relay',
    default: 3000000,
  },
  gasMultiplier: {
    validator: validators.num,
    desc: 'Gas limit multiplier.',
    default: 1.01,
  },
  l1BlockTimeSeconds: {
    validator: validators.num,
    desc: 'Block time in seconds for the L1 chain.',
    default: 15,
  },
  depositConfirmationBlocks: {
    validator: validators.num,
    desc: 'Blocks before a deposit is confirmed',
    default: 8,
  },
  reorgSafetyDepth: {
    validator: validators.num,
    desc: 'Number of blocks addionally rolled back from detected height to ensure safety',
    default: 4,
  },
  stateFilePath: {
    validator: validators.str,
    desc: 'the file of state file whitch holds the last state',
    default: './state.json',
  },
  fromL2TransactionIndex: {
    validator: validators.num,
    desc: 'Index of the first L2 transaction to start processing from.',
    default: 0,
  },
  queuePath: {
    validator: validators.str,
    desc: 'Number of messages to queue before rejecting new messages',
    default: './.queuestore',
  },
  finalizerPrivateKey: {
    validator: validators.str,
    desc: 'Private key of finalizer. Set `messageRelayer` key of OasysPortal to use instant verifier',
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
  numProvenMessages: {
    type: Counter,
    desc: 'Number of messages proven by the service',
  },
  numFinalizedMessages: {
    type: Counter,
    desc: 'Number of messages finalized by the service',
  },
}
