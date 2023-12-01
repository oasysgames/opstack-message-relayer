// To support typescript in worker thread, we need to register ts-node
// Refercence: https://wanago.io/2019/05/06/node-js-typescript-12-worker-threads/
const path = require('path')
require('ts-node').register()
require(path.resolve(__dirname, './finalize_worker.ts'))
