import { expect } from 'chai'
import { ethers } from 'hardhat'
import { Multicaller, CallWithMeta } from '../src/multicaller'
import { TransactionManager } from '../src/transaction-manager'
import Prover from '../src/prover'
import { MockCrossChainForProver, MockLogger, MockMetrics } from './mocks'
import { sleep, rand, readFromFile, deleteFileIfExists } from '../src/utils'
import { sign } from 'crypto'

const stateFilePath = './test/state.test.json'
const l2blockConfirmations = 8
const reorgSafetyDepth = 4
const succeededCalldatas: CallWithMeta[] = []

describe('TransactionManager', function () {
  afterEach(async function () {
    await deleteFileIfExists(stateFilePath)
    succeededCalldatas.length = 0
  })

  async function setup() {
    const signers = await ethers.getSigners()
    // deploy counter contract
    const counter = await (await ethers.getContractFactory('Counter')).deploy(0)
    // deploy multicalll2 contract
    const muticall = await (
      await ethers.getContractFactory('Multicall2')
    ).deploy()
    // estimate single inc call gas
    const callData = (await counter.populateTransaction.incSimple()).data
    const singleCallGas = Number(
      (await counter.estimateGas.incSimple()).toString()
    )
    // init multicaller
    const multicaller = new Multicaller(
      muticall.address,
      signers[0],
      Math.floor(singleCallGas * 2.5)
    )

    const metrics = new MockMetrics()
    const messenger = new MockCrossChainForProver()
    messenger.init(counter)
    const logger = new MockLogger()

    const postMessage = (succeeds: CallWithMeta[]) => {
      succeededCalldatas.push(...succeeds)
    }

    // @ts-ignore
    const prover = new Prover(
      metrics,
      logger,
      stateFilePath,
      0,
      l2blockConfirmations,
      reorgSafetyDepth,
      messenger,
      multicaller,
      postMessage
    )
    await prover.init()

    const transactionManager = new TransactionManager(signers[0], 2)
    await transactionManager.init()

    return {
      signers,
      counter,
      multicaller,
      callData,
      singleCallGas,
      messenger,
      prover,
      transactionManager,
    }
  }

  describe('Init success', function () {
    it('From address init success', async function () {
      const { transactionManager, signers } = await setup()
      const fromAddress = await transactionManager.getFromAddress()
      expect(fromAddress).to.be.eq(signers[0].address)
    })
  })

  describe('Send transaction', function () {
    it('Push raw transaction success', async () => {
      const { counter, transactionManager } = await setup()
      const data = await counter.populateTransaction.incSimple()
      await transactionManager.enqueueTransaction(data)
      await transactionManager.enqueueTransaction(data)
    })

    it('Send transaction success', async () => {
      const { counter, transactionManager } = await setup()
      const data = await counter.populateTransaction.incSimple()
      const startNonce = await transactionManager.getNonce()
      await transactionManager.enqueueTransaction(data)
      await transactionManager.enqueueTransaction(data)
      await transactionManager.startOneTime()
      const endNonce = await transactionManager.getNonce()
      expect(endNonce).to.be.eq(startNonce + 2)
      // Increase block number to finalize the transaction
      await ethers.provider.send('hardhat_mine', ['0x2'])
      await transactionManager.startOneTime()
      const { pendingSize } = transactionManager.getCurrentStats()
      expect(pendingSize).to.be.eq(0)
    })

    it('Send transaction multiple time', async () => {
      const { counter, transactionManager } = await setup()
      const data = await counter.populateTransaction.incSimple()
      await transactionManager.enqueueTransaction(data)
      await transactionManager.enqueueTransaction(data)
      await transactionManager.enqueueTransaction(data)
      await transactionManager.enqueueTransaction(data)
      await transactionManager.startOneTime()
      // Increase block number to finalize the transaction
      await ethers.provider.send('hardhat_mine', ['0x1'])
      let { pendingSize, waitingSize } = transactionManager.getCurrentStats()
      expect(pendingSize).to.be.eq(2)
      expect(waitingSize).to.be.eq(2)
      await transactionManager.startOneTime()
      await ethers.provider.send('hardhat_mine', ['0x1'])
      await transactionManager.removePendingTx()
      ;({ pendingSize, waitingSize } = transactionManager.getCurrentStats())
      expect(pendingSize).to.be.eq(0)
      expect(waitingSize).to.be.eq(0)
    })
  })
})
