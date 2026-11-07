import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GuestExceptionPtr,EXCEPTION_PTR_NAMES as names} from '../experiments/geode-binary/windows-exception-ptr.mjs';
const oracle=JSON.parse(await readFile(new URL('./exception-ptr-native-result.json',import.meta.url)));
assert.equal(oracle.status,'EMPTY_EXCEPTION_PTR_NATIVE_PASS');assert.equal(oracle.storageBytes,16);
const memory=new WebAssembly.Memory({initial:1}),v=new DataView(memory.buffer),cpu=4096,sp=9000,p=10000,q=11000,addresses=Object.fromEntries(names.map((n,i)=>[n,100+i*16])),s=new GuestExceptionPtr(memory,addresses);
new Uint8Array(memory.buffer,p-16,48).fill(0xa5);new Uint8Array(memory.buffer,q-16,48).fill(0xa5);
function call(i,a=p,b=q){v.setBigUint64(cpu+8,BigInt(a),true);v.setBigUint64(cpu+16,BigInt(b),true);v.setBigUint64(cpu+32,BigInt(sp),true);v.setBigUint64(sp,1234n,true);s.invoke(cpu,BigInt(addresses[names[i]]));assert.equal(v.getBigUint64(cpu+192,true),1234n);assert.equal(v.getBigUint64(cpu+32,true),BigInt(sp+8));}
function hex(a){return Buffer.from(memory.buffer,a,16).toString('hex');}
assert.throws(()=>call(1),/Unowned/);assert.throws(()=>call(0,0),/bounds/);assert.throws(()=>call(0,p+1),/Unaligned/);call(0);assert.equal(hex(p),oracle.observed.createHex);assert.throws(()=>call(0),/already/);
call(4);assert.equal(v.getBigUint64(cpu,true),0n);call(2,q,p);assert.equal(hex(q),oracle.observed.copyHex);call(3);call(3,p,p);call(1,q);assert.equal(hex(q),oracle.observed.destroyHex);assert.throws(()=>call(4,q),/Unowned/);
// Reject foreign/nonempty control blocks without overwriting their bytes.
v.setBigUint64(p+8,33n,true);assert.throws(()=>call(1),/Non-empty/);assert.throws(()=>call(2,q,p),/Non-empty/);assert.equal(v.getBigUint64(p+8,true),33n);v.setBigUint64(p+8,0n,true);call(1);call(0);call(1);
for(const a of [p,q])for(const offset of [-16,16])assert.deepEqual([...new Uint8Array(memory.buffer,a+offset,16)],Array(16).fill(0xa5));
assert.equal(s.resolve({dll:'MSVCP140.dll',name:names[0]}),100n);assert.equal(s.resolve({dll:'other.dll',name:names[0]}),undefined);
// Interior objects may be reused after their containing heap allocation dies.
let freed=0;const h=new GuestExceptionPtr(memory,addresses,{allocator:{malloc(){return 20000;},free(){freed++;}}});const block=h.allocate(64n);v.setBigUint64(cpu+8,block+16n,true);v.setBigUint64(cpu+32,BigInt(sp),true);h.invoke(cpu,100n);assert.equal(h.exceptionPointers.size,1);h.free(block);assert.equal(freed,1);assert.equal(h.exceptionPointers.size,0);h.releaseHeap();s.releaseHeap();
console.log('PASS: native-checked empty exception_ptr construction/copy/assignment/destruction, lifetime ownership, guards and non-empty rejection');
