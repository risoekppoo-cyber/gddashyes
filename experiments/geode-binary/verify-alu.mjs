import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {instantiateStartupLift} from './startup-module.mjs';
const dir=process.argv[2],reference=JSON.parse(await readFile(dir+'/alu.json'));
const memory=new WebAssembly.Memory({initial:256,maximum:65536});
const instance=await instantiateStartupLift(await readFile(dir+'/alu.wasm'),memory),cpu=4096;
for(const test of reference.cases){
 new Uint8Array(memory.buffer,cpu,4096).fill(0);const v=new DataView(memory.buffer);
 for(let i=0;i<16;i++)v.setBigUint64(cpu+i*8,BigInt(test.initial[i]),true);
 new Uint8Array(memory.buffer,0x12000,80).set(Buffer.from(test.data,'hex'));v.setBigUint64(0x1f008,0x1234fedcn,true);
 let error;try{instance.exports.lift_run(cpu,BigInt(test.entry),BigInt(reference.base),0,0x1234fedcn,64);}catch(e){error=e;}
 if(test.fault)assert.match(String(error),/fault 5/);else assert.equal(error,undefined);
 for(let i=0;i<16;i++)assert.equal(v.getBigUint64(cpu+i*8,true),BigInt(test.expected[i]),'GPR '+i);
 assert.equal(v.getBigUint64(cpu+192,true),BigInt(test.pc));
 for(let i=0;i<16;i++)assert.equal(v.getBigUint64(cpu+256+i*16,true)|(v.getBigUint64(cpu+264+i*16,true)<<64n),BigInt(test.xmm[i]),'XMM '+i);
 assert.equal(Buffer.from(memory.buffer,0x12040,16).toString('hex'),test.output);
}
console.log('PASS:',reference.cases.length,'native-reference DIV/IDIV, divide errors and SSE overlapping-temporary cases');
