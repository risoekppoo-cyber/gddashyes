import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';import {instantiateStartupLift} from '../startup-module.mjs';
const dir=process.argv[2]??new URL('.',import.meta.url),load=file=>readFile(typeof dir==='string'?dir+'/'+file:new URL(file,dir));
const m=JSON.parse(await load('manifest.json')),memory=new WebAssembly.Memory({initial:256}),instance=await instantiateStartupLift(await load('prologue.wasm'),memory),v=new DataView(memory.buffer),cpu=4096;
const flags=[[0,2560],[2,2562],[4,2564],[6,2566],[7,2567],[11,2571]];
for(const c of m.cases){new Uint8Array(memory.buffer,cpu,4096).fill(0);for(let i=0;i<16;i++)v.setBigUint64(cpu+i*8,BigInt(c.initial[i]),true);for(const [bit,offset] of flags)v.setUint8(cpu+offset,(c.flags>>bit)&1);new Uint8Array(memory.buffer,0x1ee00,0x240).fill(0xa5);
 const result=instance.exports.lift_run(cpu,BigInt(m.entry),0x2000000n,0,BigInt(m.stop),32)>>>0;assert.equal(result&0x7fffffff,14);
 for(let i=0;i<16;i++)assert.equal(v.getBigUint64(cpu+i*8,true),BigInt(c.expected[i]));for(const [bit,offset] of flags)assert.equal(v.getUint8(cpu+offset),(c.expectedFlags>>bit)&1);assert.equal(v.getBigUint64(cpu+192,true),BigInt(m.stop));assert.equal(Buffer.from(memory.buffer,0x1ee00,0x240).toString('hex'),c.stackHex);
}
console.log(JSON.stringify({status:'GEODE_DEFERRED_PROLOGUE_NATIVE_PASS',cases:m.cases.length,instructions:14,firstCallNotExecuted:true,fullGeodeLoader:false}));
