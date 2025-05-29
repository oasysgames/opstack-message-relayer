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

  // Return failed calls
  public async multicall(
    calls: CallWithMeta[],
    txmgr: TransactionManager | undefined,
    callback: (hash: string, calls: CallWithMeta[]) => void | null = null
  ): Promise<CallWithMeta[] /*failed list*/> {
    const requireSuccess = true
    let estimatedGas: BigNumber
    try {
      // simulate the call to check if it succeeds by estimating the gas required.
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
      const results = await this.multicall(firstHalf, txmgr, callback)
      return [
        ...results,
        ...(await this.multicall(secondHalf, txmgr, callback)),
      ]
    }

    const overrideOptions = {
      gasLimit: ~~(estimatedGas.toNumber() * this.gasMultiplier),
    }

    try {
      if (txmgr) {
        // enqueue the tx to the waiting list
        const populated = await this.contract.populateTransaction.tryAggregate(
          requireSuccess,
          this.convertToCalls(calls),
          overrideOptions
        )
        await txmgr.enqueueTransaction({ populated, meta: calls })
      } else {
        // send the tx directly
        const tx = await this.contract.tryAggregate(
          requireSuccess,
          this.convertToCalls(calls),
          overrideOptions
        )
        await tx.wait() // wait internally doesn't confirm block.
        if (callback) callback(tx.hash, calls)
      }
    } catch (err) {
      // if the tx failed, set the error to each call
      for (const call of calls) {
        call.err = err as Error
      }
      return calls
    }

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
