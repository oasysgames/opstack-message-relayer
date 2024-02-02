import { parentPort, workerData } from 'worker_threads'
import { ethers } from 'ethers'
import { Logger, LogLevel } from '@eth-optimism/common-ts'
import {
  CrossChainMessenger,
  CrossChainMessage,
  DEFAULT_L2_CONTRACT_ADDRESSES,
} from '@eth-optimism/sdk'
import Finalizer from './finalizer'
import { Portal } from './portal'
import { ZERO_ADDRESS } from './utils'
// import { MockCrossChain } from '../test/mocks'
// import Counter from './contracts/Counter.json'

export type L2toL1Message = {
  blockHeight: number
  txHash: string
  message: CrossChainMessage
}

export type FinalizerMessage = {
  highestFinalizedL2: number
}

export interface WorkerInitData {
  queuePath: string
  pollingInterval: number
  // for logger
  logLevel: LogLevel
  // for cross chain messenger
  addressManagerAddress: string
  l1CrossDomainMessengerAddress: string
  l1RpcEndpoint: string
  l1ChainId: number
  l1BlockTimeSeconds: number
  finalizerPrivateKey: string
  // for portal
  portalAddress: string
  multicallTargetGas: number
  gasMultiplier: number
}

const {
  queuePath,
  pollingInterval,
  logLevel,
  addressManagerAddress,
  l1CrossDomainMessengerAddress,
  l1RpcEndpoint,
  l1ChainId,
  l1BlockTimeSeconds,
  finalizerPrivateKey,
  portalAddress,
  multicallTargetGas,
  gasMultiplier,
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
  l2SignerOrProvider: wallet, // dummy
  l1ChainId,
  l2ChainId: 0, // dummy
  l1BlockTimeSeconds,
  contracts: {
    l1: {
      AddressManager: addressManagerAddress,
      L1CrossDomainMessenger: l1CrossDomainMessengerAddress,
      L1StandardBridge: ZERO_ADDRESS, // dummy address
      StateCommitmentChain: ZERO_ADDRESS, // dummy address
      CanonicalTransactionChain: ZERO_ADDRESS, // dummy address
      BondManager: ZERO_ADDRESS, // dummy address
      OptimismPortal: ZERO_ADDRESS, // dummy address
      L2OutputOracle: ZERO_ADDRESS, // dummy address
    },
    l2: DEFAULT_L2_CONTRACT_ADDRESSES,
  },
  bedrock: true,
})

// if (isTest) {
//   // @ts-ignore
//   messenger = new MockCrossChain()
//   const contract = new Contract(l1CrossDomainMessengerAddress, Counter.abi, wallet)
//   // @ts-ignore
//   messenger.init(contract)
// }

const finalizer = new Finalizer(
  queuePath,
  pollingInterval,
  logger,
  messenger,
  new Portal(portalAddress, wallet, multicallTargetGas, gasMultiplier)
)

// Start finalizer
finalizer.start()

// Notify finalized height to main thread
const lastFinalizedL2 = finalizer.highestFinalizedL2
const finalizedHeightNotifyer = setInterval(() => {
  if (finalizer.highestFinalizedL2 === lastFinalizedL2) return
  parentPort?.postMessage({
    highestFinalizedL2: finalizer.highestFinalizedL2,
  } as FinalizerMessage)
}, pollingInterval)

// Receive the proven txhash
parentPort?.on('message', (messages: L2toL1Message[]) => {
  console.log('parentPort', messages)
  finalizer.appendMessage(...messages)
})

// Stop finalizer
parentPort.on('close', () => {
  finalizer.stop()
  clearInterval(finalizedHeightNotifyer)
})
