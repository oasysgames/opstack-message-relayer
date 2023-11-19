import { parentPort, workerData } from 'worker_threads'
import { Logger } from '@eth-optimism/common-ts'
import Queue from './queue'

class Finalizer {
  private queue: Queue<string>
  private logger: Logger
  private pollingInterval: number
  private interval: NodeJS.Timeout | undefined

  constructor(logger: Logger, pollingInterval: number) {
    this.queue = new Queue<string>(1024)
    this.logger = logger
    this.pollingInterval = pollingInterval
  }

  public start(): void {
    this.interval = setInterval(() => {
      while (this.queue.getSize() !== 0) {
        const txhash = this.queue.head()
      }

      // if (txhash) {
      //   this.logger.debug(`[finalizer] received txhash: ${txhash}`);
      // }
    }, this.pollingInterval)
  }

  public stop(): void {
    this.logger.debug(`[finalizer] stopping...`)
    clearInterval(this.interval)
    this.logger.debug(`[finalizer] stopped`)
  }

  public addTxhash(txhash: string): void {
    this.queue.push(txhash)
    this.logger.debug(`[finalizer] received txhash: ${txhash}`)
  }
}

interface InitData {
  logger: Logger
  pollingInterval: number
}

const { logger, pollingInterval } = workerData as InitData
const finalizer = new Finalizer(logger, pollingInterval)

// Start finalizer
finalizer.start()

// Receive the proven txhash
parentPort?.on('message', (message: { txhash: string }) => {
  finalizer.addTxhash(message.txhash)
})

// Stop finalizer
parentPort.on('close', () => {
  finalizer.stop()
})
