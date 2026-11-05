'use strict';
const fs = require('node:fs');
const prototype = require('./hook-prototype.js');
const verify = require('./verify-runtime.js');
(async () => {
  if (!process.argv[2]) throw Error('Usage: node experiments/verify-hook.cjs /path/to/gd.wasm');
  const result = await verify(fs.readFileSync(process.argv[2]), prototype,
    message => process.stderr.write(message + '\n'));
  console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
