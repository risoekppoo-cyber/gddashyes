import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {verifySdk} from './verify.mjs';
const require=createRequire(import.meta.url);
const result=await verifySdk(await readFile(process.argv[2]),require('../hook-prototype.js'),
  await readFile(new URL('./dist/menu-mod.wasm',import.meta.url)),s=>process.stderr.write(s+'\n'));
console.log(JSON.stringify(result,null,2));
