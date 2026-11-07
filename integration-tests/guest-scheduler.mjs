import assert from 'node:assert/strict';
import {GuestScheduler} from '../experiments/geode-binary/guest-scheduler.mjs';
import {GuestThreadBoundary} from '../experiments/geode-binary/thread-boundary.mjs';
const memory=new WebAssembly.Memory({initial:1}),live=new Set();let top=32768;
const allocator={malloc(n){const p=top;top+=n;if(top>memory.buffer.byteLength)memory.grow(Math.ceil((top-memory.buffer.byteLength)/65536));live.add(p);return p;},free(p){assert.ok(live.delete(p),'free owned block once');}};
const addresses=Object.fromEntries(['GetCurrentThreadId','GetLastError','SetLastError','InitializeCriticalSection','EnterCriticalSection','TryEnterCriticalSection','LeaveCriticalSection','AcquireSRWLockExclusive','ReleaseSRWLockExclusive'].map((n,i)=>[n,256+i*16]));
const s=new GuestThreadBoundary(memory,addresses,{allocator,tib:8192}),root=s.threadState,scheduler=new GuestScheduler(s,{quantum:3});
const template=new Uint8Array(memory.buffer,12000,3);template.set([1,2,3]);
const a=scheduler.createContext({entry:1024n,returnAddress:2048n,tlsTemplate:template,tlsZeroFill:5}),b=scheduler.createContext({entry:1024n,returnAddress:2048n,argument:77n});
assert.equal(live.size,6);assert.notEqual(a.cpu,b.cpu);assert.notEqual(a.tls,b.tls);
function view(){return new DataView(memory.buffer);}
for(const t of [a,b]){const v=view();assert.equal(v.getBigUint64(t.cpu+32,true)%16n,8n);assert.equal(v.getBigUint64(t.cpu+2328,true),BigInt(t.tib));assert.equal(v.getBigUint64(t.tib+0x48,true),BigInt(t.id));assert.equal(v.getBigUint64(t.tib+0x1000,true),BigInt(t.tls));}
assert.deepEqual([...new Uint8Array(memory.buffer,a.tls,8)],[1,2,3,0,0,0,0,0]);assert.equal(view().getBigUint64(b.cpu+8,true),77n);
function call(t,name,arg=0n){const v=view(),sp=BigInt(t.stack+128);v.setBigUint64(t.cpu+32,sp,true);v.setBigUint64(Number(sp),1234n,true);v.setBigUint64(t.cpu+8,arg,true);s.invoke(t.cpu,BigInt(addresses[name]));return view().getBigUint64(t.cpu,true);}
const lock=16000,srw=16104;
assert.equal(scheduler.runRound((t,budget)=>{
 assert.equal(budget,3);assert.equal(call(t,'GetCurrentThreadId'),BigInt(t.id));call(t,'SetLastError',BigInt(t.id*10));s.errno=t.id*20;
 view().setBigUint64(t.cpu+512,BigInt(t.id*30),true);view().setUint8(t.cpu+2560,t.id);view().setUint8(t.tls+7,t.id);
 if(t===a){call(t,'InitializeCriticalSection',BigInt(lock));call(t,'EnterCriticalSection',BigInt(lock));call(t,'AcquireSRWLockExclusive',BigInt(srw));}
 else{assert.equal(call(t,'TryEnterCriticalSection',BigInt(lock)),0n);assert.throws(()=>call(t,'LeaveCriticalSection',BigInt(lock)),/Unowned/);assert.throws(()=>call(t,'ReleaseSRWLockExclusive',BigInt(srw)),/Unowned/);}
 return {steps:3,state:'blocked',waitKey:t===a?'read':'other'};
}),6);
assert.equal(s.threadState,root);assert.equal(s.errno,0);assert.equal(scheduler.runRound(()=>assert.fail('blocked thread ran')),0);
assert.equal(scheduler.wake('read'),1);assert.equal(scheduler.wake('missing'),0);
scheduler.runRound(t=>{assert.equal(t,a);assert.equal(call(t,'GetLastError'),10n);assert.equal(s.errno,20);assert.equal(view().getBigUint64(t.cpu+512,true),30n);assert.equal(view().getUint8(t.cpu+2560),1);assert.equal(view().getUint8(t.tls+7),1);call(t,'LeaveCriticalSection',BigInt(lock));call(t,'ReleaseSRWLockExclusive',BigInt(srw));return {steps:1,state:'exited',exitCode:9};});
assert.equal(a.exitCode,9);scheduler.wake('other');
scheduler.runRound(t=>{assert.equal(t,b);assert.equal(call(t,'GetLastError'),20n);assert.equal(s.errno,40);assert.equal(view().getBigUint64(t.cpu+512,true),60n);assert.equal(view().getUint8(t.cpu+2560),2);assert.equal(view().getUint8(t.tls+7),2);call(t,'EnterCriticalSection',BigInt(lock));assert.equal(s.critical.get(lock).owner,b.id);call(t,'LeaveCriticalSection',BigInt(lock));assert.throws(()=>scheduler.runRound(()=>{}),/dispatch/);return {steps:2,state:'runnable'};});
assert.throws(()=>scheduler.runRound(()=>({steps:4,state:'runnable'})),/bounded/);assert.equal(b.status,'failed');assert.equal(s.threadState,root);
scheduler.dispose();scheduler.dispose();assert.equal(live.size,0);assert.equal(s.heap.size,0);assert.throws(()=>scheduler.runRound(()=>{}),/dispatch/);
// Every context block is attempted even if one allocator free fails.
const c=new GuestScheduler(s);c.createContext({entry:1024n,returnAddress:2048n});const original=s.free.bind(s);let attempts=0;s.free=p=>{attempts++;original(p);if(attempts===1)throw Error('free failure');};assert.throws(()=>c.dispose(),/free failure/);assert.equal(attempts,3);assert.equal(live.size,0);s.free=original;
const invalid=new GuestScheduler(s);assert.throws(()=>invalid.createContext({entry:0n,returnAddress:2048n}),/entry/);assert.equal(live.size,0);
s.releaseHeap();
console.log('PASS: bounded context switches, owned CPU/stack/TLS, per-thread errors/IDs, shared lock ownership, blocking/wakeup and failure cleanup (worker closure not executed)');
