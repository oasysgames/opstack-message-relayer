require('dotenv').config()
import { Overrides as TxOverrides } from 'ethers'
import { TransactionResponse } from '@ethersproject/abstract-provider'
import { MessageStatus } from '@eth-optimism/sdk'
import { Gwei, Ether, log, createWallets, abbreviateTxHash } from './lib'
import * as opsdk from './lib/sdk'
import { ERC721BridgeAdapter } from './lib/erc721-bridge-adapter'
import { TEST_ACCOUNTS } from './accounts'

// Load the environment variables
const PRIVATE_KEY = process.env.PRIVATE_KEY!
const L1_ERC20_ADDRESS = process.env.L1_ERC20_ADDRESS!
const L2_ERC20_ADDRESS = process.env.L2_ERC20_ADDRESS!
const L1_ERC721_ADDRESS = process.env.L1_ERC721_ADDRESS!
const L2_ERC721_ADDRESS = process.env.L2_ERC721_ADDRESS!
const TOKEN_ID_START = Number(process.env.TOKEN_ID_START!)
const TOKEN_ID_END = Number(process.env.TOKEN_ID_END!)

// Setup the OP Stack SDK
const { l1Signer, l2Signer } = opsdk.getSigners({ privateKey: PRIVATE_KEY })
const messenger20 = opsdk.getCrossChainMessenger({ l1Signer, l2Signer })
const messenger721 = opsdk.getCrossChainMessenger({
  l1Signer,
  l2Signer,
  bridgeAdapter: {
    adapter: ERC721BridgeAdapter,
    l1Bridge: opsdk.l1Contracts.L1ERC721BridgeProxy,
    l2Bridge: '0x4200000000000000000000000000000000000014',
  },
})

const AMOUNT = '100' // 100 OAS

async function main() {
  // create test accounts
  const accounts = createWallets(TEST_ACCOUNTS.length, TEST_ACCOUNTS)

  const amount = BigInt(AMOUNT) * Gwei

  // deposit to L1
  log('Deposit OAS/ERC20/ERC721...\n')
  const txs: TransactionResponse[] = []
  let tokenId = TOKEN_ID_START
  for (const wallet of accounts) {
    // deposit OAS
    const tx1 = await messenger20.depositETH(amount.toString(), {
      recipient: wallet.address,
      overrides: { from: l1Signer.address } as TxOverrides,
    })
    txs.push(tx1)
    log(
      `${AMOUNT} OAS deposited to ${
        wallet.address
      } on L1. tx: ${abbreviateTxHash(tx1.hash)}\n`
    )

    // deposit ERC20
    // await messenger20.approveERC20(
    //   L1_ERC20_ADDRESS,
    //   L2_ERC20_ADDRESS,
    //   amount.toString(),
    //   {
    //     overrides: { from: l1Signer.address } as TxOverrides,
    //   }
    // )
    // const tx2 = await messenger20.depositERC20(
    //   L1_ERC20_ADDRESS,
    //   L2_ERC20_ADDRESS,
    //   amount.toString(),
    //   {
    //     recipient: wallet.address,
    //     overrides: { from: l1Signer.address } as TxOverrides,
    //   }
    // )
    // txs.push(tx2)
    // log(
    //   `${AMOUNT} ERC20 deposited to ${
    //     wallet.address
    //   } on L1. tx: ${abbreviateTxHash(tx2.hash)}\n`
    // )

    // // deposit ERC721
    // if (tokenId < TOKEN_ID_END) {
    //   await messenger721.approveERC20(
    //     L1_ERC721_ADDRESS,
    //     L2_ERC721_ADDRESS,
    //     tokenId,
    //     {
    //       overrides: { from: l1Signer.address } as TxOverrides,
    //     }
    //   )
    //   const tx3 = await messenger721.depositERC20(
    //     L1_ERC721_ADDRESS,
    //     L2_ERC721_ADDRESS,
    //     tokenId,
    //     {
    //       recipient: wallet.address,
    //       overrides: { from: l1Signer.address } as TxOverrides,
    //     }
    //   )
    //   txs.push(tx3)
    //   log(
    //     `ERC721 tokenId ${tokenId} deposited to ${
    //       wallet.address
    //     } on L1. tx: ${abbreviateTxHash(tx3.hash)}\n`
    //   )
    // }

    tokenId++
  }

  log('--------------------------------------------------\n')

  // wait until the last tx is mined
  await txs[txs.length - 1].wait()

  // wait for txs to be relayed
  log('Waiting for message to be relayed...\n')
  for (const tx of txs) {
    await messenger20.waitForMessageStatus(tx.hash, MessageStatus.RELAYED)
    log(`Relayed tx: ${abbreviateTxHash(tx.hash)}\n`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
