import { expect } from 'chai'
import { ethers } from 'hardhat';
import { Multicaller, CallWithMeta}  from '../src/multicaller'



describe('Multicaller', function () {
  async function setup() {
    const signers = await ethers.getSigners()
    // deploy counter contract
    const counter = await (
      await ethers.getContractFactory('Counter')
    ).deploy(0)
    console.log()
    // deploy multicalll2 contract
    const muticall = await (
      await ethers.getContractFactory('Multicall2')
    ).deploy()
    // estimate single inc call gas
    const callData = (await counter.populateTransaction.inc()).data
    const callDataFail = (await counter.populateTransaction.revertFunc()).data
    const singleCallGas = Number((await counter.estimateGas.inc()).toString())
    // init multicaller
    const multicaller = new Multicaller(muticall.address, signers[0], Math.floor(singleCallGas*2.5))
    // set single gas call
    multicaller.singleCallGas = singleCallGas
    return {
      signers,
      counter,
      multicaller,
      callData,
      callDataFail,
      singleCallGas,
    }
  }

  describe('isOvertargetGas', function () {
    it('succeed', async function () {
      const { multicaller } = await setup()

      expect(multicaller.isOvertargetGas(2)).to.false
      expect(multicaller.isOvertargetGas(3)).to.true
    })
  })

  describe('multicall', function () {
    it('succeed: less than gas limit', async function () {
      const { counter, multicaller, callData } = await setup()
      const target = counter.address
      const calls: CallWithMeta[] = []
      for (let i = 0; i < 3; i++) {
        calls.push({ target, callData } as CallWithMeta)
      }
      await multicaller.multicall(calls, null)

      expect(await counter.get()).to.equal(calls.length)
    })

    it('succeed: more than gas limit', async function () {
      const { counter, multicaller, callData } = await setup()
      const target = counter.address
      const calls: CallWithMeta[] = []
      for (let i = 0; i < 20; i++) {
        calls.push({ target, callData } as CallWithMeta)
      }

      multicaller.gasMultiplier = 1
      await multicaller.multicall(calls, null)

      expect(await counter.get()).to.equal(calls.length)
    })

    it('succeed: two of calls reverted', async function () {
      const { counter, multicaller, callData, callDataFail } = await setup()
      const target = counter.address
      const revertCall = { target, callData: callDataFail } as CallWithMeta
      const calls: CallWithMeta[] = [revertCall]
      for (let i = 0; i < 4; i++) {
        calls.push({ target, callData } as CallWithMeta)
      }
      calls.push(revertCall)
      const faileds = await multicaller.multicall(calls, null)

      expect(faileds.length).to.equal(2)
      expect(await counter.get()).to.equal(4)
    })

    it('succeed: two of calls reverted', async function () {
      const { counter, multicaller, callData, callDataFail } = await setup()
      const target = counter.address
      const revertCall = { target, callData: callDataFail } as CallWithMeta
      const calls: CallWithMeta[] = [revertCall]
      for (let i = 0; i < 4; i++) {
        calls.push({ target, callData } as CallWithMeta)
      }
      calls.push(revertCall)
      const faileds = await multicaller.multicall(calls, null)

      expect(faileds.length).to.equal(2)
      expect(await counter.get()).to.equal(4)
    })
  })
})
