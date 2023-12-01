import { parentPort, workerData } from 'worker_threads'
import { Logger } from '@eth-optimism/common-ts'
import { CrossChainMessenger, CrossChainMessage } from '@eth-optimism/sdk'
import Finalizer from './finalizer'
import { Multicaller } from './multicaller'

export type L2toL1Message = {
  blockHeight: number
  txHash: string
  message: CrossChainMessage
}

export type FinalizerMessage = {
  highestFinalizedL2: number
}

interface InitData {
  queueSize: number
  logger: Logger
  pollingInterval: number
  messenger: CrossChainMessenger
  multicaller: Multicaller
}

const { queueSize, logger, pollingInterval, messenger, multicaller } =
  workerData as InitData
const finalizer = new Finalizer(
  queueSize,
  logger,
  pollingInterval,
  messenger,
  multicaller
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
  finalizer.appendMessage(...messages)
})

// Stop finalizer
parentPort.on('close', () => {
  finalizer.stop()
  clearInterval(finalizedHeightNotifyer)
})
