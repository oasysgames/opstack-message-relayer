import { expect } from 'chai'
import { ethers } from 'hardhat'
import { TransactionManager } from '../src/transaction-manager'
import { sleep } from '../src/utils'

const maxPendingTxs = 2
const confirmationNumber = 0
const intervalMs = 50

describe('TransactionManager', function () {
  async function setup() {
    // Disable auto mining
    await ethers.provider.send('evm_setAutomine', [false])
    // Doesn't have to set block gas limit manually
    // await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', [
    //   '0x3B9ACA00',
    // ]) // 1gwai
    // Need to increase gas limit manually as low value is set in hardhat.config.ts
    await ethers.provider.send('evm_setBlockGasLimit', ['0x1C9C380']) // 30M
    const signers = await ethers.getSigners()
    const deployer = signers[0]
    const counter = await (await ethers.getContractFactory('Counter')).deploy(0)
    const txmgr = new TransactionManager(
      deployer,
      maxPendingTxs,
      confirmationNumber,
      intervalMs
    )
    await ethers.provider.send('hardhat_mine', ['0x1'])
    return {
      deployer,
      signers,
      counter,
      txmgr,
    }
  }

  describe('publishTx', function () {
    it('success: no replace', async function () {
      const { txmgr, counter } = await setup()
      const populated = await counter.populateTransaction.incSimple()
      await txmgr.publishTx(populated)
      await ethers.provider.send('hardhat_mine', ['0x1'])

      expect(await counter.get()).to.equal(1)
    })

    it('success: has replace', async function () {
      const { txmgr, counter } = await setup()
      const populated = await counter.populateTransaction.incSimple()
      const nonce = await txmgr.requestLatestNonce()
      populated.nonce = nonce
      const tx1 = await txmgr.publishTx(populated)
      const tx2 = await txmgr.publishTx(populated)
      expect(await ethers.provider.getTransaction(tx1.hash)).to.equal(null)
      expect((await ethers.provider.getTransaction(tx2.hash)).hash).to.equal(
        tx2.hash
      )
      await ethers.provider.send('hardhat_mine', ['0x1'])

      expect(await txmgr.requestLatestNonce()).to.equal(nonce + 1)
      // will fail by `transaction was replaced` error, unable to call again
      expect(await counter.get()).to.equal(1)
    })

    it('fail', async function () {
      const { txmgr, counter } = await setup()
      const populated = await counter.populateTransaction.revertFunc()
      const res = await txmgr.publishTx(populated)
      await ethers.provider.send('hardhat_mine', ['0x1'])

      const receipt = await ethers.provider.getTransactionReceipt(res.hash)
      expect(receipt.status).to.equal(0)
    })
  })

  describe('enqueueTransaction', function () {
    it('success: under pending', async function () {
      const { txmgr, counter } = await setup()
      const populated = await counter.populateTransaction.incSimple()
      await txmgr.enqueueTransaction({ populated })
      await txmgr.enqueueTransaction({ populated })

      // wait until tx sent
      await sleep(55)
      expect(txmgr.getUnconfirmedTransactions().length).to.equal(2)
      await ethers.provider.send('hardhat_mine', ['0x1'])

      // wait until tx confirmed
      await sleep(50)
      expect(txmgr.getUnconfirmedTransactions().length).to.equal(0)
      expect(await counter.get()).to.equal(2)
    })

    it('success: over pending', async function () {
      const { txmgr, counter } = await setup()
      const populated = await counter.populateTransaction.incSimple()
      await txmgr.enqueueTransaction({ populated })
      await txmgr.enqueueTransaction({ populated })
      txmgr.enqueueTransaction({ populated }).then((result) => {
        expect(result).to.equal(true)
      })

      expect(txmgr.pendingIsFull()).to.equal(true)

      // wait until tx sent
      await sleep(55)
      expect(txmgr.getUnconfirmedTransactions().length).to.equal(2)
      await ethers.provider.send('hardhat_mine', ['0x1'])

      // wait until tx confirmed
      await sleep(50)
      expect(txmgr.getUnconfirmedTransactions().length).to.equal(0)
      expect(await counter.get()).to.equal(2)
      await ethers.provider.send('hardhat_mine', ['0x1'])

      // wait last tx sent
      await sleep(50)
      await ethers.provider.send('hardhat_mine', ['0x1'])
      expect(txmgr.getUnconfirmedTransactions().length).to.equal(1)

      // wait last tx confirmed
      await sleep(50)
      expect(await counter.get()).to.equal(3)
    })
  })

  describe('stop', function () {
    it('success', async function () {
      const { txmgr, counter } = await setup()
      const populated = await counter.populateTransaction.incSimple()
      await txmgr.enqueueTransaction({ populated })
      await txmgr.enqueueTransaction({ populated })

      // wait until tx sent
      await sleep(55)
      expect(txmgr.getUnconfirmedTransactions().length).to.equal(2)

      // stop
      expect(txmgr.isRunning()).to.equal(true)
      await txmgr.stop()
      expect(txmgr.isRunning()).to.equal(false)
      expect(await counter.get()).to.equal(0)
    })
  })
})
