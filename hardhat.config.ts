import { HardhatUserConfig } from 'hardhat/types'
import 'hardhat-deploy'
import '@nomiclabs/hardhat-ethers'
import '@nomiclabs/hardhat-waffle'
import 'dotenv/config'

const DEPLOYER_KEY: string =
  process.env.DEPLOYER_KEY ||
  process.env.MESSAGE_RELAYER__PROVER_PRIVATE_KEY ||
  ''

const config: HardhatUserConfig = {
  networks: {
    hardhat: {
      blockGasLimit: 6133620,
    },
    layer1: {
      url: 'http://127.0.0.1:8545',
      accounts: [DEPLOYER_KEY],
    },
    layer2: {
      url: 'http://127.0.0.1:18545',
      accounts: [DEPLOYER_KEY],
    },
  },
  namedAccounts: {
    deployer: 0,
  },
  mocha: {
    timeout: 50000,
  },
  solidity: {
    compilers: [
      {
        version: '0.8.15',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: '0.8.19',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: '0.8.20',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
}

export default config
