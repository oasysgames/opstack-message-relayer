import { Overrides as TxOverrides } from 'ethers'
import { TransactionResponse } from '@ethersproject/abstract-provider'
import { MessageStatus } from '@eth-optimism/sdk'
import { Ether, log, createWallets, abbreviateTxHash } from './lib'
import * as opsdk from './lib/sdk'
import { TEST_ACCOUNTS } from './accounts'
import { createOptimisticERC20, createOptimisticERC721 } from './lib/utils'
import { mintERC20, mintERC721 } from './lib/mint'
import { ERC721BridgeAdapter } from './lib/erc721-bridge-adapter'

// Setup the OP Stack SDK
const privateKey = process.env.PRIVATE_KEY!
const { l1Signer, l2Signer } = opsdk.getSigners({ privateKey })

const AMOUNT = '1000' // 1000 OAS

let l2_erc20_address
let l2_erc721_address
let START_ID, END_ID

async function main() {
  // create test accounts
  const accounts = createWallets(TEST_ACCOUNTS.length, TEST_ACCOUNTS)
  const amount = BigInt(AMOUNT) * Ether

  // deposit to L1 OAS
  {
    const messenger = opsdk.getCrossChainMessenger({ l1Signer, l2Signer })
    log('Deposit OAS to the L1StandardBridge...\n')

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

  // Deposit on layer 1 ERC20
  {
    // create deploy token erc20 on layer
    const messenger = opsdk.getCrossChainMessenger({ l1Signer, l2Signer })

    l2_erc20_address = await createOptimisticERC20(
      process.env.FACTORY_ERC20!,
      l2Signer,
      process.env.L1_ERC20!,
      opsdk.getProviders().l2Provider
    )

    // mint to one account in layer 1
    await mintERC20(
      l1Signer,
      process.env.L1_ERC20!,
      opsdk.getProviders().l1Provider,
      l1Signer.address,
      (amount * BigInt(accounts.length)).toString()
    )

    log('Deposit ERC20 to the L1StandardBridge...\n')
    const txs: TransactionResponse[] = []
    for (const wallet of accounts) {
      const tx = await messenger.depositERC20(
        process.env.L1_ERC20!,
        l2_erc20_address,
        amount.toString(),
        {
          recipient: wallet.address,
          overrides: { from: l1Signer.address } as TxOverrides,
        }
      )
      await tx.wait()
      txs.push(tx)
      log(
        `${AMOUNT} ERC20 deposited to ${
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

  //Deposit on layer 1 ERC721
  {
    // create deploy token erc20 on layer

    const messenger = opsdk.getCrossChainMessenger({
      l1Signer,
      l2Signer,
      bridgeAdapter: {
        adapter: ERC721BridgeAdapter,
        l1Bridge: opsdk.l1Contracts.L1ERC721BridgeProxy,
        l2Bridge: '0x4200000000000000000000000000000000000014',
      },
    })

    l2_erc721_address = await createOptimisticERC721(
      process.env.FACTORY_ERC721!,
      l2Signer,
      process.env.L1_ERC721!,
      opsdk.getProviders().l2Provider
    )

    // mint to one account in layer 1
    const [start_nft_id, end_nft_id] = await mintERC721(
      l1Signer,
      process.env.L1_ERC721!,
      opsdk.getProviders().l1Provider,
      l1Signer.address,
      accounts.length.toString()
    )

    START_ID = start_nft_id
    END_ID = end_nft_id

    log('Deposit ERC721 to the L1StandardBridge...\n')
    const txs: TransactionResponse[] = []
    for (let i = 0; i < accounts.length; i++) {
      const tx = await messenger.depositERC20(
        process.env.L1_ERC721!,
        l2_erc721_address,
        start_nft_id + i,
        {
          recipient: accounts[i].address,
          overrides: { from: l1Signer.address } as TxOverrides,
        }
      )
      await tx.wait()
      txs.push(tx)
      log(
        `TokenId: ${start_nft_id + i} ERC721 deposited to ${
          accounts[i].address
        } on L1. tx: ${abbreviateTxHash(tx.hash)}\n`
      )
    }

    log('--------------------------------------------------\n')

    // wait for txs to be relayed
    log('Waiting for message to be relayed...\n')
    for (const tx of txs) {
      console.log(tx)
      await messenger.waitForMessageStatus(tx.hash, MessageStatus.RELAYED)
      log(`Relayed tx: ${abbreviateTxHash(tx.hash)}\n`)
    }
  }
  console.log(
    `Run cmd in your terminal: \nexport L2_ERC20=${l2_erc20_address}\nexport L2_ERC721=${l2_erc721_address}`
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
