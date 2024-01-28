import { BytesLike } from '@ethersproject/bytes'
import { BigNumber, Contract, Signer } from 'ethers'
import { LowLevelMessage } from '@eth-optimism/sdk'
import IOasysPortal from './contracts/IOasysPortal.json'
import { splitArray } from './utils'

export type WithdrawMsgWithMeta = LowLevelMessage & {
  blockHeight: number
  txHash: string
  err: Error
}

type WithdrawalTransactionContractCall = {
  nonce: BigNumber
  sender: string
  target: string
  value: BigNumber
  gasLimit: BigNumber
  data: string
}

export class Portal {
  // the gas basically required gas except the gas for each additional tx in the withdraws tx array
  public baseGas: number = 0
  // the gas cost for each additional tx in the withdraws tx array
  public perWithdrawGas: number = 0
  // the estimated gas when the withdraws tx array has single item.
  // this value is used to compute the perWithdrawGas
  public singleWithdrawGas: number = 0
  public gasMultiplier: number
  public targetGas: number
  public contract: Contract

  constructor(
    portalAddress: string,
    wallet: Signer,
    targetGas: number = 1000000,
    gasMultiplier: number = 1.1
  ) {
    this.contract = new Contract(portalAddress, IOasysPortal.abi, wallet)
    this.targetGas = targetGas
    this.gasMultiplier = gasMultiplier
  }

  public setGasFieldsToEstimate(gas: number): void {
    if (this.perWithdrawGas !== 0) return
    if (this.singleWithdrawGas === 0) {
      this.singleWithdrawGas = gas
      return
    }
    this.perWithdrawGas = gas - this.singleWithdrawGas
    this.baseGas = this.singleWithdrawGas - this.perWithdrawGas
  }

  public isOverTargetGas(size: number): boolean {
    return this.targetGas < this.computeExpectedGas(size)
  }

  public async finalizeWithdrawals(
    withdraws: WithdrawMsgWithMeta[],
    callback: (hash: string, withdraws: WithdrawMsgWithMeta[]) => void
  ): Promise<WithdrawMsgWithMeta[]> {
    const calls = this.convertToCall(withdraws)
    let estimatedGas: BigNumber
    try {
      estimatedGas =
        await this.contract.estimateGas.finalizeWithdrawalTransactions(calls)
    } catch (err) {
      // reset per tx gas, if gas estimation is not accurate
      const expectedGas = this.computeExpectedGas(withdraws.length)
      if (expectedGas < Number(estimatedGas)) {
        this.perWithdrawGas = 0
        this.singleWithdrawGas = 0
      }

      // failed even single call, return as list of failed withdraws
      if (withdraws.length === 1) {
        withdraws[0].err = err
        return withdraws
      }

      // split the array in half and recursively call
      const [firstHalf, secondHalf] = splitArray(withdraws)
      const results = await this.finalizeWithdrawals(firstHalf, callback)
      return [
        ...results,
        ...(await this.finalizeWithdrawals(secondHalf, callback)),
      ]
    }

    const overrideOptions = {
      gasLimit: ~~(estimatedGas.toNumber() * (this.gasMultiplier || 1.0)),
    }
    const tx = await this.contract.finalizeWithdrawalTransactions(
      calls,
      overrideOptions
    )
    await tx.wait()

    if (callback) callback(tx.hash, withdraws)

    return []
  }

  // Compute expected gas cost
  private computeExpectedGas(size: number): number {
    return Math.floor(
      (this.baseGas + this.perWithdrawGas * size) * this.gasMultiplier
    )
  }

  public convertToCall(
    withdraws: WithdrawMsgWithMeta[]
  ): WithdrawalTransactionContractCall[] {
    return withdraws.map((msg) => ({
      nonce: msg.messageNonce,
      sender: msg.sender,
      target: msg.target,
      value: msg.value,
      gasLimit: msg.minGasLimit,
      data: msg.message,
    }))
  }
}