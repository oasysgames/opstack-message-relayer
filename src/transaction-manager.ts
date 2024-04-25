import { PopulatedTransaction, Signer } from 'ethers'
import {
  TransactionRequest,
  TransactionResponse,
  TransactionReceipt,
} from '@ethersproject/abstract-provider'
import { BigNumber } from 'ethers'
import FixedSizeQueue from './queue-mem'

const MAX_RESEND_LIMIT = 10

export type ManagingTx = {
  populated: PopulatedTransaction
  res?: TransactionResponse
  receipt?: TransactionReceipt
  meta?: any
  err?: Error
}

type Subscriber = (txs: ManagingTx[]) => void

export class TransactionManager {
  /**
   * The wallet that will be used to sign and perform the transaction
   */
  private wallet: Signer
  /**
   * The nonce of the wallet, will be managed internally
   */
  private nonce: number = 0
  /**
   * The fixed size of waiting transaction - the transaction that has not been sent yet
   */
  private waitingTxs: FixedSizeQueue<ManagingTx>

  private unconfirmedList: ManagingTx[] = []
  private subscribers: Subscriber[] = []
  private running: boolean
  private stopping: boolean
  private maxPendingTxs: number
  private confirmationNumber: number
  private intervalMs: number

  constructor(
    wallet: Signer,
    maxPendingTxs: number = 1,
    confirmationNumber: number = 1,
    intervalMs: number = 500
  ) {
    if (maxPendingTxs < 1)
      throw new Error('maxPendingTxs must be greater than 0')
    if (confirmationNumber < 0)
      throw new Error('confirmationNumber must be equal of greater than 0')
    this.wallet = wallet
    this.running = false
    this.maxPendingTxs = maxPendingTxs
    this.stopping = false
    this.confirmationNumber = confirmationNumber
    this.intervalMs = intervalMs
    this.waitingTxs = new FixedSizeQueue<ManagingTx>(this.maxPendingTxs)
  }

  /**
   * Get the address that perform transaction, or the address of the wallet
   * @returns Address of the wallet
   */
  async getFromAddress() {
    return await this.wallet.getAddress()
  }

  async resetNonce(n: number = 0) {
    if (n < 0) throw new Error('Nonce must be greater than 0')
    if (n === 0) this.nonce = await this.requestLatestNonce()
    this.nonce = n
  }

  /**
   *
   * @returns Get the current nonce of the wallet
   */
  async requestLatestNonce(): Promise<number> {
    return await this.wallet.provider.getTransactionCount(
      this.wallet.getAddress(),
      'latest'
    )
  }

  async requestPendingNonce(): Promise<number> {
    return await this.wallet.provider.getTransactionCount(
      this.wallet.getAddress(),
      'pending'
    )
  }

  getNonce(): number {
    return this.nonce
  }

  addSubscriber(subscriber: Subscriber) {
    this.subscribers.push(subscriber)
  }

  notifySubscribers(txs: ManagingTx[]) {
    this.subscribers.forEach((subscriber) => subscriber(txs))
  }

  pendingIsFull(): boolean {
    return (
      this.waitingTxs.count + this.unconfirmedList.length >= this.maxPendingTxs
    )
  }

  lengthOfWaitngTxs(): number {
    return this.waitingTxs.count
  }

  getUnconfirmedTransactions(): ManagingTx[] {
    return this.unconfirmedList
  }

  isRunning(): boolean {
    return this.running
  }

  async enqueueTransaction(tx: ManagingTx): Promise<boolean> {
    // wait until confirmed list size is less than max pending txs
    while (this.pendingIsFull()) {
      await new Promise((resolve) => setTimeout(resolve, this.intervalMs))
    }
    // enqueue the tx to the waiting list
    this.waitingTxs.enqueue(tx)
    // start the transaction manager if not running
    if (!this.running) this.start()
    return true
  }

  /**
   * Send the transaction in the waiting list, append it into pendingList
   */
  private async sendTransactions() {
    while (!this.waitingTxs.isEmpty()) {
      const item = this.waitingTxs.peek()
      try {
        // if nonce is 0, request the latest nonce
        if (this.nonce === 0) this.nonce = await this.requestLatestNonce()
        item.res = await this.publishTx({
          ...item.populated,
          nonce: this.nonce,
        })
        this.unconfirmedList.push(item)
        this.nonce++
      } catch (e) {
        item.err = e
        this.notifySubscribers([item])
      }
      // evict the head from queue
      const eviced = this.waitingTxs.dequeue()
      // assert the evicted item is the same as the current item
      // if (item.populated.data !== eviced.populated.data) {
      //   throw new Error(`data mismatch: ${item.populated.data} != ${eviced.populated.data}`)
      // }
    }
  }

