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
  private pendingTransaction: FixedSizeQueue<string>
  /**
   * The running state of the transaction manager
   */
  private running: boolean
  private pollingTimeout: NodeJS.Timeout
  constructor(wallet: Signer, maxPendingTxs) {
    this.wallet = wallet
    this.waitingTransaction = new FixedSizeQueue<PopulatedTransaction>(500)
    this.pendingTransaction = new FixedSizeQueue<string>(maxPendingTxs)
    this.running = false
  }

  /**
   * Init state of the transaction manager, should be called after constructor
   */
  async init() {
    this.nonce = await this.wallet.provider.getTransactionCount(this.wallet.getAddress())
  }

  /**
   * Get the address that perform transaction, or the address of the wallet
   * @returns Address of the wallet
   */
  async getFromAddress() {
    return await this.wallet.getAddress()
  }
  
  async getNonce() {
    return await this.wallet.provider.getTransactionCount(this.wallet.getAddress())
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
    // First, clear successfull pendingTx
    while (!this.pendingTransaction.isEmpty()) {
      const txHash = this.pendingTransaction.peek();
      if (await this.isTxConfirmed(txHash)) {
        // When a transaction is confirmed, remove it from pendingTransaction
        this.pendingTransaction.dequeue()
      } else {
        // break when a transaction is not yet confirmed
        break
      }
    }

    while (!this.pendingTransaction.isFull()) {
      if (this.waitingTransaction.isEmpty()) break;
      const txData = this.waitingTransaction.dequeue()
      const tx = await this.wallet.sendTransaction({
        ...txData,
        nonce: this.nonce,
      })
      this.nonce++
      this.pendingTransaction.enqueue(tx.hash)
    }
  }

  private async isTxConfirmed(txHash: string): Promise<boolean> {
    const tx = await this.wallet.provider.getTransactionReceipt(txHash)
    return tx.blockNumber !== null && tx.blockNumber != undefined
  }

  async start() {
    const itr = async () => {
      await this.sendTransaction();
      if (this.running) {
        this.pollingTimeout = setTimeout(itr, 3000)
      }
    }
    this.running = true 
    itr()
  }

  async startOneTime() {
    await this.sendTransaction()
  }
}
