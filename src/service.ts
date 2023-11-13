/* Imports: External */
import { BigNumber, Contract, Signer } from 'ethers'
import {
  BaseServiceV2,
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

  protected async init(): Promise<void> {
  }

  protected async main(): Promise<void> {
  }

}