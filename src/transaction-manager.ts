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

  constructor(wallet: Signer) {
    this.wallet = wallet
    this.waitingTransaction = new FixedSizeQueue<PopulatedTransaction>(500)
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
}
