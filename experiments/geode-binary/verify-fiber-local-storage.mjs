import assert from 'node:assert/strict';
import {FiberLocalStorage} from './fiber-local-storage.mjs';
const memory=new WebAssembly.Memory({initial:1}),v=new DataView(memory.buffer),cpu=4096;let error=42;
const fls=new FiberLocalStorage({capacity:2,setLastError:value=>error=value});
function call(name,a=0n,b=0n,context=1){v.setBigUint64(cpu+8,a,true);v.setBigUint64(cpu+16,b,true);v.setBigUint64(cpu+32,8192n,true);v.setBigUint64(8192,0x1234fedcn,true);const value=fls.invoke('kernel32.dll!'+name,memory,cpu,context);assert.equal(v.getBigUint64(cpu+192,true),0x1234fedcn);assert.equal(v.getBigUint64(cpu+32,true),8200n);return value;}
const a=call('FlsAlloc',0x120000n);assert.equal(a,0n);assert.equal(call('FlsGetValue',a),0n);assert.equal(error,42);assert.equal(call('FlsSetValue',a,0xdeadbeefn),1n);assert.equal(call('FlsGetValue',a),0xdeadbeefn);
const state=structuredClone(fls.snapshot());assert.throws(()=>call('FlsFree',a),/CLEANUP_CALLBACK_EXECUTION_REQUIRED/);assert.deepEqual(fls.snapshot(),state);assert.throws(()=>call('FlsGetValue',a,0n,2),/scheduler/);
const b=call('FlsAlloc');assert.equal(b,1n);assert.equal(call('FlsGetValue',b),0n);assert.equal(call('FlsAlloc'),0xffffffffn);assert.equal(error,8);
assert.equal(call('FlsSetValue',b,0xfedcba9876543210n),1n);assert.equal(call('FlsGetValue',b),0xfedcba9876543210n);assert.equal(call('FlsFree',b),1n);assert.equal(call('FlsGetValue',b),0n);assert.equal(error,87);
assert.equal(call('FlsAlloc'),b);assert.equal(call('FlsGetValue',b),0n);call('FlsSetValue',a,0n);assert.equal(call('FlsFree',a),1n);assert.throws(()=>call('FlsAlloc',0x100000000n),/address space/);
console.log('PASS: allocated FLS ownership, zero/reused slots, 64-bit values, bounded capacity, last-error failures and required native cleanup callbacks');
