import assert from 'node:assert/strict';
import {GuestCrt,CRT_NAMES} from '../experiments/geode-binary/windows-crt.mjs';
const memory=new WebAssembly.Memory({initial:4}),v=new DataView(memory.buffer),cpu=4096;
let next=100001;const freed=[],addresses=Object.fromEntries(CRT_NAMES.map((n,i)=>[n,100+i*16]));
const s=new GuestCrt(memory,addresses,{tib:16384,allocator:{malloc(n){const p=next;next+=n+8;return p;},free(p){freed.push(p);}}});
function call(name,a=0n,b=0n,c=0n){v.setBigUint64(cpu+8,BigInt(a),true);v.setBigUint64(cpu+16,BigInt(b),true);v.setBigUint64(cpu+64,BigInt(c),true);v.setBigUint64(cpu+32,9000n,true);v.setBigUint64(9000,12345n,true);s.invoke(cpu,BigInt(addresses[name]));assert.equal(v.getBigUint64(cpu+192,true),12345n);return v.getBigUint64(cpu,true);}
v.setUint16(20000,65,true);v.setUint16(20002,0xd83d,true);v.setUint16(20004,0xde00,true);v.setUint16(20006,0,true);
assert.equal(call('wcslen',20000),3n);assert.equal(call('strlen',20000),1n);
const p=call('malloc',32);assert.equal(p%16n,0n);
call('memset',p,123,32);assert.equal(v.getUint8(Number(p)+31),123);
const q=call('calloc',16,2);assert.equal(v.getUint8(Number(q)),0);
call('memcpy',q,p,32);assert.equal(call('memcmp',p,q,32),0n);
new Uint8Array(memory.buffer,Number(p),8).set([1,2,3,4,5,6,7,8]);call('memmove',p+2n,p,6);assert.deepEqual([...new Uint8Array(memory.buffer,Number(p),8)],[1,2,1,2,3,4,5,6]);
assert.throws(()=>call('memcpy',p+1n,p,4),/Overlapping/);
const r=call('realloc',p,64);assert.equal(v.getUint8(Number(r)),1);assert.equal(s.heap.has(Number(p)),false);
call('free',0);call('free',q);assert.throws(()=>call('free',q),/Unowned/);
assert.equal(call('malloc',0x100000000n),0n);assert.equal(s.errno,12);
s.releaseHeap();assert.equal(s.heap.size,0);assert.equal(freed.length,3);
console.log('PASS: UTF-16/string lengths, byte memory operations, aligned heap ownership, realloc and cleanup');
