// import { expect } from 'chai'
// import { ethers } from 'hardhat';
// import { Logger, logLevels } from '@eth-optimism/common-ts'
// import { Multicaller, CallWithMeta}  from '../src/multicaller'
// import Finalizer from '../src/finalizer'
// import { MockCrossChain, MockLogger } from './mocks'
// import { sleep, ZERO_ADDRESS } from '../src/utils'
// import {FinalizerMessage} from "../src/finalize_worker";
// import FinalizeWrorWrapper from '../src/finalize_work_wrapper'

// describe('FinalizeWrorWrapper', function () {
//   async function setup() {
//     const signers = await ethers.getSigners()
//     // deploy counter contract
//     const counter = await (
//       await ethers.getContractFactory('Counter')
//     ).deploy(0)
//     // deploy multicalll2 contract
//     const muticall = await (
//       await ethers.getContractFactory('Multicall2')
//     ).deploy()
//     // estimate single inc call gas
//     const callData = (await counter.populateTransaction.incSimple()).data
//     const singleCallGas = Number((await counter.estimateGas.incSimple()).toString())

//     const logger = new Logger({
//       name: 'finalizer_worker',
//       level: logLevels[1],
//     })

//   const valueHolder = {
//     value: 0,
//   }
//   const handler = (message: FinalizerMessage) => {
//     console.log("handled message in spec", message)
//     // valueHolder.value = message.highestFinalizedL2
//   }

//   // @ts-ignore
//   const worker = new FinalizeWrorWrapper(logger, 256, 100, logLevels[1], ZERO_ADDRESS, counter.address, "http://127.0.0.1:8545", 248, 15, "d1c71e71b06e248c8dbe94d49ef6d6b0d64f5d71b1e33a0f39e14dadb070304a", muticall.address, undefined, undefined, handler, true)

//     return {
//       signers,
//       counter,
//       callData,
//       singleCallGas,
//       valueHolder,
//       worker,
//     }
//   }

//   describe('terminate', function () {
//     it('succeed', async function () {
//       const { worker } = await setup()
//       worker.terminate()
//     })
//   })

//   describe('postMessage', function () {
//     const messages = [ { blockHeight: 1, txHash: "1", message: "1" }, { blockHeight: 2, txHash: "2", message: "2" } ]

//     it('succeed', async function () {
//       const { worker, valueHolder } = await setup()
//       // @ts-ignore
//       worker.postMessage(...messages)

//       await sleep(500)

//       expect(valueHolder.value).to.equal(2)
//       worker.terminate()
//     })
//   })
// })
