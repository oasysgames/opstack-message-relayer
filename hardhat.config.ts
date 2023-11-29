import { HardhatUserConfig } from 'hardhat/types'

import '@nomiclabs/hardhat-ethers'
import '@nomiclabs/hardhat-waffle'

const config: HardhatUserConfig = {
  networks: {
    hardhat: {
      blockGasLimit: 6133620
    },
  },
  mocha: {
    timeout: 50000,
  },
  solidity: "0.8.19",
};

export default config;
