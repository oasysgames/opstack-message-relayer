import { Worker } from 'worker_threads'
import { Logger, LogLevel } from '@eth-optimism/common-ts'
import {
  FinalizerMessage,
  L2toL1Message,
  WorkerInitData,
} from './finalize_worker'
import { Multicaller } from './multicaller'

export default class FinalizeWorkCreator {
  private worker: Worker
  private logger: Logger

  constructor(
    logger: Logger,
    queuePath: string,
    pollingInterval: number,
    logLevel: LogLevel,
    addressManagerAddress: string,
    l1CrossDomainMessengerAddress: string,
    portalAddress: string,
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
      multicallTargetGas: multicaller.targetGas,
      gasMultiplier: multicaller.gasMultiplier,
    }

    this.worker = new Worker('./src/worker.js', { workerData })

    this.worker.on('message', (message: FinalizerMessage) => {
      this.logger.info('[worker] received message', message)
      messageHandler(message)
    })

    this.worker.on('error', (err: Error) => {
      this.logger.error(`[worker] worker error: ${err.message}`)
    })

    this.worker.on('exit', (code: number) => {
      if (code !== 0) {
        this.logger.error(`[worker] worker stopped with exit code: ${code}`)
      }
    })
  }

  terminate() {
    this.worker.terminate()
  }

  postMessage(messages: L2toL1Message[]) {
    this.logger.info(`[worker] posting messages: ${messages.length}`)
    this.worker.postMessage(messages)
  }
}
