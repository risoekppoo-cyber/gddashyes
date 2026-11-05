import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {verifyTulip} from './verify.mjs';
const require = createRequire(import.meta.url);
const prototype = require('../hook-prototype.js');
if (!process.argv[2]) throw Error('Usage: node verify-node.mjs /path/to/original/gd.wasm');
const result = await verifyTulip(await readFile(process.argv[2]), prototype,
  await readFile(new URL('./dist/test-mod.wasm', import.meta.url)), message => process.stderr.write(message + '\n'));
console.log(JSON.stringify(result, null, 2));
