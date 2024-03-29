import { Signer, Wallet, providers } from 'ethers'
import FixedSizeQueue from './queue-mem'
export class TransactionManager {
  private nonce: number | undefined
  private wallet: Signer
  private waitingTransaction: FixedSizeQueue<Buffer>

  constructor(wallet: Signer) {
    this.wallet = wallet
    this.waitingTransaction = new FixedSizeQueue<Buffer>(500)
  }

  async getNonce()  {
    if (this.nonce === undefined) {
      this.nonce = await this.wallet.provider.getTransactionCount(this.wallet.getAddress())
    }
    return this.nonce
  }
}
