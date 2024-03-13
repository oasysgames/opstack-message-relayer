import { TransactionResponse } from '@ethersproject/abstract-provider'
import { MessageStatus } from '@eth-optimism/sdk'
import { Ether, log, createWallets } from './lib'
import * as opsdk from './lib/sdk'
import { TEST_ACCOUNTS } from './accounts'

const AMOUNT = '1' // 1 OAS

async function main() {
  // create test accounts
  const accounts = createWallets(123)
  const wallets = createWallets(TEST_ACCOUNTS.length, TEST_ACCOUNTS)

  // initiate relay
  const amount = BigInt(AMOUNT) * Ether
  const txs: TransactionResponse[] = []
  let messenger
  for (let i = 0; i < accounts.length; i++) {
    const wallet = wallets[i % wallets.length]
    const { l1Signer, l2Signer } = opsdk.getSigners({
      privateKey: wallet.privateKey,
    })
    messenger = opsdk.getCrossChainMessenger({ l1Signer, l2Signer })
    const tx = await messenger.withdrawERC20(
      process.env.L1_ERC20!,
      process.env.L2_ERC20!,
      amount.toString(),
      {
        recipient: accounts[i].address,
      }
    )
    txs.push(tx)
    log(`sent tx: ${tx.hash}\n`)
  }

  // wait until the last tx is mined
  await txs[txs.length - 1].wait()

  // wait until all txs are proved
  for (const tx of txs) {
    console.log(`waiting for tx: ${tx.hash}\n`)
    await messenger.waitForMessageStatus(tx.hash, MessageStatus.READY_TO_PROVE)
    log(`proved tx: ${tx.hash}\n`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
