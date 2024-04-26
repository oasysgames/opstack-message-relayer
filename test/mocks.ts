import { MessageStatus, LowLevelMessage } from '@eth-optimism/sdk'
import { ZERO_ADDRESS } from '../src/utils'
import { BigNumber } from 'ethers'

export class MockCrossChain {
  private l1Provider: any
  private contract: any
  private contracts: any
  private estimateGas: any
  private populateTransaction: any
  private counter: number = 0
  init(contract: any) {
    this.contract = contract
    this.contracts = {
      l1: {
        OptimismPortal: {
          target: contract.address,
          provenWithdrawals: () => {
            if (this.counter <= 4) {
              return {
                timestamp: BigNumber.from(9999999999),
              }
            }
            return {
              timestamp: BigNumber.from(0),
            }
          },
        },
      },
    }
    this.estimateGas = {
      finalizeMessage: async (txhash: any): Promise<bigint> => {
        return await contract.estimateGas.incSimple()
      },
    }
    this.populateTransaction = {
      finalizeMessage: async (txhash: any): Promise<any> => {
        return await contract.populateTransaction.incSimple()
      },
    }
  }
  async getMessageStatus(message: any): Promise<any> {
    this.counter++

    if (this.counter <= 3) {
      return MessageStatus.READY_FOR_RELAY
    } else if (this.counter <= 5) {
      return MessageStatus.IN_CHALLENGE_PERIOD
    }
    return MessageStatus.RELAYED
  }

  async toLowLevelMessage(message: any): Promise<LowLevelMessage> {
    return {
      sender: ZERO_ADDRESS,
      target: ZERO_ADDRESS,
      message,
      messageNonce: BigNumber.from(0),
      value: BigNumber.from(0),
      minGasLimit: BigNumber.from(123456),
    }
  }
}

export class MockCrossChainForProver {
  private contract: any
  private contracts: any
  private estimateGas: any
  private populateTransaction: any
  private counter: number = 0
  private blocks: any
  private blockNumber: number = 0
  init(contract: any) {
    this.contract = contract
    this.contracts = {
      l1: {
        OptimismPortal: {
          target: contract.address,
        },
      },
    }
    this.estimateGas = {
      proveMessage: async (txhash: any): Promise<bigint> => {
        return await contract.estimateGas.incSimple()
      },
    }
    this.populateTransaction = {
      proveMessage: async (txhash: any): Promise<any> => {
        return await contract.populateTransaction.incSimple()
      },
    }
  }
  setBlocks(blocks: any) {
    this.blocks = blocks
  }
  async toCrossChainMessage(txHash: any): Promise<any> {
    return null
  }
  async getMessagesByTransaction(txHash: any): Promise<any> {
    return ['message']
  }
  async getMessageStatus(message: any): Promise<any> {
    this.counter++

    if (this.counter <= 1) {
      return MessageStatus.IN_CHALLENGE_PERIOD
    } else if (this.counter <= 5) {
      return MessageStatus.READY_TO_PROVE
    }

    return MessageStatus.STATE_ROOT_NOT_PUBLISHED
  }
  setBlockNumber(blockNumber: number) {
    this.blockNumber = blockNumber
  }
  public l2Provider: {
    getBlockWithTransactions: (height: number) => any
    getBlockNumber: () => any
  } = {
    getBlockWithTransactions: (height: number) => {
      return this.blocks[height]
    },
    getBlockNumber: () => {
      return this.blockNumber
    },
  }
}

export class MockLogger {
  debug(msg: string) {
    console.log(msg)
  }
  info(msg: string) {
    console.log(msg)
  }
  warn(msg: string) {
    console.log(msg)
  }
  error(msg: string) {
    console.log(msg)
  }
}

export class MockMetrics {
  public highestKnownL2: {
    set: (val: number) => void
  } = {
    set: (val: number) => {},
  }
  public highestProvenL2: {
    set: (val: number) => void
  } = {
    set: (val: number) => {},
  }
  public highestFinalizedL2: {
    set: (val: number) => void
  } = {
    set: (val: number) => {},
  }
  public numProvenMessages: {
    inc: () => void
  } = {
    inc: () => {},
  }
  public numFinalizedMessages: {
    inc: () => void
  } = {
    inc: () => {},
  }
}
