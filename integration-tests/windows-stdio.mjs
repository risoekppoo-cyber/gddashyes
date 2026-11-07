import assert from 'node:assert/strict';
import {GuestStdio,STDIO_NAMES,PROCESS_NAMES} from '../experiments/geode-binary/windows-stdio.mjs';
const memory=new WebAssembly.Memory({initial:2}),v=new DataView(memory.buffer),cpu=4096,sp=9000,mode=16000,addresses=Object.fromEntries([...STDIO_NAMES,...PROCESS_NAMES].map((n,i)=>[n,100+i*16]));let heap=32768;const live=new Set(),allocator={malloc(n){const p=heap;heap+=n;live.add(p);return p;},free(p){assert(live.delete(p));}},s=new GuestStdio(memory,addresses,{allocator});
function call(name,a=0,b=0){v.setBigUint64(cpu+8,BigInt(a),true);v.setBigUint64(cpu+16,BigInt(b),true);v.setBigUint64(cpu+32,BigInt(sp),true);v.setBigUint64(sp,321n,true);s.invoke(cpu,BigInt(addresses[name]));return v.getBigUint64(cpu,true);}
v.setUint8(mode,119);const stdout=call('__acrt_iob_func',1),stderr=call('__acrt_iob_func',2);assert.equal(stderr-stdout,88n);assert.equal(call('_fileno',stdout),1n);
const fd=call('_dup',1);assert.equal(fd,3n);assert.notEqual(call('_get_osfhandle',fd),call('_get_osfhandle',1));assert.equal(s.fds.get(3).channel,1);
const file=call('_fdopen',fd,mode);assert.equal(call('_fileno',file),fd);assert.equal(call('_close',fd),0n);assert.equal(call('_get_osfhandle',fd),0xffffffffffffffffn);assert.equal(s.errno,9);
assert.throws(()=>call('_fileno',1234),/Unowned/);assert.equal(call('GetCurrentProcessId'),1n);s.releaseHeap();assert.equal(live.size,0);
console.log('PASS: owned opaque FILE objects, descriptor duplication, distinct handles, fdopen identity and heap cleanup');
