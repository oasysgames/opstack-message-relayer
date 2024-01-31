import { HardhatUserConfig } from 'hardhat/types'
import "hardhat-deploy";
import '@nomiclabs/hardhat-ethers'
import '@nomiclabs/hardhat-waffle'
import 'dotenv/config'

const DEPLOYER_KEY: string = process.env.DEPLOYER_KEY || process.env.MESSAGE_RELAYER__L1_WALLET || "";

const config: HardhatUserConfig = {
  networks: {
    hardhat: {
      blockGasLimit: 6133620
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      accounts: [DEPLOYER_KEY]
    },
  },
  namedAccounts: {
		deployer: 0
	},
  mocha: {
    timeout: 50000,
  },
  solidity: "0.8.19",
};

export default config;
