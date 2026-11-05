import {readFile} from 'node:fs/promises';
import {verifyIndirect} from './verify.mjs';
const read=p=>readFile(new URL(p,import.meta.url));
const [fixture,geode,reference]=await Promise.all([read('fixture.wasm'),read('geode.wasm'),read('reference.json').then(JSON.parse)]);
console.log(JSON.stringify(await verifyIndirect(fixture,geode,reference),null,2));
