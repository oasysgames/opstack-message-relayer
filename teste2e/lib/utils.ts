import Web3 from 'web3'
import { Wallet, providers } from 'ethers'

const OptimiscticERC20 = [
  {
    inputs: [
      {
        internalType: 'address',
        name: '_bridge',
        type: 'address',
      },
    ],
    stateMutability: 'nonpayable',
    type: 'constructor',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'localToken',
        type: 'address',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'remoteToken',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'address',
        name: 'deployer',
        type: 'address',
      },
    ],
    name: 'OptimismMintableERC20Created',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'remoteToken',
        type: 'address',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'localToken',
        type: 'address',
      },
    ],
    name: 'StandardL2TokenCreated',
    type: 'event',
  },
  {
    inputs: [],
    name: 'BRIDGE',
    outputs: [
      {
        internalType: 'address',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'bridge',
    outputs: [
      {
        internalType: 'address',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: '_remoteToken',
        type: 'address',
      },
      {
        internalType: 'string',
        name: '_name',
        type: 'string',
      },
      {
        internalType: 'string',
        name: '_symbol',
        type: 'string',
      },
    ],
    name: 'createOptimismMintableERC20',
    outputs: [
      {
        internalType: 'address',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: '_remoteToken',
        type: 'address',
      },
      {
        internalType: 'string',
        name: '_name',
        type: 'string',
      },
      {
        internalType: 'string',
        name: '_symbol',
        type: 'string',
      },
      {
        internalType: 'uint8',
        name: '_decimals',
        type: 'uint8',
      },
    ],
    name: 'createOptimismMintableERC20WithDecimals',
    outputs: [
      {
        internalType: 'address',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: '_remoteToken',
        type: 'address',
      },
      {
        internalType: 'string',
        name: '_name',
        type: 'string',
      },
      {
        internalType: 'string',
        name: '_symbol',
        type: 'string',
      },
    ],
    name: 'createStandardL2Token',
    outputs: [
      {
        internalType: 'address',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'version',
    outputs: [
      {
        internalType: 'string',
        name: '',
        type: 'string',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
]

const OptimiscticERC721 = [
  {
    inputs: [
      {
        internalType: 'address',
        name: '_bridge',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: '_remoteChainId',
        type: 'uint256',
      },
    ],
    stateMutability: 'nonpayable',
    type: 'constructor',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'localToken',
        type: 'address',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'remoteToken',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'address',
        name: 'deployer',
        type: 'address',
      },
    ],
    name: 'OptimismMintableERC721Created',
    type: 'event',
  },
  {
    inputs: [],
    name: 'BRIDGE',
    outputs: [
      {
        internalType: 'address',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'REMOTE_CHAIN_ID',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: '_remoteToken',
        type: 'address',
      },
      {
        internalType: 'string',
        name: '_name',
        type: 'string',
      },
      {
        internalType: 'string',
        name: '_symbol',
        type: 'string',
      },
    ],
    name: 'createOptimismMintableERC721',
    outputs: [
      {
        internalType: 'address',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: '',
        type: 'address',
      },
    ],
    name: 'isOptimismMintableERC721',
    outputs: [
      {
        internalType: 'bool',
        name: '',
        type: 'bool',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'version',
    outputs: [
      {
        internalType: 'string',
        name: '',
        type: 'string',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
]

// function return address of token erc20 on layer2
export async function createOptimisticERC20(
  factoryContract: string,
  signer: Wallet,
  remoteAddress: string,
  provider: providers.JsonRpcProvider
): Promise<string> {
  const web3 = new Web3(provider.connection.url)

  const txCount = await web3.eth.getTransactionCount(signer.address)

  const contract = new web3.eth.Contract(OptimiscticERC20)

  const txData = contract.methods
    .createOptimismMintableERC20(remoteAddress, `NAME${Date.now()}`, 'SYMBOL')
    .encodeABI()

  //using ETH
  const txObj = {
    nonce: txCount,
    data: txData,
    to: factoryContract,
    from: signer.address,
    gas: '1000000',
    gasPrice: '0',
  }

  const signedTx = await web3.eth.accounts.signTransaction(
    txObj,
    signer.privateKey
  )

  const result = await web3.eth.sendSignedTransaction(signedTx.rawTransaction!)

  return '0x' + result.logs[1].topics![1].toString().slice(26)
}

export async function createOptimisticERC721(
  factoryContract: string,
  signer: Wallet,
  remoteAddress: string,
  provider: providers.JsonRpcProvider
): Promise<string> {
  const web3 = new Web3(provider.connection.url)

  const txCount = await web3.eth.getTransactionCount(signer.address)

  const contract = new web3.eth.Contract(OptimiscticERC721)

  const txData = contract.methods
    .createOptimismMintableERC721(remoteAddress, `NAME${Date.now()}`, 'SYMBOL')
    .encodeABI()

  //using ETH
  const txObj = {
    nonce: txCount,
    data: txData,
    to: factoryContract,
    from: signer.address,
    gas: '10000000',
    gasPrice: '0',
  }

  const signedTx = await web3.eth.accounts.signTransaction(
    txObj,
    signer.privateKey
  )

  const result = await web3.eth.sendSignedTransaction(signedTx.rawTransaction!)

  console.log('0x' + result.logs[0].topics![1].toString().slice(26))
  return '0x' + result.logs[0].topics![1].toString().slice(26)
}
