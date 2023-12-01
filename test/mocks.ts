import { MessageStatus } from '@eth-optimism/sdk'

export class MockCrossChain {
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
          target: contract.address
        }
      }
    }
    this.estimateGas = {
      finalizeMessage: async (txhash: any): Promise<bigint> => {
        return await contract.estimateGas.incSimple()
      }
    }
    this.populateTransaction = {
      finalizeMessage:  async (txhash: any): Promise<any> => {
        return await contract.populateTransaction.incSimple()
      }
    }
  }
  async getMessageStatus(message: any): Promise<any> {
    this.counter++

    if (this.counter <= 3) {
      return MessageStatus.READY_FOR_RELAY
    } else if (this.counter === 4) {
      return MessageStatus.RELAYED
    }

    return MessageStatus.IN_CHALLENGE_PERIOD
  }
}

export class MockLogger {
  debug(msg: string) { console.log(msg) }
  info(msg: string) { console.log(msg) }
}
