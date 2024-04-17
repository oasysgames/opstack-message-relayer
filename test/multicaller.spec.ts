import { expect } from 'chai'
import { ethers } from 'hardhat'
import { Multicaller, CallWithMeta } from '../src/multicaller'
import { TransactionManager } from '../src/transaction-manager'

describe('Multicaller', function () {
  async function setup() {
    const signers = await ethers.getSigners()
    // deploy counter contract
    const counter = await (await ethers.getContractFactory('Counter')).deploy(0)
    // deploy multicalll2 contract
    const muticall = await (
      await ethers.getContractFactory('Multicall2')
    ).deploy()
    // estimate single inc call gas
    const callData = (await counter.populateTransaction.inc()).data
    const callDataFail = (await counter.populateTransaction.revertFunc()).data
    const singleCallGas = Number((await counter.estimateGas.inc()).toString())
    // init multicaller
    const multicaller = new Multicaller(
      muticall.address,
      signers[0],
      Math.floor(singleCallGas * 2.5)
    )
    // set single gas call
    multicaller.singleCallGas = singleCallGas
    const maxPendingTxs = 2
    const confirmationNumber = 0
    const transactionManager = new TransactionManager(signers[0], maxPendingTxs, confirmationNumber)
    return {
      signers,
      counter,
      multicaller,
      callData,
      callDataFail,
      singleCallGas,
      transactionManager,
    }
  }

  describe('isOverTargetGas', function () {
    it('succeed', async function () {
      const { multicaller } = await setup()

      expect(multicaller.isOverTargetGas(2)).to.false
      expect(multicaller.isOverTargetGas(3)).to.true
    })
  })

  describe('multicall', function () {
    it('succeed: less than gas limit', async function () {
      const { counter, multicaller, callData, transactionManager } =
        await setup()
      const target = counter.address
      const calls: CallWithMeta[] = []
      for (let i = 0; i < 3; i++) {
        calls.push({ target, callData } as CallWithMeta)
      }
      await multicaller.multicall(calls, transactionManager, null)

      expect(await counter.get()).to.equal(calls.length)
    })

    it('succeed: more than gas limit', async function () {
      const { counter, multicaller, callData, transactionManager } =
        await setup()
      const target = counter.address
      const calls: CallWithMeta[] = []
      for (let i = 0; i < 20; i++) {
        calls.push({ target, callData } as CallWithMeta)
      }

      multicaller.gasMultiplier = 1
      await multicaller.multicall(calls, transactionManager, null)

      expect(await counter.get()).to.equal(calls.length)
    })

    it('succeed: two of calls reverted', async function () {
      const {
        counter,
        multicaller,
        callData,
        callDataFail,
        transactionManager,
      } = await setup()
      const target = counter.address
      const revertCall = { target, callData: callDataFail } as CallWithMeta
      const calls: CallWithMeta[] = [revertCall]
      for (let i = 0; i < 4; i++) {
        calls.push({ target, callData } as CallWithMeta)
      }
      calls.push(revertCall)
      const faileds = await multicaller.multicall(
        calls,
        transactionManager,
        null
      )

      expect(faileds.length).to.equal(2)
      expect(await counter.get()).to.equal(4)
    })

    it('succeed: two of calls reverted', async function () {
      const {
        counter,
        multicaller,
        callData,
        callDataFail,
        transactionManager,
      } = await setup()
      const target = counter.address
      const revertCall = { target, callData: callDataFail } as CallWithMeta
      const calls: CallWithMeta[] = [revertCall]
      for (let i = 0; i < 4; i++) {
        calls.push({ target, callData } as CallWithMeta)
      }
      calls.push(revertCall)
      const faileds = await multicaller.multicall(
        calls,
        transactionManager,
        null
      )

      expect(faileds.length).to.equal(2)
      expect(await counter.get()).to.equal(4)
    })
  })
})
