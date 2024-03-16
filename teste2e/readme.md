# How to Run End-to-End (E2E) Tests
E2E tests are conducted on top of the [private-opstack](https://github.com/oasysgames/private-opstack). Therefore, before running the test script, we need to start up the L1L2 chains.

## Setup
1. The first step is to copy sdk.js from the [private-opstack/bridge-tutorial](https://github.com/oasysgames/private-opstack/tree/main/bridge-tutorial):
```sh
cp ../../private-opstack/bridge-tutorial/src/lib/sdk.js lib/
```
2. Deploy and Mint ERC20/721 from [l1-l2-bridge-tutorial/contract](https://github.com/oasysgames/l1-l2-bridge-tutorial/tree/feat/v2/contract)
3. Edit the .env.sample:
```sh
cp .env.sample .env
```
4. Run setup.ts to bridge OAS/ERC20/721 for gas purposes:
```sh
npx ts-node setup.ts
```

## Execute Tests
To verify the entire process, run the relay.test.ts file. This ensures that the entire L2 withdrawal process is correctly executed, including proving and finalizing the withdrawal:
```sh
npx ts-node relay.test.ts
```

## Reset
```sh
rm ./state.test.json
```
