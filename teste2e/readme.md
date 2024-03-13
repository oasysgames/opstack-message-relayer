# How to Run End-to-End (E2E) Tests
E2E tests are conducted on top of the [private-opstack](https://github.com/oasysgames/private-opstack). Therefore, before running the test script, we need to start up the L1L2 chains.

## Setup
1. The first step is to copy sdk.js from the [bridge-tutorial](https://github.com/oasysgames/private-opstack/tree/main/bridge-tutorial):
```sh
cp ../../private-opstack/bridge-tutorial/src/lib/sdk.js lib/
```
1. Deploy Mock L1/L2 ERC20 Token, Factory 
```sh
npx hardhat deploy --network layer1 --tags l1-erc20
npx hardhat deploy --network layer1 --tags l1-erc721
npx hardhat deploy --network layer1 --tags factory-erc20
npx hardhat deploy --network layer1 --tags factory-erc721

```

From deployment fill addresses FACTORY_ERC20, FACTORY_ERC721, L1_ERC20, L1_ERC721 on file .envrc
2. Edit the .envrc file to export a private key. This key is used to bridge OAS to L2. The bridged OAS will be utilized for L2 gas costs. Then, apply the environment file:
```sh
direnv allow .
```
1. Run setup.ts to bridge OAS for gas purposes:
```sh
npx ts-node setup.ts
```

## Execute Tests
To verify the entire process, run the relay.test.ts file. This ensures that the entire L2 withdrawal process is correctly executed, including proving and finalizing the withdrawal:

OAS Testing
```sh
npx ts-node relay.oas.test.ts
```

ERC20 Testing
```sh
npx ts-node relay.erc20.test.ts
```

## Reset
```sh
rm ./state.test.json
```
