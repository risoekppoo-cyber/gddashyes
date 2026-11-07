import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {BrowserPerformanceClock,GuestPerformanceClock,PERFORMANCE_CLOCK_NAMES} from '../experiments/geode-binary/windows-performance-clock.mjs';
const native=JSON.parse(await readFile(new URL('./performance-clock-native-result.json',import.meta.url)));
assert.equal(native.status,'PERFORMANCE_CLOCK_NATIVE_PASS');assert.equal(native.frequencyStable,true);assert.equal(native.outputBytes,8);
const memory=new WebAssembly.Memory({initial:1}),cpu=4096,sp=9000,out=10000,tib=12000;let sample=10;
const addresses=Object.fromEntries(PERFORMANCE_CLOCK_NAMES.map((n,i)=>[n,100+i*16])),clock=new BrowserPerformanceClock(()=>sample),s=new GuestPerformanceClock(memory,addresses,{tib,performanceClock:clock});
const view=()=>new DataView(memory.buffer);new Uint8Array(memory.buffer,out-8,24).fill(0xa5);view().setUint32(tib+0x68,123,true);
function call(name,p=out){let v=view();v.setBigUint64(cpu+8,BigInt(p),true);v.setBigUint64(cpu+32,BigInt(sp),true);v.setBigUint64(sp,1234n,true);s.invoke(cpu,BigInt(addresses[name]));v=view();assert.equal(v.getBigUint64(cpu,true),1n);assert.equal(v.getBigUint64(cpu+192,true),1234n);assert.equal(v.getBigUint64(cpu+32,true),BigInt(sp+8));return v.getBigInt64(p,true);}
assert.equal(call('QueryPerformanceFrequency'),10000000n);assert.equal(call('QueryPerformanceFrequency'),10000000n);assert.equal(s.clockReads,0);
const a=call('QueryPerformanceCounter');assert.equal(a,100000n);assert.equal(call('QueryPerformanceCounter'),a,'tied samples permitted');sample=35;const b=call('QueryPerformanceCounter');assert.equal(Number(b-a)/Number(clock.frequency),0.025);
s.selectThread({id:2,tib:14000,errno:0});sample=36;assert.equal(call('QueryPerformanceCounter'),360000n,'same domain after thread selection');assert.equal(s.clockSnapshot().counterReads,4);
const before=Buffer.from(memory.buffer,out,8).slice();sample=34;assert.throws(()=>call('QueryPerformanceCounter'),/non-monotonic/);assert.deepEqual(Buffer.from(memory.buffer,out,8),before);assert.equal(s.clockReads,4);
sample=NaN;assert.throws(()=>call('QueryPerformanceCounter'),/sample/);sample=-1;assert.throws(()=>call('QueryPerformanceCounter'),/sample/);sample=Number.MAX_SAFE_INTEGER;assert.throws(()=>call('QueryPerformanceCounter'),/counter/);
assert.throws(()=>call('QueryPerformanceFrequency',0),/bounds/);assert.throws(()=>call('QueryPerformanceCounter',65530),/bounds/);assert.equal(view().getUint32(tib+0x68,true),123);
for(const p of [out-8,out+8])assert.deepEqual([...new Uint8Array(memory.buffer,p,8)],Array(8).fill(0xa5));
assert.throws(()=>new GuestPerformanceClock(memory,{}, {performanceClock:{frequency:0n,counter:()=>0n}}),/Invalid/);
assert.equal(s.resolve({dll:'KERNEL32.dll',name:'QueryPerformanceCounter'}),116n);assert.equal(s.resolve({dll:'other.dll',name:'QueryPerformanceCounter'}),undefined);
// Exercise the actual monotonic host clock; do not require a minimum resolution.
const real=new GuestPerformanceClock(memory,addresses);let previous=0n;for(let i=0;i<64;i++){const value=real.performanceClock.counter();assert.ok(value>=previous);previous=value;}
s.releaseHeap();real.releaseHeap();
console.log('PASS: fixed frequency, real monotonic clock conversion, consistent elapsed units, cross-thread domain, guarded outputs and explicit bad-sample rejection');
