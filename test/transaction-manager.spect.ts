import { expect } from 'chai'
import { ethers } from 'hardhat'
import { Multicaller, CallWithMeta } from '../src/multicaller'
import { TransactionManager } from '../src/transaction-manager'
import Prover from '../src/prover'
import { MockCrossChainForProver, MockLogger, MockMetrics } from './mocks'
import { sleep, rand, readFromFile, deleteFileIfExists } from '../src/utils'

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

    const transactionManager = new TransactionManager(signers[0])

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
    it('Nonce not null', async function () {
      const { transactionManager } = await setup()
      const nonce = await transactionManager.getNonce()
      expect(nonce).not.to.eq(0)
    })
  })
})
