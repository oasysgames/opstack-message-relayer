import { Signer, Wallet, providers } from 'ethers'
import FixedSizeQueue from './queue-mem'
export class TransactionManager {
  private nonce: number
  private wallet: Signer
  private waitingTransaction: FixedSizeQueue<Buffer>

  constructor(privateKey: string, providerEndpoint: string) {
    this.wallet = new Wallet(privateKey)
    this.wallet.connect(new providers.JsonRpcProvider(providerEndpoint))
    this.waitingTransaction = new FixedSizeQueue<Buffer>(500)
  }
}
