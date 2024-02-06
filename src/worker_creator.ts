import { Worker } from 'worker_threads'
import { Logger, LogLevel } from '@eth-optimism/common-ts'
import {
  FinalizerMessage,
  L2toL1Message,
  CloseMessage,
  WorkerInitData,
} from './finalize_worker'
import { Multicaller } from './multicaller'

export default class FinalizeWorkCreator {
  private worker: Worker
  private logger: Logger
  private terminating = false

  constructor(
    logger: Logger,
    queuePath: string,
    loopIntervalMs: number,
    logLevel: LogLevel,
    addressManagerAddress: string,
    l1CrossDomainMessengerAddress: string,
    outputOracleAddress: string,
    portalAddress: string,
    l1RpcEndpoint: string,
    l2RpcEndpoint: string,
    l1ChainId: number,
    l2ChainId: number,
    l1BlockTimeSeconds: number,
    finalizerPrivateKey: string,
    multicaller: Multicaller,
    messageHandler: (message: FinalizerMessage) => void,
    exitHandler: (code: number) => void
  ) {
    this.logger = logger

    const workerData: WorkerInitData = {
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
      multicallTargetGas: multicaller.targetGas,
      gasMultiplier: multicaller.gasMultiplier,
    }

    this.worker = new Worker('./src/worker.js', { workerData })

    this.worker.on('message', (message: FinalizerMessage) => {
      this.logger.info('[worker] received message', message)
      messageHandler(message)
    })

    this.worker.on('error', (err: Error) => {
      this.logger.error(
        `[worker] worker error: ${err.message}, stack: ${err.stack}`
      )
    })

    this.worker.on('exit', (code: number) => {
      if (this.terminating) return
      if (code !== 0) {
        this.logger.error(`[worker] worker stopped with exit code: ${code}`)
      }
      exitHandler(code)
    })
  }

  terminate() {
    this.terminating = true
    this.worker.terminate()
  }

  postMessage(messages: L2toL1Message[] | CloseMessage) {
    if (messages instanceof Array) {
      // messages is L2toL1Message if it is an array
      this.logger.info(`[worker] posting messages: ${messages.length}`)
      this.worker.postMessage(messages as L2toL1Message[])
    } else {
      // otherwise messages is CloseMessage
      this.logger.info(`[worker] posting close message: ${messages.message}`)
      this.worker.postMessage(messages as CloseMessage)
    }
  }
}
