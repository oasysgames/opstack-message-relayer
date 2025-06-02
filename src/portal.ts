import { BigNumber, Contract, Signer } from 'ethers'
import { LowLevelMessage } from '@eth-optimism/sdk'
import IOasysPortal from './contracts/IOasysPortal.json'
import { splitArray } from './utils'
import { TransactionManager } from './transaction-manager'
import { L2toL1Message } from './finalize_worker'

export type WithdrawMsgWithMeta = LowLevelMessage & {
  l2toL1Msg: L2toL1Message
  err: Error | null
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
  private txmgr: TransactionManager | undefined

  constructor(
    portalAddress: string,
    wallet: Signer,
    targetGas: number = 1000000,
    gasMultiplier: number = 1.1,
    txmgr?: TransactionManager
  ) {
    this.contract = new Contract(portalAddress, IOasysPortal.abi, wallet)
    this.targetGas = targetGas
    this.gasMultiplier = gasMultiplier
    this.txmgr = txmgr
  }

  public setGasFieldsToEstimate(gas: number): void {
    if (this.perWithdrawGas !== 0) return
    if (this.singleWithdrawGas === 0) {
      this.singleWithdrawGas = gas
      return
    }
    const multiplier = 0.9 // this multiplier is obtained by testing
    this.perWithdrawGas = (gas - this.singleWithdrawGas) * multiplier
    this.baseGas = this.singleWithdrawGas - this.perWithdrawGas
  }

  public isOverTargetGas(size: number): boolean {
    return this.targetGas < this.computeExpectedGas(size)
  }

  // Return failed withdraws
  public async finalizeWithdrawals(
    withdraws: WithdrawMsgWithMeta[],
    callback: (
      hash: string,
      withdraws: WithdrawMsgWithMeta[]
    ) => void | null = null
  ): Promise<WithdrawMsgWithMeta[] /*failed list*/> {
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
      gasLimit: ~~(estimatedGas.toNumber() * this.gasMultiplier),
    }

    try {
      if (this.txmgr) {
        // enqueue the tx to the waiting list
        const populated =
          await this.contract.populateTransaction.finalizeWithdrawalTransactions(
            calls,
            overrideOptions
          )
        await this.txmgr.enqueueTransaction({ populated, meta: withdraws })
      } else {
        // send the tx directly
        const tx = await this.contract.finalizeWithdrawalTransactions(
          calls,
          overrideOptions
        )
        await tx.wait() // wait internally doesn't confirm block.
        if (callback) callback(tx.hash, withdraws)
      }
    } catch (err) {
      // if the tx failed, set the error to each withdraw
      for (const withdraw of withdraws) {
        withdraw.err = err as Error
      }
      return withdraws
    }

    return []
  }

  // Compute expected gas cost
  private computeExpectedGas(size: number): number {
    const expected =
      (this.baseGas + this.perWithdrawGas * size) * this.gasMultiplier
    return Math.floor(expected)
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
