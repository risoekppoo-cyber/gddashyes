import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GuestMsvcMutex,MSVC_MUTEX_NAMES as names} from '../experiments/geode-binary/windows-msvc-mutex.mjs';
const native=JSON.parse(await readFile(new URL('./msvc-mutex-native-result.json',import.meta.url)));
assert.equal(native.status,'MSVC_MUTEX_NATIVE_PASS');assert.equal(native.storageBytes,80);
assert.deepEqual(native.offsets,{type:0,unused:8,srw:16,owner:72,count:76});
const memory=new WebAssembly.Memory({initial:1}),cpu=4096,sp=9000,p=20000,v=new DataView(memory.buffer),addresses=Object.fromEntries(names.map((n,i)=>[n,100+i*16])),s=new GuestMsvcMutex(memory,addresses,{tib:12000}),root=s.threadState;
function call(name,a=p,b=0,service=s){v.setBigUint64(cpu+8,BigInt(a),true);v.setBigUint64(cpu+16,BigInt(b),true);v.setBigUint64(cpu+32,BigInt(sp),true);v.setBigUint64(sp,1234n,true);service.invoke(cpu,BigInt(addresses[name]));assert.equal(v.getBigUint64(cpu+192,true),1234n);assert.equal(v.getBigUint64(cpu+32,true),BigInt(sp+8));return Number(v.getBigUint64(cpu,true));}
function hex(a=p){return Buffer.from(memory.buffer,a,80).toString('hex');}
for(const profile of native.profiles){
 new Uint8Array(memory.buffer,p-16,112).fill(0xa5);
 call('_Mtx_init_in_situ',p,profile.type);assert.equal(hex(),profile.states[0].hex);assert.equal(call('_Mtx_current_owns'),0);
 assert.equal(call('_Mtx_lock'),0);assert.equal(hex(),profile.states[1].hex);assert.equal(call('_Mtx_current_owns'),1);assert.ok(s.held.has(p+16));assert.equal(s.srwOwners.get(p+16),1);
 s.selectThread({id:2,tib:14000,errno:0});assert.equal(call('_Mtx_trylock'),profile.otherThread.tryResult);assert.equal(call('_Mtx_current_owns'),0);assert.equal(hex(),profile.states[2].hex);
 const before=hex();assert.throws(()=>call('_Mtx_lock'),/scheduler blocking/);assert.throws(()=>call('_Mtx_unlock'),/Unowned/);assert.equal(hex(),before);s.selectThread(root);
 assert.equal(call('_Mtx_lock'),profile.sameThreadLock);assert.equal(call('_Mtx_trylock'),profile.sameThreadTry);assert.equal(hex(),profile.states[3].hex);
 assert.throws(()=>call('_Mtx_destroy_in_situ'),/owned/);
 for(let n=profile.states[3].count;n>0;n--)assert.equal(call('_Mtx_unlock'),0);
 assert.equal(hex(),profile.states[4].hex);assert.ok(!s.held.has(p+16));assert.equal(call('_Mtx_current_owns'),0);
 call('_Mtx_destroy_in_situ');assert.equal(hex(),profile.states[5].hex);
 for(const q of [p-16,p+80])assert.deepEqual([...new Uint8Array(memory.buffer,q,16)],Array(16).fill(0xa5));
}
assert.throws(()=>call('_Mtx_init_in_situ',0,2),/bounds/);assert.throws(()=>call('_Mtx_init_in_situ',p+1,2),/Unaligned/);assert.throws(()=>call('_Mtx_init_in_situ',p,1),/type/);
// Adopt the exact pristine layout emitted by an inline constructor.
const q=22000;new Uint8Array(memory.buffer,q,80).set(Buffer.from(native.profiles[0].states[0].hex,'hex'));
assert.equal(call('_Mtx_lock',q),0);assert.equal(s.srwOwners.get(q+16),1);assert.equal(s.mutexSnapshot().at(-1)[2],1);
v.setInt32(q+76,2,true);assert.throws(()=>call('_Mtx_current_owns',q),/state mismatch/);v.setInt32(q+76,1,true);call('_Mtx_unlock',q);call('_Mtx_destroy_in_situ',q);
assert.equal(s.resolve({dll:'MSVCP140.dll',name:'_Mtx_lock'}),BigInt(addresses._Mtx_lock));assert.equal(s.resolve({dll:'other.dll',name:'_Mtx_lock'}),undefined);
let freed=0;const h=new GuestMsvcMutex(memory,addresses,{allocator:{malloc(){return 30000;},free(){freed++;}}}),block=h.allocate(112n,true);
call('_Mtx_init_in_situ',Number(block)+16,2,h);call('_Mtx_lock',Number(block)+16,0,h);
assert.throws(()=>h.free(block),/owned/);assert.equal(freed,0);h.releaseHeap();assert.equal(freed,1);assert.equal(h.msvcMutexes.size,0);assert.equal(h.held.size,0);s.releaseHeap();
console.log('PASS: Windows-checked MSVC mutex bytes, recursion, per-thread ownership, busy results, kernel SRW state, inline initialization, contention rejection and disposal');
