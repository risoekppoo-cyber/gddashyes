import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {instantiateStartupLift} from '../experiments/geode-binary/handoff/startup-module.mjs';
const dir=new URL('../experiments/geode-binary/handoff/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('manifest.json',dir)));
const bytes=await readFile(new URL('prologue.wasm',dir));
assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.prologueSha256);
const memory=new WebAssembly.Memory({initial:160,maximum:65536});
const instance=await instantiateStartupLift(bytes,memory);
const cpu=4096,view=new DataView(memory.buffer);
for(const imageBase of [0x2000000,0x16000000])for(const [index,c] of manifest.cases.entries()){
  new Uint8Array(memory.buffer,cpu,4096).fill(0);
  c.initial.forEach((value,i)=>view.setBigUint64(cpu+i*8,BigInt(value),true));
  for(const bit of [0,2,4,6,7,11])view.setUint8(cpu+2560+bit,(c.flags>>>bit)&1);
  const expectedStack=Buffer.from(c.stackHex,'hex'),sp=Number(BigInt(c.initial[4]));
  // Pinned references use entry RSP=0x1f008 and window [0x1ee00,0x1f040).
  assert.equal(sp,0x1f008);assert.equal(expectedStack.length,576);
  const stackStart=0x1ee00;
  new Uint8Array(memory.buffer,stackStart,expectedStack.length).fill(0xa5);
  const entry=BigInt(imageBase+manifest.entry-0x2000000),stop=BigInt(imageBase+manifest.stop-0x2000000);
  const result=instance.exports.lift_run(cpu,entry,BigInt(imageBase),0,stop,32)>>>0;
  assert.equal(result&0x7fffffff,14);
  assert.equal(view.getBigUint64(cpu+192,true),stop);
  c.expected.forEach((value,i)=>assert.equal(view.getBigUint64(cpu+i*8,true),BigInt(value),`case ${index} GPR ${i}`));
  for(const bit of [0,2,4,6,7,11])assert.equal(view.getUint8(cpu+2560+bit),(c.expectedFlags>>>bit)&1,`case ${index} flag ${bit}`);
  assert.deepEqual(Buffer.from(memory.buffer,stackStart,expectedStack.length),expectedStack,`case ${index} stack`);
}
console.log(`PASS: real pinned prologue, ${manifest.cases.length} independent reference contexts at two image bases`);
