import { parentPort, workerData } from 'worker_threads'
import { ethers, Contract, Signer } from 'ethers'
import { Logger, LogLevel } from '@eth-optimism/common-ts'
import {
  CrossChainMessenger,
  CrossChainMessage,
  DEFAULT_L2_CONTRACT_ADDRESSES,
} from '@eth-optimism/sdk'
import IOasysL2OutputOracle from './contracts/IOasysL2OutputOracle.json'
import Finalizer from './finalizer'
import { Portal } from './portal'
import { TransactionManager } from './transaction-manager'
import { ZERO_ADDRESS } from './utils'

export type L2toL1Message = {
  blockHeight: number
  txHash: string
  message: CrossChainMessage
}

export type CloseMessage = {
  type: 'close'
  message: string
}

export type FinalizerMessage = {
  highestFinalizedL2: number
  finalizedTxs: number
}

export interface WorkerInitData {
  queuePath: string
  loopIntervalMs: number
  logLevel: LogLevel // for logger
  addressManagerAddress: string // for cross chain messenger
  l1CrossDomainMessengerAddress: string
  outputOracleAddress: string
  l1RpcEndpoint: string
  l2RpcEndpoint: string
  l1ChainId: number
  l2ChainId: number
  l1BlockTimeSeconds: number
  finalizerPrivateKey: string
  // for portal
  portalAddress: string
  multicallTargetGas: number
  gasMultiplier: number
  maxPendingTxs: number
}

const {
  queuePath,
  loopIntervalMs,
  logLevel,
  addressManagerAddress,
  l1CrossDomainMessengerAddress,
  outputOracleAddress,
  l1RpcEndpoint,
  l2RpcEndpoint,
  l1ChainId,
  l2ChainId,
  l1BlockTimeSeconds,
  finalizerPrivateKey,
  portalAddress,
  multicallTargetGas,
  gasMultiplier,
  maxPendingTxs,
} = workerData as WorkerInitData

const logger = new Logger({
  name: 'finalizer_worker',
  level: logLevel,
})

logger.info(`[finalize worker] workerData`, workerData)

const provider = new ethers.providers.JsonRpcProvider(l1RpcEndpoint)
const wallet = new ethers.Wallet(finalizerPrivateKey, provider)

const messenger = new CrossChainMessenger({
  l1SignerOrProvider: wallet,
  l2SignerOrProvider: new ethers.providers.JsonRpcProvider(l2RpcEndpoint),
  l1ChainId,
  l2ChainId,
  l1BlockTimeSeconds,
  contracts: {
    l1: {
      AddressManager: addressManagerAddress,
      L1CrossDomainMessenger: l1CrossDomainMessengerAddress,
      L1StandardBridge: ZERO_ADDRESS, // dummy address
      StateCommitmentChain: ZERO_ADDRESS, // dummy address
      CanonicalTransactionChain: ZERO_ADDRESS, // dummy address
      BondManager: ZERO_ADDRESS, // dummy address
      OptimismPortal: portalAddress,
      L2OutputOracle: outputOracleAddress,
    },
    l2: DEFAULT_L2_CONTRACT_ADDRESSES,
  },
  bedrock: true,
})

const outputOracle = new Contract(
  outputOracleAddress,
  IOasysL2OutputOracle.abi,
  wallet
)
let txmgr: TransactionManager
if (1 < maxPendingTxs) {
  // temporary fixed as 0
  // If you're not using txmgr, the confirmationNumber will be zero.
  // tx.wait() will not confirm any blocks.
  const confirmationNumber = 0
  txmgr = new TransactionManager(wallet, maxPendingTxs, confirmationNumber)
}
const finalizer = new Finalizer(
  queuePath,
  loopIntervalMs,
  logger,
  messenger,
  outputOracle,
  new Portal(portalAddress, wallet, multicallTargetGas, gasMultiplier),
  txmgr,
  (msg: FinalizerMessage) => {
    parentPort?.postMessage(msg)
  }
)

// Start finalizer
finalizer.start()

// Receive the proven txhash or close message from main thread
parentPort?.on('message', (messages: L2toL1Message[] | CloseMessage) => {
  if (messages instanceof Array) {
    // messages is L2toL1Message if it is an array
    finalizer.appendMessage(...messages)
  } else {
    // otherwise messages is CloseMessage
    stop()
  }
})

// Stop finalizer when main thread is closed
// NOTE: This close evet is not called when worker terminate is called
//       Thus we need CloseMessage to stop finalizer
parentPort.on('close', () => stop())

// Stop finalizer
const stop = async () => {
  logger.info('[finalize worker] stopping...')
  await finalizer.stop()
  logger.info('[finalize worker] stopped')
}
