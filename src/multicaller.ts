import { BytesLike } from '@ethersproject/bytes'
import { BigNumber, Contract, Signer } from 'ethers'
import { CrossChainMessage } from '@eth-optimism/sdk'
import Multicall2 from './contracts/Multicall2.json'
import { splitArray } from './utils'
import { TransactionManager } from './transaction-manager'

export type Call = {
  target: string
  callData: BytesLike
}

export type CallWithMeta = Call & {
  blockHeight: number
  txHash: string
  message: CrossChainMessage
  err: Error
}

export class Multicaller {
  public singleCallGas: number = 0
  public gasMultiplier: number
  public targetGas: number
  public contract: Contract

  constructor(
    multicallAddress: string,
    wallet: Signer,
    targetGas: number = 1000000,
    gasMultiplier: number = 1.1
  ) {
    this.contract = new Contract(multicallAddress, Multicall2.abi, wallet)
    this.targetGas = targetGas
    this.gasMultiplier = gasMultiplier
  }

  public isOverTargetGas(size: number): boolean {
    return this.targetGas < this.computeExpectedMulticallGas(size)
  }

  public async multicall(
    calls: CallWithMeta[],
    transactionManager: TransactionManager,
    callbackSuccess: (calls: CallWithMeta[]) => void | null,
    callbackError: (calls: CallWithMeta[]) => void | null
  ): Promise<CallWithMeta[]> {
    const requireSuccess = true
    let estimatedGas: BigNumber
    try {
      estimatedGas = await this.contract.estimateGas.tryAggregate(
        requireSuccess,
        this.convertToCalls(calls)
      )
    } catch (err) {
      // reset single call gas, if gas estimation is not accurate
      const expectedGas = this.computeExpectedMulticallGas(calls.length)
      if (expectedGas < Number(estimatedGas)) {
        this.singleCallGas = 0
      }

      // failed even single call, return as list of failed calls
      if (calls.length === 1) {
        calls[0].err = err
        return calls
      }

      // split the array in half and recursively call
      const [firstHalf, secondHalf] = splitArray(calls)
      const results = await this.multicall(
        firstHalf,
        transactionManager,
        callbackSuccess,
        callbackError
      )
      return [
        ...results,
        ...(await this.multicall(
          secondHalf,
          transactionManager,
          callbackSuccess,
          callbackError
        )),
      ]
    }

    const overrideOptions = {
      gasLimit: ~~(estimatedGas.toNumber() * (this.gasMultiplier || 1.0)),
    }
    const tx = await this.contract.populateTransaction.tryAggregate(
      requireSuccess,
      this.convertToCalls(calls),
      overrideOptions
    )
    const txData = { ...tx, originData: calls }
    await transactionManager.enqueueTransaction(
      txData,
      callbackSuccess,
      callbackError
    )

    return []
  }

  // Compute expected gas cost of multicall
  // from multiplying the first gas cost of proveMessage by the number of messages
  private computeExpectedMulticallGas(size: number): number {
    return Math.floor(this.singleCallGas * size * this.gasMultiplier)
  }

  private convertToCalls(calls: CallWithMeta[]): Call[] {
    return calls.map(
      ({ blockHeight, txHash, message, err, ...callProps }) => callProps
    )
  }
}
