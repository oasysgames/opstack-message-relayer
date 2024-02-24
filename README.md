# message-relayer
Opstack message relayer developed using sdk

## Features
- Standalone Operation
  - Our system operates independently without the need for any middleware such as Redis. It features an internal queue functionality where items are stored on disk instead of in memory to enhance operational stability. Despite items being stored on disk, no database is utilized; instead, items are recorded as files using [node-localstorage](https://github.com/lmaccherone/node-localstorage).
- Utilization of Multicore
  - The Layer 2 (L2) withdrawal process is divided into two phases for security purposes, as derived from the operational stack: proof and finalize. The message-relayer runs two separate intervals to process these phases in different threads, ensuring they do not interfere with each other.
- Handling Reorg of Layer 2
  - In the context of the operational stack, L2 can undergo reorg. The message relayer is designed to manage this scenario. It's important to note that while the handling mechanism is robust, it is not foolproof. We operate under the assumption that the message relayer remains active, allowing for immediate detection of reorganizations, or it is temporarily halted and restarted once the reorganization has been fully addressed.

## Environment Variables
This section offers detailed explanations for certain environment variables that necessitate additional clarification.
- MESSAGE_RELAYER__LOOP_INTERVAL_MS
  - Sets the frequency (in milliseconds) at which the system checks the necessity for proof and finalize operations.
- MESSAGE_RELAYER__PROVER_PRIVATE_KEY
  - Defines the private key, in raw hexadecimal format, used for sending prove transactions.
- MESSAGE_RELAYER__FINALIZER_PRIVATE_KEY
  - Specifies the private key for sending finalize transactions. Don't use the same key as MESSAGE_RELAYER__PROVER_PRIVATE_KEY.
  - Set the same address as `messageRelayer` key of OasysPortal to use instant verifier
- MESSAGE_RELAYER__STATE_FILE_PATH
  - Indicates the path to the file where the last checked block height is recorded. Manual modifications should be avoided except in exceptional circumstances, such as during an incident response.
- MESSAGE_RELAYER__QUEUE_PATH
  - Designates the directory path where pending finalize withdrawals are queued for processing.
- MESSAGE_RELAYER__DEPOSIT_CONFIRMATION_BLOCKS
  - Determines the number of block confirmations required before starting the finalize process.
- MESSAGE_RELAYER__REORG_SAFETY_DEPTH
  - This variable is crucial for handloing blockchain reorg. There is typically a delay in reorg detection; if this delay allows the reorganized chain to grow beyond the height at which transactions were proven, the message relayer may fail to recognize that a reorg has occurred. To mitigate this risk, a safety depth is set. As long as reorg are detected within this predefined depth, the system remains secure.

## Starting the Service
Follow these steps to get the service up and running:
1. Install Dependencies
```sh
pnpm install
```
2. Deploy Multisig
Deploy the multisig if you haven't done so already.
```sh
pnpm run deploy
```
3. Configure Environment Variables
```sh
# Copy the example environment file:
cp .env.example .env

# Edit the .env file to set your environment variables:
vi .env
```
4. Launch the Service
```sh
pnpm start
```

## Help Instructions
To access help information, run the following command:
```sh
npx tsx ./src/service.ts -h
```

## FAQ
> Q. What should I do if there are withdrawals that have skipped prove or finalize? How can I recover them?

A: First, stop the service. Then, manually edit the state file. The default location of the state file is written on the .env.example. This file maintains the starting height for proof withdrawal operations. To recover skipped withdrawals, adjust the height to a point before the skipped withdrawals were initiated. The only property you need to edit is `highestProvenL2`, even if the skipped operation is finalize; `highestFinalizedL2` does not need to be adjusted.

## API Usage
Here are the commands to interact with the service's API:
1. Health Check
To verify that the service is running and healthy, execute:
```sh
curl http://127.0.0.1:7300/healthz | jq
```
2. Status Information
To display the current status of the service, use:
```sh
curl http://127.0.0.1:7300/api/status | jq
```
3. Metrics
For metrics related to the service's performance, enter:
```sh
curl http://127.0.0.1:7300/metrics
```
