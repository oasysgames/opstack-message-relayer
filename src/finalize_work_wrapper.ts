import { Worker } from 'worker_threads'
import { Logger } from '@eth-optimism/common-ts'
import { CrossChainMessenger } from '@eth-optimism/sdk'
import { Multicaller } from './multicaller'
import { FinalizerMessage, L2toL1Message } from './finalize_worker'

export default class FinalizeWrorWrapper {
  private worker: Worker

  constructor(
    queueSize: number,
    logger: Logger,
    pollingInterval: number,
    messenger: CrossChainMessenger,
    multicaller: Multicaller,
    messageHandler: (message: FinalizerMessage) => void
  ) {
    this.worker = new Worker('./finalize_worker.ts', {
      workerData: {
        queueSize,
        logger,
        pollingInterval,
        messenger,
        multicaller,
      },
    })

    this.worker.on('message', (message: FinalizerMessage) =>
      messageHandler(message)
    )
  }

  terminate() {
    this.worker.terminate()
  }

  postMessage(messages: L2toL1Message[]) {
    this.worker.postMessage(messages)
  }
}
