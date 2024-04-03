import { PopulatedTransaction, Signer, Wallet, providers } from 'ethers'
import FixedSizeQueue from './queue-mem'
export class TransactionManager {
  /**
   * The wallet that will be used to sign and perform the transaction
   */
  private wallet: Signer
  /**
   * The nonce of the wallet, will be managed internally
   */
  private nonce: number | undefined
  /**
   * The fixed size of waiting transaction - the transaction that has not been sent yet
   */
  private waitingTransaction: FixedSizeQueue<PopulatedTransaction>
  /**
   * The fixed size of the pending transaction - the transaction that has been sent but not yet confirmed
   */
  private pendingTransaction: Set<string>
  /**
   * The running state of the transaction manager
   */
  private running: boolean
  private maxPendingTxs: number
  private pollingTimeout: NodeJS.Timeout
  constructor(wallet: Signer, maxPendingTxs: number) {
    this.wallet = wallet
    this.waitingTransaction = new FixedSizeQueue<PopulatedTransaction>(500)
    this.pendingTransaction = new Set<string>()
    this.running = false
    this.maxPendingTxs = maxPendingTxs
  }

  /**
   * Init state of the transaction manager, should be called after constructor
   */
  async init() {
    this.nonce = await this.wallet.provider.getTransactionCount(
      this.wallet.getAddress()
    )
  }

  /**
   * Get the address that perform transaction, or the address of the wallet
   * @returns Address of the wallet
   */
  async getFromAddress() {
    return await this.wallet.getAddress()
  }

  /**
   *
   * @returns Get the current nonce of the wallet
   */
  async getNonce() {
    return await this.wallet.provider.getTransactionCount(
      this.wallet.getAddress()
    )
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
  async enqueueTransaction(tx: PopulatedTransaction) {
    this.waitingTransaction.enqueue(tx)
  }

  /**
   * Send the transaction in the waiting list, append it into pendingList
   */
  private async sendTransaction() {
    const txs = [];
    
    while (this.pendingTransaction.size < this.maxPendingTxs) {
      if (this.waitingTransaction.isEmpty()) break
      const txData = this.waitingTransaction.dequeue()
      const tx = await this.wallet.sendTransaction({
        ...txData,
        nonce: this.nonce,
      })
      this.nonce++
      this.pendingTransaction.add(tx.hash)
      txs.push(tx)
    }
    return txs
  }

  /**
   * Remove the pending transaction that has been confirmed
   */
  async removePendingTx() {
    const txs = Array.from(this.pendingTransaction)
    const currentBlock = await this.wallet.provider.getBlockNumber()
    const receipts = await Promise.all(
      txs.map((tx) => this.wallet.provider.getTransactionReceipt(tx))
    )
    receipts
      .filter((receipt) => receipt.blockNumber + 1 <= currentBlock)
      .forEach((tx) => this.pendingTransaction.delete(tx.transactionHash))
  }

  /**
   * Entry point to run from outside, interval load and send transaction
   */
  async start() {
    const itr = async () => {
      await this.startOneTime()
      if (this.running) {
        this.pollingTimeout = setTimeout(itr, 3000)
      }
    }
    this.running = true
    itr()
  }

  async startOneTime() {
    await this.removePendingTx()
    await this.sendTransaction()
  }
}
