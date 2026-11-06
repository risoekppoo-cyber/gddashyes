import assert from 'node:assert/strict';
import {NativeInitializers} from './native-initializers.mjs';
import {OnExitTables} from './onexit-tables.mjs';
const memory=new WebAssembly.Memory({initial:128}),v=new DataView(memory.buffer),cpu=4096;
const setup=()=>{v.setBigUint64(cpu+8,8192n,true);v.setBigUint64(cpu+16,8216n,true);v.setBigUint64(cpu+32,16392n,true);v.setBigUint64(16392,0x1234fedcn,true);
 v.setBigUint64(8192,0x1000010n,true);v.setBigUint64(8200,0n,true);v.setBigUint64(8208,0x1000020n,true);};
const returned=(init,result)=>{const f=init.frames.at(-1);v.setBigUint64(cpu,BigInt(result),true);v.setBigUint64(cpu+32,f.callbackSp+8n,true);v.setBigUint64(cpu+192,f.sentinel,true);init.resume(memory,cpu);};
setup();let init=new NativeInitializers();init.begin('_initterm_e',memory,cpu);
assert.equal(v.getBigUint64(cpu+192,true),0x1000010n);assert.equal(v.getBigUint64(cpu+32,true)%16n,8n);
returned(init,0);assert.equal(v.getBigUint64(cpu+192,true),0x1000020n);
returned(init,0);assert.equal(init.completedTables,1);assert.equal(v.getBigUint64(cpu+192,true),0x1234fedcn);assert.equal(v.getBigUint64(cpu+32,true),16400n);
setup();init=new NativeInitializers();init.begin('_initterm_e',memory,cpu);returned(init,7);
assert.equal(init.callbackCount,1);assert.equal(v.getBigUint64(cpu,true),7n);assert.equal(init.frames.length,0);
setup();init=new NativeInitializers();init.begin('_initterm',memory,cpu);returned(init,7);
assert.equal(init.callbackCount,2);returned(init,8);assert.equal(init.frames.length,0);
setup();v.setBigUint64(cpu+16,8191n,true);assert.throws(()=>new NativeInitializers().begin('_initterm_e',memory,cpu),/Invalid/);
const tables=new OnExitTables();new Uint8Array(memory.buffer,8192,24).fill(0);
for(let n=0;n<10;n++){
 v.setBigUint64(cpu+8,8192n,true);v.setBigUint64(cpu+16,BigInt(0x1000010+n*16),true);v.setBigUint64(cpu+32,16392n,true);
 tables.register(memory,cpu);assert.equal(v.getBigUint64(cpu,true),0n);
}
assert.equal(tables.registrations,10);
const first=v.getBigUint64(8192,true);assert.equal(v.getBigUint64(8200,true)-first,80n);
for(let n=0;n<10;n++)assert.equal(v.getBigUint64(Number(first)+n*8,true),BigInt(0x1000010+n*16));
v.setBigUint64(cpu+8,0n,true);v.setBigUint64(cpu+32,16392n,true);tables.register(memory,cpu);assert.equal(v.getBigUint64(cpu,true),0xffffffffn);
console.log('PASS: actual initializer call scheduling, NULL skipping, failure propagation, void callbacks and CRT callback-array growth');
