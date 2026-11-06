import assert from 'node:assert/strict';
import {StartupServices} from './windows-startup.mjs';
const memory=new WebAssembly.Memory({initial:2}),v=new DataView(memory.buffer),cpu=4096;
let counter=10n;const services=new StartupServices({processId:123,counter:()=>counter});
function call(name,p=8192n){
 v.setBigUint64(cpu,0xdeadbeefn,true);v.setBigUint64(cpu+8,p,true);
 v.setBigUint64(cpu+32,16384n,true);v.setBigUint64(16384,0x12345678n,true);
 services.invoke(name,memory,cpu);
 assert.equal(v.getBigUint64(cpu+32,true),16392n);assert.equal(v.getBigUint64(cpu+192,true),0x12345678n);
 return v.getBigUint64(cpu,true);
}
assert.equal(call('KERNEL32.dll!GetCurrentProcessId'),123n);
assert.equal(call('KERNEL32.dll!GetCurrentProcessId'),123n);
assert.equal(call('KERNEL32.dll!QueryPerformanceCounter'),1n);assert.equal(v.getBigUint64(8192,true),10n);
counter=11n;call('KERNEL32.dll!QueryPerformanceCounter');assert.equal(v.getBigUint64(8192,true),11n);
counter=9n;assert.throws(()=>call('KERNEL32.dll!QueryPerformanceCounter'),/monotonic/);
assert.equal(call('KERNEL32.dll!QueryPerformanceFrequency'),1n);assert.equal(v.getBigUint64(8192,true),1000000000n);
new Uint8Array(memory.buffer,8191,26).fill(0xaa);
assert.equal(call('KERNEL32.dll!InitializeSListHead'),0xdeadbeefn);
assert.deepEqual([...new Uint8Array(memory.buffer,8192,16)],Array(16).fill(0));
assert.equal(v.getUint8(8191),0xaa);assert.equal(v.getUint8(8208),0xaa);
assert.throws(()=>call('KERNEL32.dll!InitializeSListHead',8193n),/aligned/);
const init='api-ms-win-crt-runtime-l1-1-0.dll!_initialize_onexit_table';
new Uint8Array(memory.buffer,8192,24).fill(0xaa);assert.equal(call(init),0n);
assert.deepEqual([...new Uint8Array(memory.buffer,8192,24)],Array(24).fill(0));
v.setBigUint64(8192,12n,true);v.setBigUint64(8200,13n,true);v.setBigUint64(8208,14n,true);
call(init);assert.equal(v.getBigUint64(8192,true),12n);assert.equal(v.getBigUint64(8200,true),13n);
assert.equal(call(init,0n),0xffffffffn);
assert.throws(()=>call('KERNEL32.dll!QueryPerformanceCounter',131071n),/outside memory/);
assert.throws(()=>call('unimplemented!api'),/Unimplemented/);
const env=new StartupServices({environment:{NAME:'hello 🟩'},tibBase:0x10000});
function wide(at,text){for(let i=0;i<text.length;i++)v.setUint16(at+i*2,text.charCodeAt(i),true);v.setUint16(at+text.length*2,0,true);}
function envCall(name){v.setBigUint64(cpu+32,16384n,true);v.setBigUint64(16384,0x12345678n,true);env.invoke(name,memory,cpu);return v.getBigUint64(cpu,true);}
wide(8192,'missing');v.setBigUint64(cpu+8,8192n,true);
assert.equal(envCall('KERNEL32.dll!GetEnvironmentVariableW'),0n);assert.equal(envCall('KERNEL32.dll!GetLastError'),203n);
assert.equal(v.getUint32(0x10068,true),203);
wide(8192,'name');v.setBigUint64(cpu+16,9000n,true);v.setBigUint64(cpu+64,0n,true);
assert.equal(envCall('KERNEL32.dll!GetEnvironmentVariableW'),9n);
v.setBigUint64(cpu+64,9n,true);assert.equal(envCall('KERNEL32.dll!GetEnvironmentVariableW'),8n);
assert.equal(v.getUint16(9016,true),0);assert.equal(v.getUint16(9012,true),0xd83d);assert.equal(v.getUint16(9014,true),0xdfe9);
v.setBigUint64(cpu+8,5n,true);envCall('KERNEL32.dll!SetLastError');assert.equal(envCall('KERNEL32.dll!GetLastError'),5n);
console.log('PASS: process identity, monotonic counter/frequency, SList and CRT table initialization');
