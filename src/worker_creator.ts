import { Worker } from 'worker_threads'
import { Logger } from '@eth-optimism/common-ts'
import type {
  FinalizerMessage,
  L2toL1Message,
  CloseMessage,
  WorkerInitData,
} from './finalize_worker'
import { Multicaller } from './multicaller'
import { DeepPartial, OEContractsLike } from '@eth-optimism/sdk'

export default class FinalizeWorkCreator {
  private worker: Worker
  private logger: Logger
  private terminating = false

  constructor(
    opts: Omit<
      WorkerInitData,
      'contractsJSON' | 'multicallTargetGas' | 'gasMultiplier'
    > & {
      logger: Logger
      contracts: DeepPartial<OEContractsLike>
      multicaller: Multicaller
      messageHandler: (message: FinalizerMessage) => void
      exitHandler: (code: number) => void
    }
  ) {
    this.logger = opts.logger

    // Note: Passing non-primitive values(number or string)
    // to the worker will cause it to crash.
    const workerData: WorkerInitData = {
      queuePath: opts.queuePath,
      loopIntervalMs: opts.loopIntervalMs,
      logLevel: opts.logLevel,
      contractsJSON: JSON.stringify(opts.contracts),
      l1RpcEndpoint: opts.l1RpcEndpoint,
      l2RpcEndpoint: opts.l2RpcEndpoint,
      l1ChainId: opts.l1ChainId,
      l2ChainId: opts.l2ChainId,
      l1BlockTimeSeconds: opts.l1BlockTimeSeconds,
      finalizerPrivateKey: opts.finalizerPrivateKey,
      multicallTargetGas: opts.multicaller.targetGas,
      gasMultiplier: opts.multicaller.gasMultiplier,
      maxPendingTxs: opts.maxPendingTxs,
    }

    this.worker = new Worker('./src/worker.js', { workerData })

    this.worker.on('message', (message: FinalizerMessage) => {
      this.logger.info('[worker] received message', message)
      opts.messageHandler(message)
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
      opts.exitHandler(code)
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
