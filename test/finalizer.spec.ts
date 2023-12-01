import { expect } from 'chai'
import { ethers } from 'hardhat';
import { Multicaller, CallWithMeta}  from '../src/multicaller'
import Finalizer from '../src/finalizer'
import { MockCrossChain, MockLogger } from './mocks'
import { sleep } from '../src/utils'
import exp from 'constants';

describe('Finalizer', function () {
  async function setup() {
    const signers = await ethers.getSigners()
    // deploy counter contract
    const counter = await (
      await ethers.getContractFactory('Counter')
    ).deploy(0)
    // deploy multicalll2 contract
    const muticall = await (
      await ethers.getContractFactory('Multicall2')
    ).deploy()
    // estimate single inc call gas
    const callData = (await counter.populateTransaction.incSimple()).data
    const singleCallGas = Number((await counter.estimateGas.incSimple()).toString())
    // init multicaller
    const multicaller = new Multicaller(muticall.address, signers[0], Math.floor(singleCallGas*2.5))
    // init mock messenger
    const messenger = new MockCrossChain()
    messenger.init(counter)
    const logger = new MockLogger()
    // @ts-ignore
    const finalizer = new Finalizer(10, logger, 100, messenger, multicaller)
    finalizer.start()
    
    return {
      signers,
      counter,
      multicaller,
      callData,
      singleCallGas,
      finalizer,
    }
  }

  describe('stop', function () {
    it('succeed', async function () {
      const { finalizer } = await setup()
      finalizer.stop()
    })
  })

  describe('appendMessage', function () {
    const messages = [ { blockHeight: 1, txHash: "1", message: "1" }, { blockHeight: 2, txHash: "2", message: "2" } ]

    it('succeed: no flush queue', async function () {
      const { finalizer } = await setup()
      // @ts-ignore
      finalizer.appendMessage(...messages)

      await sleep(500)

      expect(finalizer.queue.count).to.equal(0)
      expect(finalizer.highestFinalizedL2).to.equal(0)
    })

    it('succeed: flush queue', async function () {
      const { counter, finalizer } = await setup()
      // @ts-ignore
      finalizer.appendMessage(...messages, { blockHeight: 3, txHash: "3", message: "3" })

      await sleep(1000)

      expect(finalizer.highestFinalizedL2).to.equal(2)
      expect(await counter.get()).to.equal(3)
    })

    it('succeed: skip already falized or in challenge period', async function () {
      const { counter, finalizer } = await setup()
      // @ts-ignore
      finalizer.appendMessage(...messages, { blockHeight: 3, txHash: "3", message: "3" }, { blockHeight: 4, txHash: "4", message: "4" }, { blockHeight: 5, txHash: "5", message: "5" })

      await sleep(500)

      expect(finalizer.queue.count).to.equal(1)
      expect(finalizer.highestFinalizedL2).to.equal(2)
      expect(await counter.get()).to.equal(3)
    })
  })
})
