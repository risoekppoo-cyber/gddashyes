import assert from 'node:assert/strict';
import {GuestCritical,CRITICAL_NAMES} from '../experiments/geode-binary/windows-critical.mjs';
const memory=new WebAssembly.Memory({initial:1}),v=new DataView(memory.buffer),cpu=4096,sp=9000,lock=20000,addresses=Object.fromEntries(CRITICAL_NAMES.map((n,i)=>[n,100+i*16])),s=new GuestCritical(memory,addresses);
function call(name){v.setBigUint64(cpu+8,BigInt(lock),true);v.setBigUint64(cpu+32,BigInt(sp),true);v.setBigUint64(sp,321n,true);s.invoke(cpu,BigInt(addresses[name]));return v.getBigUint64(cpu,true);}
assert.throws(()=>call('EnterCriticalSection'),/Uninitialized/);call('InitializeCriticalSection');assert.equal(v.getInt32(lock+8,true),-1);assert.equal(v.getBigUint64(lock+32,true),0x20007d0n);
call('EnterCriticalSection');assert.equal(v.getInt32(lock+8,true),-2);assert.equal(v.getUint32(lock+12,true),1);assert.equal(v.getBigUint64(lock+16,true),1n);
assert.equal(call('TryEnterCriticalSection'),1n);assert.equal(v.getUint32(lock+12,true),2);assert.throws(()=>call('DeleteCriticalSection'),/owned/);
call('LeaveCriticalSection');call('LeaveCriticalSection');assert.equal(v.getInt32(lock+8,true),-1);assert.equal(v.getBigUint64(lock+16,true),0n);assert.throws(()=>call('LeaveCriticalSection'),/Unowned/);
call('DeleteCriticalSection');assert.equal(s.critical.size,0);assert.equal(v.getBigUint64(cpu+192,true),321n);
call('InitializeConditionVariable');assert.equal(v.getBigUint64(lock,true),0n);call('WakeConditionVariable');assert.equal(s.wakes.get(lock),1);v.setBigUint64(lock,1n,true);assert.throws(()=>call('WakeConditionVariable'),/scheduler/);
console.log('PASS: native-checked critical-section initialization, recursion, ownership, try/leave and deletion');
