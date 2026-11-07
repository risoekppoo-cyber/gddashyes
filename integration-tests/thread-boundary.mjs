import assert from 'node:assert/strict';
import {GuestThreadBoundary} from '../experiments/geode-binary/thread-boundary.mjs';
const memory=new WebAssembly.Memory({initial:1}),v=new DataView(memory.buffer),cpu=4096,sp=9000,s=new GuestThreadBoundary(memory,{_beginthreadex:123});
for(const [o,value] of [[8,0],[16,65536],[64,0x21000],[72,10000],[32,sp]])v.setBigUint64(cpu+o,BigInt(value),true);
v.setBigUint64(sp+40,0n,true);v.setBigUint64(sp+48,13000n,true);
const r=s.readThreadRequest(cpu,0x20000);assert.equal(r.entryRva,0x1000);assert.equal(r.stackSize,65536);assert.equal(r.argument,'0x2710');assert.equal(r.threadIdOutput,'0x32c8');assert.equal(r.threadCreationImplemented,false);
assert.equal(s.resolve({dll:'api-ms-win-crt-runtime-l1-1-0.dll',name:'_beginthreadex'}),123n);assert.throws(()=>s.invoke(cpu,123n),/real scheduler/);assert.equal(s.calls.length,0);
console.log('PASS: complete worker request capture and explicit refusal to fabricate a thread');
