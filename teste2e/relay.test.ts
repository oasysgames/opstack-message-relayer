require('dotenv').config()
import { TransactionResponse } from '@ethersproject/abstract-provider'
import { MessageStatus } from '@eth-optimism/sdk'
import { ERC721BridgeAdapter } from './lib/erc721-bridge-adapter'
import { Ether, log, createWallets, abbreviateTxHash } from './lib'
import * as opsdk from './lib/sdk'
import { TEST_ACCOUNTS } from './accounts'

// Load the environment variables
const L1_ERC20_ADDRESS = process.env.L1_ERC20_ADDRESS!
const L2_ERC20_ADDRESS = process.env.L2_ERC20_ADDRESS!
const L1_ERC721_ADDRESS = process.env.L1_ERC721_ADDRESS!
const L2_ERC721_ADDRESS = process.env.L2_ERC721_ADDRESS!
const TOKEN_ID_START = Number(process.env.TOKEN_ID_START!)
const TOKEN_ID_END = Number(process.env.TOKEN_ID_END!)

const AMOUNT = '1' // 1 OAS
const bridgeAdapter = {
  adapter: ERC721BridgeAdapter,
  l1Bridge: opsdk.l1Contracts.L1ERC721BridgeProxy,
  l2Bridge: '0x4200000000000000000000000000000000000014',
}

async function main() {
  // create test accounts
  const accounts = createWallets(123)
  const wallets = createWallets(TEST_ACCOUNTS.length, TEST_ACCOUNTS)

  const amount = BigInt(AMOUNT) * Ether

  // withdraw from L2
  log('withdraw OAS/ERC20/ERC721...\n')
  const txs: TransactionResponse[] = []
  let tokenId = TOKEN_ID_START
  let messenger
  for (let i = 0; i < accounts.length; i++) {
    const wallet = wallets[i % wallets.length]
    const { l1Signer, l2Signer } = opsdk.getSigners({
      privateKey: wallet.privateKey,
    })

    // withdraw OAS
    messenger = opsdk.getCrossChainMessenger({ l1Signer, l2Signer })
    const tx1 = await messenger.withdrawETH(amount.toString(), {
      recipient: accounts[i].address,
    })
    txs.push(tx1)
    log(
      `withdraw ${AMOUNT} OAS from ${wallet.address} to ${
        accounts[i].address
      }. tx: ${abbreviateTxHash(tx1.hash)}\n`
    )

    // withdraw ERC20
    messenger = opsdk.getCrossChainMessenger({ l1Signer, l2Signer })
    const tx2 = await messenger.withdrawERC20(
      L1_ERC20_ADDRESS,
      L2_ERC20_ADDRESS,
      amount.toString(),
      {
        recipient: accounts[i].address,
      }
    )
    txs.push(tx2)
    log(
      `withdraw ${AMOUNT} ERC20 from ${wallet.address} to ${abbreviateTxHash(
        accounts[i].address
      )}. tx: ${abbreviateTxHash(tx2.hash)}\n`
    )

    // withdraw ERC721
    if (tokenId < TOKEN_ID_END) {
      messenger = opsdk.getCrossChainMessenger({
        l1Signer,
        l2Signer,
        bridgeAdapter,
      })
      const tx3 = await messenger.withdrawERC20(
        L1_ERC721_ADDRESS,
        L2_ERC721_ADDRESS,
        tokenId.toString(),
        {
          recipient: accounts[i].address,
        }
      )
      txs.push(tx3)
      log(
        `withdraw ERC721 tokenId ${tokenId} from ${
          wallet.address
        } to ${abbreviateTxHash(accounts[i].address)}. tx: ${abbreviateTxHash(
          tx3.hash
        )}\n`
      )
    }

    tokenId++
  }

  log('--------------------------------------------------\n')

  // wait until the last tx is mined
  await txs[txs.length - 1].wait()

  // wait until all txs are relayed
  log('waiting for txs to be relayed...\n')
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