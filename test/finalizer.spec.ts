import { expect } from 'chai'
import { ethers } from 'hardhat'
import { Portal } from '../src/portal'
import Finalizer from '../src/finalizer'
import { MockCrossChain, MockLogger } from './mocks'
import { sleep } from '../src/utils'

describe('Finalizer', function () {
  async function setup() {
    const signers = await ethers.getSigners()
    // deploy contracts
    const portalContract = await (
      await ethers.getContractFactory('MockOasysPortal')
    ).deploy()
    const oracleContract = await (
      await ethers.getContractFactory('MockOasysL2OutputOracle')
    ).deploy()
    // estimate single call gas
    // const call = {
    //   nonce: BigNumber.from(0),
    //   sender: ZERO_ADDRESS,
    //   target: ZERO_ADDRESS,
    //   value: BigNumber.from(0),
    //   gasLimit: BigNumber.from(123456),
    //   data: 0x0,
    // }
    // const singleCallGas = Number(
    //   (
    //     await portalContract.estimateGas.finalizeWithdrawalTransactions([call])
    //   ).toString()
    // )
    // init portal
    const portal = new Portal(
      portalContract.address,
      signers[0],
      Math.floor(23342 + 43705 * 2.5)
    )
    // init mock messenger
    const messenger = new MockCrossChain()
    messenger.init(portalContract)
    const logger = new MockLogger()
    // @ts-ignore
    const finalizer = new Finalizer(
      '',
      100,
      logger,
      messenger,
      oracleContract,
      portal,
      () => {}
    )
    finalizer.start()

    return {
      signers,
      portalContract,
      portal,
      finalizer,
    }
  }

  describe('stop', function () {
    it('succeed', async function () {
      const { finalizer } = await setup()
      await finalizer.stop()
    })
  })

  describe('appendMessage', function () {
    it('succeed: withdraw during in loop', async function () {
      const messages = [
        { blockHeight: 1, txHash: '1', message: 0x1 },
        { blockHeight: 2, txHash: '2', message: 0x2 },
        { blockHeight: 3, txHash: '3', message: 0x3 },
      ]
      const { portalContract, finalizer } = await setup()
      // @ts-ignore
      finalizer.appendMessage(...messages)

      await sleep(3000)

      expect(finalizer.queue.count).to.equal(0)
      expect(finalizer.highestFinalizedL2).to.equal(2)
      for (let i = 0; i < 3; i++) {
        const hash = await portalContract.computeWithdrawalHash(
          messages[i].message
        )
        expect(await portalContract.finalizedWithdrawals(hash)).to.true
      }
      finalizer.stop()
    })

    it('succeed: flush remaining calldatas', async function () {
      const messages = [
        { blockHeight: 1, txHash: '1', message: 0x1 },
        { blockHeight: 2, txHash: '2', message: 0x2 },
      ]
      const { finalizer } = await setup()
      // @ts-ignore
      finalizer.appendMessage(...messages)

      await sleep(2000)

      expect(finalizer.queue.count).to.equal(0)
      expect(finalizer.highestFinalizedL2).to.equal(1)
      await finalizer.stop()
    })

    it('succeed: skip already falized or in challenge period | instant verify', async function () {
      const messages = [
        { blockHeight: 1, txHash: '1', message: 0x1 },
        { blockHeight: 2, txHash: '2', message: 0x2 },
        { blockHeight: 3, txHash: '3', message: 0x3 },
        { blockHeight: 4, txHash: '4', message: 0x4 },
        { blockHeight: 5, txHash: '5', message: 0x5 },
        { blockHeight: 5, txHash: '5', message: 0x6 },
      ]
      const { portalContract, finalizer } = await setup()
      // @ts-ignore
      finalizer.appendMessage(...messages)

      await sleep(3000)

      expect(finalizer.queue.count).to.equal(0)
      expect(finalizer.highestFinalizedL2).to.equal(3)
      for (let i = 0; i < 4; i++) {
        const hash = await portalContract.computeWithdrawalHash(
          messages[i].message
        )
        expect(await portalContract.finalizedWithdrawals(hash)).to.true
      }
      await finalizer.stop()
    })
  })
})
