import { Overrides as TxOverrides } from 'ethers'
import { TransactionResponse } from '@ethersproject/abstract-provider'
import { MessageStatus } from '@eth-optimism/sdk'
import { Ether, log, createWallets, abbreviateTxHash } from './lib'
import * as opsdk from './lib/sdk'
import { TEST_ACCOUNTS } from './accounts'

// Setup the OP Stack SDK
const privateKey = process.env.PRIVATE_KEY!
const { l1Signer, l2Signer } = opsdk.getSigners({ privateKey })
const messenger = opsdk.getCrossChainMessenger({ l1Signer, l2Signer })

const AMOUNT = '1000' // 1000 OAS

async function main() {
  // create test accounts
  const accounts = createWallets(TEST_ACCOUNTS.length, TEST_ACCOUNTS)

  // deposit to L1
  log('Deposit OAS to the L1StandardBridge...\n')
  const amount = BigInt(AMOUNT) * Ether
  const txs: TransactionResponse[] = []
  for (const wallet of accounts) {
    const tx = await messenger.depositETH(amount.toString(), {
      recipient: wallet.address,
      overrides: { from: l1Signer.address } as TxOverrides,
    })
    await tx.wait()
    txs.push(tx)
    log(
      `${AMOUNT} OAS deposited to ${
        wallet.address
      } on L1. tx: ${abbreviateTxHash(tx.hash)}\n`
    )
  }

  log('--------------------------------------------------\n')

  // wait for txs to be relayed
  log('Waiting for message to be relayed...\n')
  for (const tx of txs) {
    await messenger.waitForMessageStatus(tx.hash, MessageStatus.RELAYED)
    log(`Relayed tx: ${abbreviateTxHash(tx.hash)}\n`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
