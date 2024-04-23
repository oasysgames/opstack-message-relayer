import { PopulatedTransaction, Signer, Wallet, providers } from 'ethers'
import {
  TransactionRequest,
  TransactionResponse,
  TransactionReceipt,
} from '@ethersproject/abstract-provider'
import { BigNumber } from 'ethers'
import FixedSizeQueue from './queue-mem'
import { CallWithMeta } from './multicaller'
import { WithdrawMsgWithMeta } from './portal'

const MAX_RESEND_LIMIT = 10

// Define the type of tx confirmed subscriber
type TxConfirmedSubscriber = (tx: TransactionReceipt) => void

export type TransactionManagerMeta = PopulatedTransaction & {
  originData: CallWithMeta[] | WithdrawMsgWithMeta[]
}

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
  private waitingTransaction: FixedSizeQueue<TransactionManagerMeta>
  /**
   * The fixed size of the pending transaction - the transaction that has been sent but not yet confirmed
   */
  private pendingTransaction: Set<string>

  private subscribers: TxConfirmedSubscriber[] = []

  /**
   * The running state of the transaction manager
   */
  private running: boolean
  private stopping: boolean
  private maxPendingTxs: number
  private pollingTimeout: NodeJS.Timeout
  private confirmationNumber: number
  private callbackSuccess: (
    calls: CallWithMeta[] | WithdrawMsgWithMeta[]
  ) => void
  private callbackError: (calls: CallWithMeta[] | WithdrawMsgWithMeta[]) => void

  constructor(
    wallet: Signer,
    maxPendingTxs: number | undefined,
    confirmationNumber?: number | undefined
  ) {
    if (maxPendingTxs && maxPendingTxs <= 1)
      throw new Error('maxPendingTxs must be greater than 1')
    this.wallet = wallet
    this.waitingTransaction = new FixedSizeQueue<TransactionManagerMeta>(
      maxPendingTxs * 10
    )
    this.pendingTransaction = new Set<string>()
    this.running = false
    this.maxPendingTxs = maxPendingTxs || 1
    this.stopping = false
    this.confirmationNumber = confirmationNumber ?? 1
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
  async requestLatestNonce() {
    return await this.wallet.provider.getTransactionCount(
      this.wallet.getAddress(),
      'latest'
    )
  }

  async requestPendingNonce() {
    return await this.wallet.provider.getTransactionCount(
      this.wallet.getAddress(),
      'pending'
    )
  }

  getNonce() {
    return this.nonce
  }

  /**
   * Get the current stats of the queue
   * @returns
   */
  getCurrentStats() {
    return {
      waitingSize: this.waitingTransaction.count,
      pendingSize: this.pendingTransaction.size,
    }
  }

  /**
   * Enqueue the transaction to waiting list
   * @param tx Populated tx, maybe derived from method populate from contract instance
   * @returns Void when success
   * @throws {Error}
   * Thrown if the waiting list is full
   */
  async enqueueTransaction(
    tx: TransactionManagerMeta,
    callbackSuccess: (
      calls: CallWithMeta[] | WithdrawMsgWithMeta[]
    ) => void | null,
    callbackError: (
      calls: CallWithMeta[] | WithdrawMsgWithMeta[]
    ) => void | null
  ) {
    // wait until queue is not full by periodically check the queue
    while (this.waitingTransaction.isFull()) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    // enqueue the tx to the waiting list
    this.waitingTransaction.enqueue(tx)
    this.callbackSuccess = callbackSuccess
    this.callbackError = callbackError
    // start the transaction manager if not running
    if (!this.running) this.start()
  }

  /**
   * Send the transaction in the waiting list, append it into pendingList
   */
  private async sendTransactions() {
    while (this.pendingTransaction.size < this.maxPendingTxs) {
      if (this.waitingTransaction.isEmpty()) break
      const txData = this.waitingTransaction.dequeue()
      const originData = txData.originData
      delete txData.originData

      try {
        // if nonce is 0, request the latest nonce
        if (this.nonce === 0) this.nonce = await this.requestLatestNonce()
        const tx = await this.publishTx({
          ...txData,
          nonce: this.nonce,
        })
        this.callbackSuccess(originData)
        this.nonce++
        this.pendingTransaction.add(tx.hash)
      } catch (error) {
        this.callbackError(originData)
      }
    }
  }

  private async publishTx(
    tx: TransactionRequest,
    bumpFeesImmediately: boolean = false
  ): Promise<TransactionResponse> {
    let res = undefined
    let counter = 0
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
          e.message.includes('transaction is underprice')
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
    if (tx.gasPrice) {
      tx.gasPrice = (tx.gasPrice as BigNumber).mul(1.1)
    }
    if (tx.maxPriorityFeePerGas) {
      tx.maxPriorityFeePerGas = (tx.maxPriorityFeePerGas as BigNumber).mul(1.1)
    }
    if (tx.maxFeePerGas) {
      tx.maxFeePerGas = (tx.maxFeePerGas as BigNumber).mul(1.1)
    }
    return tx
  }

  /**
   * Remove the pending transaction that has been confirmed
   */
  async removePendingTxs() {
    const txs = Array.from(this.pendingTransaction)
    const currentBlock = await this.wallet.provider.getBlockNumber()
    const receipts = await Promise.all(
      txs.map((tx) => this.wallet.provider.getTransactionReceipt(tx))
    )
    receipts
      .filter(
        (receipt) =>
          receipt.blockNumber + this.confirmationNumber <= currentBlock
      )
      .forEach((tx) => {
        // notify the subscriber
        this.notifySubscribers(tx)
        // remove the tx from pending list
        this.pendingTransaction.delete(tx.transactionHash)
      })
  }

  async stop() {
    this.stopping = true
    // wait until loop is stopped
    while (this.running) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
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
        (this.pendingTransaction.size === 0 &&
          this.waitingTransaction.isEmpty()) ||
        this.stopping
      )
    }

    while (!exit()) {
      // evic pending txs
      await this.removePendingTxs()
      // send txs on the waiting list
      await this.sendTransactions()
    }

    this.running = false
  }

  addSubscriber(subscriber: TxConfirmedSubscriber) {
    this.subscribers.push(subscriber)
  }

  notifySubscribers(tx: TransactionReceipt) {
    this.subscribers.forEach((subscriber) => subscriber(tx))
  }
}
