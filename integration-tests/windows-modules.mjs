import assert from 'node:assert/strict';
import {GuestModules} from '../experiments/geode-binary/windows-modules.mjs';
const memory=new WebAssembly.Memory({initial:1}),v=new DataView(memory.buffer),cpu=4096,dest=8192,tib=16384;
const names=['AcquireSRWLockExclusive','ReleaseSRWLockExclusive','GetModuleFileNameW','GetLastError','SetLastError'];
const addresses=Object.fromEntries(names.map((n,i)=>[n,100+i*16])),s=new GuestModules(memory,addresses,{imageBase:0x2000000,tib});
function call(name,module=0n,capacity=260){v.setBigUint64(cpu+8,module,true);v.setBigUint64(cpu+16,BigInt(dest),true);v.setBigUint64(cpu+64,BigInt(capacity),true);v.setBigUint64(cpu+32,12000n,true);v.setBigUint64(12000,12345n,true);s.invoke(cpu,BigInt(addresses[name]));assert.equal(v.getBigUint64(cpu+192,true),12345n);return Number(v.getBigUint64(cpu,true));}
const string=()=>{let s='';for(let p=dest;v.getUint16(p,true);p+=2)s+=String.fromCharCode(v.getUint16(p,true));return s;};
assert.equal(call('GetModuleFileNameW'),32);assert.equal(string(),'C:\\GeometryDash\\GeometryDash.exe');assert.equal(call('GetLastError'),0);
assert.equal(call('GetModuleFileNameW',0x2000000n),25);assert.equal(string(),'C:\\GeometryDash\\Geode.dll');
assert.equal(call('GetModuleFileNameW',0n,4),4);assert.equal(string(),'C:\\');assert.equal(call('GetLastError'),122);
assert.equal(call('GetModuleFileNameW',0n,1),1);assert.equal(string(),'');
assert.equal(call('GetModuleFileNameW',0n,0),0);assert.equal(call('GetLastError'),122);
assert.equal(call('GetModuleFileNameW',0xdeadbeefn),0);assert.equal(call('GetLastError'),126);
call('SetLastError',999n);assert.equal(call('GetLastError'),999);
assert.throws(()=>call('GetModuleFileNameW',0n,0xffffffff),/bounds/);
console.log('PASS: virtual Windows module catalogue, UTF-16 buffers, truncation, invalid handles and per-thread errors');
