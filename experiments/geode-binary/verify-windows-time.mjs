import assert from 'node:assert/strict';
import {filetimeFromUnixMilliseconds,getSystemTimeAsFileTime,filetimeFromUnixNanoseconds,getSystemTimePreciseAsFileTime} from './windows-time.mjs';
assert.equal(filetimeFromUnixMilliseconds(-11644473600000),0n);
assert.equal(filetimeFromUnixMilliseconds(0),116444736000000000n);
assert.equal(filetimeFromUnixMilliseconds(1),116444736000010000n);
assert.throws(()=>filetimeFromUnixMilliseconds(NaN),/clock/);
const memory=new WebAssembly.Memory({initial:2}),v=new DataView(memory.buffer),cpu=4096;
new Uint8Array(memory.buffer,8191,10).fill(0xaa);
v.setBigUint64(cpu+8,8192n,true);v.setBigUint64(cpu+32,16384n,true);
v.setBigUint64(cpu,123n,true);v.setBigUint64(16384,0x12345678n,true);
getSystemTimeAsFileTime(memory,cpu,()=>0);
assert.equal(v.getBigUint64(8192,true),116444736000000000n);
assert.equal(v.getUint8(8191),0xaa);assert.equal(v.getUint8(8200),0xaa);
assert.equal(v.getBigUint64(cpu,true),123n);
assert.equal(v.getBigUint64(cpu+32,true),16392n);assert.equal(v.getBigUint64(cpu+192,true),0x12345678n);
v.setBigUint64(cpu+8,131071n,true);
assert.throws(()=>getSystemTimeAsFileTime(memory,cpu,()=>0),/outside memory/);
console.log('PASS: FILETIME epoch, units, bounds and native return');

assert.equal(filetimeFromUnixNanoseconds(-11644473600000000000n),0n);
assert.equal(filetimeFromUnixNanoseconds(-1n),116444735999999999n);
assert.equal(filetimeFromUnixNanoseconds(199n),116444736000000001n);
assert.throws(()=>filetimeFromUnixNanoseconds(123),/integer nanoseconds/);
v.setBigUint64(cpu+8,8192n,true);v.setBigUint64(cpu+32,16384n,true);v.setBigUint64(cpu,789n,true);
getSystemTimePreciseAsFileTime(memory,cpu,()=>123456789n);
assert.equal(v.getBigUint64(8192,true),116444736001234567n);assert.equal(v.getBigUint64(cpu,true),789n);
assert.equal(v.getBigUint64(cpu+192,true),0x12345678n);
console.log('PASS: nanosecond wall clock, exact 100ns FILETIME truncation and void native return');
const {systemTimeToFileTime}=await import('./windows-time.mjs');
const view=new DataView(memory.buffer);
let conversionError=42;
function convert(fields){fields.forEach((x,i)=>view.setUint16(12288+i*2,x,true));view.setBigUint64(cpu+8,12288n,true);view.setBigUint64(cpu+16,16384n,true);view.setBigUint64(cpu+32,8192n,true);view.setBigUint64(8192,0x1234fedcn,true);view.setBigUint64(16384,0x55n,true);const result=systemTimeToFileTime(memory,cpu,x=>conversionError=x);assert.equal(view.getBigUint64(cpu+192,true),0x1234fedcn);assert.equal(view.getBigUint64(cpu+32,true),8200n);assert.equal(view.getBigUint64(cpu,true),result===null?0n:1n);return result;}
assert.equal(convert([1601,1,999,1,0,0,0,0]),0n);assert.equal(conversionError,42);assert.equal(convert([1970,1,0,1,0,0,0,0]),116444736000000000n);
assert.equal(convert([2000,2,0,29,0,0,0,0]),filetimeFromUnixMilliseconds(Date.UTC(2000,1,29)));
assert.equal(convert([2000,3,0,1,0,0,0,1])-convert([2000,2,0,29,0,0,0,1]),864000000000n);assert.ok(convert([30827,12,0,31,23,59,59,999])>0n);
for(const fields of [[1900,2,0,29,0,0,0,0],[2100,2,0,29,0,0,0,0],[1600,1,0,1,0,0,0,0],[30828,1,0,1,0,0,0,0],[2026,4,0,31,0,0,0,0],[2026,1,0,1,24,0,0,0],[2026,1,0,1,0,0,60,0]]){assert.equal(convert(fields),null);assert.equal(conversionError,87);assert.equal(view.getBigUint64(16384,true),0x55n);}
console.log('PASS: SYSTEMTIME Gregorian leap/century rules, ignored weekday, 1601 epoch, year bounds, milliseconds, invalid-date error and output preservation');
