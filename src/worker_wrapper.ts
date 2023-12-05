import { Worker } from 'worker_threads'
import { Logger, LogLevel } from '@eth-optimism/common-ts'
import {
  FinalizerMessage,
  L2toL1Message,
  WorkerInitData,
} from './finalize_worker'
import { Multicaller } from './multicaller'

export default class FinalizeWrorWrapper {
  private worker: Worker
  private logger: Logger

  constructor(
    logger: Logger,
    queueSize: number,
    pollingInterval: number,
    logLevel: LogLevel,
    addressManagerAddress: string,
    l1CrossDomainMessengerAddress: string,
    l1RpcEndpoint: string,
    l1ChainId: number,
    l1BlockTimeSeconds: number,
    finalizerPrivateKey: string,
    multicaller: Multicaller,
    messageHandler: (message: FinalizerMessage) => void,
    isTest: boolean = false
  ) {
    this.logger = logger

    const workerData: WorkerInitData = {
      queueSize,
      pollingInterval,
      logLevel,
      addressManagerAddress,
      l1CrossDomainMessengerAddress,
      l1RpcEndpoint,
      l1ChainId,
      l1BlockTimeSeconds,
      finalizerPrivateKey,
      multicallAddress: multicaller.contract.address,
      multicallTargetGas: multicaller.targetGas,
      gasMultiplier: multicaller.gasMultiplier,
    }

    this.worker = new Worker('./src/worker.js', { workerData })
    // this.worker = new Worker('./dist/src/finalize_worker.js', { workerData })

    this.worker.on('message', (message: FinalizerMessage) =>
      messageHandler(message)
    )

    this.worker.on('error', (error: Error) => {
      this.logger.error('worker error', error)
    })

    this.worker.on('exit', (code: number) => {
      if (code !== 0) {
        this.logger.error(`worker stopped with exit code: ${code}`)
      }
    })
  }

  terminate() {
    this.worker.terminate()
  }

  postMessage(messages: L2toL1Message[]) {
    this.worker.postMessage(messages)
  }
}