  public async publishTx(
    tx: TransactionRequest,
    bumpFeesImmediately: boolean = false
  ): Promise<TransactionResponse> {
    let res = undefined
    let counter = 0

    // fill the maxFeePerGas, maxPriorityFeePerGas, and gasPrice
    tx = await this.wallet.populateTransaction(tx)

    while (true) {
      if (counter >= MAX_RESEND_LIMIT) {
        throw new Error(
          `failed to publish tx: max resend limit(${MAX_RESEND_LIMIT}) reached`
        )
      }

      try {
        if (bumpFeesImmediately) {
          tx = this.increaseGasPrice(tx)
        }
        res = await this.wallet.sendTransaction(tx)
        break
      } catch (e) {
        if (
          e.message.includes('transaction replacement is underpriced') ||
          e.message.includes('transaction is underprice') ||
          e.message.includes('fee too low') ||
          e.message.includes('Known transaction')
        ) {
          // this case happen when the tx is already sent before
          // increase the gas price at next loop
        } else {
          // othewise, throw error
          throw new Error(`failed to publish tx: ${e.message}`)
        }
      }
      bumpFeesImmediately = true // bump fees next loop
      counter++
    }
    return res
  }

  increaseGasPrice(tx: TransactionRequest): TransactionRequest {
    const multiplier = BigNumber.from(11)
    const divisor = BigNumber.from(10)

    if (tx.gasPrice) {
      tx.gasPrice = (tx.gasPrice as BigNumber).mul(multiplier).div(divisor)
    }
    if (tx.maxPriorityFeePerGas) {
      tx.maxPriorityFeePerGas = (tx.maxPriorityFeePerGas as BigNumber)
        .mul(multiplier)
        .div(divisor)
    }
    if (tx.maxFeePerGas) {
      tx.maxFeePerGas = (tx.maxFeePerGas as BigNumber)
        .mul(multiplier)
        .div(divisor)
    }
    return tx
  }

  async confirmTxs() {
    const currentBlock = await this.wallet.provider.getBlockNumber()
    const confirmedList: ManagingTx[] = []
    for (let i = 0; i < this.unconfirmedList.length; i++) {
      // get receipt if not exists
      if (!this.unconfirmedList[i].receipt) {
        const receipt = await this.wallet.provider.getTransactionReceipt(
          this.unconfirmedList[i].res.hash
        )
        // skip if receipt is null
        if (!receipt) continue
        this.unconfirmedList[i].receipt = receipt
        // fill error if receipt status is fail(status = 0)
        if (receipt.status === 0) {
          this.unconfirmedList[i].err = new Error(
            `transaction failed, tx: ${receipt.transactionHash}`
          )
        }
      }
      // make sure current confirmation depth has been reached
      if (
        this.confirmationNumber <=
        currentBlock - this.unconfirmedList[i].receipt.blockNumber
      ) {
        confirmedList.push(this.unconfirmedList[i])
      }
    }
    if (0 < confirmedList.length) {
      // notify the subscribers
      this.notifySubscribers(confirmedList)
      // remove the confirmed txs from the unconfirmed list
      this.unconfirmedList = this.unconfirmedList.filter(
        (item) => !confirmedList.includes(item)
      )
    }
  }

  async stop() {
    this.stopping = true
    // wait until loop is stopped
    while (this.running) {
      await new Promise((resolve) => setTimeout(resolve, this.intervalMs))
    }
  }

  private async start() {
    if (this.running) return
    this.running = true

    // exit loop if
    // - pending txs is empty and waiting txs is empty
    // - or stopping is true
    const exit = (): boolean => {
      return (
        (this.waitingTxs.isEmpty() && this.unconfirmedList.length === 0) ||
        this.stopping
      )
    }

    while (!exit()) {
      await new Promise((resolve: any) =>
        setTimeout(async () => {
          // send txs on the waiting list
          await this.sendTransactions()
          // confirm the txs
          await this.confirmTxs()
          resolve()
        }, this.intervalMs)
      )
    }

    this.running = false
  }
}
