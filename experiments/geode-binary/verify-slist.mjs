import assert from 'node:assert/strict';
import {SLists} from './slist.mjs';
const memory=new WebAssembly.Memory({initial:1}),v=new DataView(memory.buffer),cpu=4096,lists=new SLists();
function call(symbol,entry=0n,head=12288n){v.setBigUint64(cpu,42n,true);v.setBigUint64(cpu+8,head,true);v.setBigUint64(cpu+16,entry,true);v.setBigUint64(cpu+32,8192n,true);v.setBigUint64(8192,0x1234fedcn,true);const result=lists.invoke('kernel32.dll!'+symbol,memory,cpu);assert.equal(v.getBigUint64(cpu+192,true),0x1234fedcn);assert.equal(v.getBigUint64(cpu+32,true),8200n);return result;}
assert.throws(()=>call('InterlockedPushEntrySList',16384n),/INITIALIZATION_REQUIRED/);call('InitializeSListHead');assert.equal(v.getBigUint64(cpu,true),42n);assert.equal(call('InterlockedPushEntrySList',16384n),0n);assert.equal(v.getBigUint64(16384,true),0n);
assert.equal(call('InterlockedPushEntrySList',16400n),16384n);assert.equal(v.getBigUint64(16400,true),16384n);assert.equal(v.getUint16(12288,true),2);assert.equal(v.getBigUint64(12296,true),16400n);
assert.throws(()=>call('InitializeSListHead'),/CLEANUP/);assert.throws(()=>call('InterlockedPushEntrySList',16385n),/ALIGNMENT/);assert.throws(()=>call('InitializeSListHead',0n,12289n),/ALIGNMENT/);
v.setBigUint64(12296,0n,true);assert.throws(()=>call('InterlockedPushEntrySList',16416n),/NATIVE_HEADER_WRITE/);
console.log('PASS: initialized SList ownership, aligned LIFO links, previous-head return, public depth and unsupported external-header mutation');
