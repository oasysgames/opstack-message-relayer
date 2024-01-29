import * as ethers from 'ethers'

export const Gwei = BigInt(1e9)
export const Ether = Gwei * Gwei // 10^18

export const ERC20ABI = {
  inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
  name: 'balanceOf',
  outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
  stateMutability: 'view',
  type: 'function',
}

export const ERC721ABI = {
  inputs: [{ internalType: 'uint256', name: 'id', type: 'uint256' }],
  name: 'ownerOf',
  outputs: [{ internalType: 'address', name: 'owner', type: 'address' }],
  stateMutability: 'view',
  type: 'function',
}

export const log = (...lines: string[]) =>
  process.stdout.write(lines.join('\n'))

export const toGwei = (b: ethers.BigNumber): string =>
  b.isZero() ? '0' : b.toString().slice(0, -9)

type Network = 'l1' | 'l2'
export class BalanceLogger {
  _hist: { [n in Network]: ethers.BigNumber[] } = { l1: [], l2: [] }

  constructor(
    public opts: {
      l1Provider: ethers.providers.JsonRpcProvider
      l2Provider: ethers.providers.JsonRpcProvider
      l1Address: string
      l2Address: string
    }
  ) {}

  async update() {
    this._hist.l1.push(
      await this.opts.l1Provider.getBalance(this.opts.l1Address)
    )
    this._hist.l2.push(
      await this.opts.l2Provider.getBalance(this.opts.l2Address)
    )
  }

  current(n: Network, receipt?: ethers.ContractReceipt): string {
    const current = this._hist[n].slice(-1)[0] || ethers.BigNumber.from(0)
    const diff = this._diff(n, receipt)
    return `${toGwei(current)} Gwei ${diff}`
  }

  _diff(n: Network, receipt?: ethers.ContractReceipt): string {
    let [a, b] = this._hist[n].slice(-2)
    if (!a || !b) {
      return ''
    }

    let c = b.sub(a)
    if (!receipt) {
      const prefix = c.gte('0') ? '+' : ''
      return `(${prefix}${toGwei(c)} Gwei)`
    }

    const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice)
    c = c.add(gasUsed)
    return c.gte('0')
      ? `(+${toGwei(c.sub(gasUsed))} Gwei, gas: -${toGwei(gasUsed)} Gwei)`
      : `(${toGwei(c)} Gwei, gas: -${toGwei(gasUsed)} Gwei)`
  }
}

export const createWallets = (
  size: number,
  accounts: ethers.BytesLike[] = []
): ethers.Wallet[] => {
  const wallets: ethers.Wallet[] = []
  for (let i = 0; i < size; i++) {
    if (accounts.length > i) {
      wallets.push(new ethers.Wallet(accounts[i]))
      continue
    }
    wallets.push(ethers.Wallet.createRandom())
  }
  return wallets
}

export const abbreviateTxHash = (
  str: string,
  frontChars: number = 4,
  endChars: number = 4
): string => {
  if (str.length <= frontChars + endChars) {
    return str
  }
  return (
    str.substring(0, frontChars) + '..' + str.substring(str.length - endChars)
  )
}
