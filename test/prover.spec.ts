import { expect } from 'chai'
import { ethers } from 'hardhat'
import { Multicaller, CallWithMeta } from '../src/multicaller'
import Prover from '../src/prover'
import { MockCrossChainForProver, MockLogger, MockMetrics } from './mocks'
import { sleep, rand, readFromFile, deleteFileIfExists } from '../src/utils'

const stateFilePath = './test/state.test.json'
const l2blockConfirmations = 8
const reorgSafetyDepth = 4
const succeededCalldatas: CallWithMeta[] = []

describe('Prover', function () {
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
    const maxPendingTxs = 2
    const confirmationNumber = 0

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
      signers[0],
      maxPendingTxs,
      postMessage,
      confirmationNumber
    )
    await prover.init()

    return {
      signers,
      counter,
      multicaller,
      callData,
      singleCallGas,
      messenger,
      prover,
    }
  }

  describe('init/writeState/updateHighestFinalizedL2/updateHighestProvenL2/updateHighestFinalizedL2', function () {
    it('succeed', async function () {
      const { prover } = await setup()
      const r = rand(100)
      prover.updateHighestKnownL2(r)
      prover.updateHighestProvenL2(r + 1)
      prover.updateHighestFinalizedL2(r + 2)
      await prover.writeState()

      await prover.init()
      expect(prover.highestKnownL2()).to.equal(r)
      expect(prover.highestProvenL2()).to.equal(r + 1)
      expect(prover.highestFinalizedL2()).to.equal(r + 2)
    })
  })

  describe('handleL2Reorg', function () {
    it('no rollback', async function () {
      const { prover } = await setup()
      const knownL2 = rand(100) + 100
      const provenL2 = knownL2 - reorgSafetyDepth
      prover.updateHighestProvenL2(provenL2)
      prover.handleL2Reorg(knownL2)

      expect(prover.highestProvenL2()).to.equal(provenL2)
    })

    it('rollback proven', async function () {
      const { prover } = await setup()
      const knownL2 = rand(100) + 100
      const provenL2 = knownL2 - reorgSafetyDepth + 1
      const finalizedL2 = provenL2 - 5
      prover.updateHighestProvenL2(provenL2)
      prover.updateHighestFinalizedL2(finalizedL2)
      prover.handleL2Reorg(knownL2)

      const newProvenL2 = provenL2 - 1
      expect(prover.highestProvenL2()).to.equal(newProvenL2)
      const newFinalizedL2 = finalizedL2 - (provenL2 - newProvenL2)
      expect(prover.highestFinalizedL2()).to.equal(newFinalizedL2)
    })
  })

  describe('handleSingleBlock', function () {
    it('succeed', async function () {
      const { counter, prover, messenger } = await setup()
      const height = 134
      const blocks = {
        [height]: {
          transactions: [
            {
              number: height,
              hash: '0x3',
            },
            {
              number: height,
              hash: '0x4',
            },
            {
              number: height,
              hash: '0x5',
            },
          ],
        },
      }
      messenger.setBlocks(blocks)
      const calldatas = [
        {
          target: counter.address,
          callData: (await counter.populateTransaction.incSimple()).data,
          blockHeight: height + 1,
          txHash: '0x1',
          message: '0x0',
        },
        {
          target: counter.address,
          callData: (await counter.populateTransaction.incSimple()).data,
          blockHeight: height - 1,
          txHash: '0x2',
          message: '0x0',
        },
      ]
      // @ts-ignore
      const returns = await prover.handleSingleBlock(height, calldatas)
      expect(returns.length).to.equal(1)
      expect(returns[0].txHash).to.equal('0x5')
      expect(prover.highestProvenL2()).to.equal(height)
      expect(await counter.get()).to.equal(3)
      expect(succeededCalldatas.map((c) => c.txHash)).to.members([
        '0x3',
        '0x1',
        '0x2',
        '0x4',
      ])
    })
  })

  // describe('handleMultipleBlock', function () {
  //   it('succeed', async function () {
  //     const { counter, prover, messenger } = await setup()
  //     const highestKnown = 134
  //     const provenL2 = highestKnown - l2blockConfirmations
  //     const finalizedL2 = provenL2
  //     prover.updateHighestKnownL2(highestKnown)
  //     prover.updateHighestProvenL2(provenL2)
  //     prover.updateHighestFinalizedL2(finalizedL2)

  //     const blocks = {
  //       [provenL2]: {
  //         number: provenL2,
  //         transactions: [],
  //       },
  //       [provenL2 + 1]: {
  //         number: provenL2 + 1,
  //         transactions: [
  //           {
  //             number: provenL2 + 1,
  //             hash: '0x1',
  //           },
  //           {
  //             number: provenL2 + 1,
  //             hash: '0x2',
  //           },
  //         ],
  //       },
  //       [provenL2 + 2]: {
  //         number: provenL2 + 2,
  //         transactions: [
  //           {
  //             number: provenL2 + 2,
  //             hash: '0x3',
  //           },
  //           {
  //             number: provenL2 + 2,
  //             hash: '0x4',
  //           },
  //           {
  //             number: provenL2 + 2,
  //             hash: '0x5',
  //           },
  //         ],
  //       },
  //       [provenL2 + 3]: {
  //         number: provenL2 + 3,
  //         transactions: [
  //           {
  //             number: provenL2 + 3,
  //             hash: '0x6',
  //           },
  //         ],
  //       },
  //     }
  //     messenger.setBlocks(blocks)
  //     messenger.setBlockNumber(highestKnown + 2)
  //     // @ts-ignore
  //     await prover.handleMultipleBlock()

  //     expect(prover.highestKnownL2()).to.equal(highestKnown + 2)
  //     expect(prover.highestProvenL2()).to.equal(provenL2 + 2)
  //     expect(prover.highestFinalizedL2()).to.equal(finalizedL2)
  //     expect(await counter.get()).to.equal(4)
  //     expect(succeededCalldatas.map((c) => c.txHash)).to.members([
  //       '0x2',
  //       '0x3',
  //       '0x4',
  //       '0x5',
  //     ])
  //     expect(prover.startScanHeight()).to.equal(provenL2 + 3)
  //     expect(prover.endScanHeight()).to.equal(provenL2 + 2)

  //     messenger.setBlockNumber(highestKnown + 3)

  //     // @ts-ignore
  //     await prover.handleMultipleBlock()
  //     expect(prover.highestKnownL2()).to.equal(highestKnown + 3)
  //     expect(prover.highestProvenL2()).to.equal(provenL2 + 2)
  //     expect(prover.highestFinalizedL2()).to.equal(finalizedL2)
  //   })
  // })
})
