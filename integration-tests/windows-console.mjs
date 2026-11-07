import assert from 'node:assert/strict';
import {GuestConsole,CONSOLE_NAMES} from '../experiments/geode-binary/windows-console.mjs';
const memory=new WebAssembly.Memory({initial:1}),v=new DataView(memory.buffer),cpu=4096,sp=9000,tib=16384,out=20000,addresses=Object.fromEntries(CONSOLE_NAMES.map((n,i)=>[n,100+i*16])),s=new GuestConsole(memory,addresses,{tib});
function call(name,a=0,b=0){v.setBigUint64(cpu+8,BigInt(a),true);v.setBigUint64(cpu+16,BigInt(b),true);v.setBigUint64(cpu+32,BigInt(sp),true);v.setBigUint64(sp,321n,true);s.invoke(cpu,BigInt(addresses[name]));return v.getBigUint64(cpu,true);}
v.setUint32(tib+0x68,123,true);for(const h of [0xfffffff6,0xfffffff5,0xfffffff4])assert.equal(call('GetStdHandle',h),0n);assert.equal(v.getUint32(tib+0x68,true),123);
assert.equal(call('GetStdHandle',0x1234),0xffffffffffffffffn);assert.equal(v.getUint32(tib+0x68,true),6);
v.setUint32(out,0xa5a5a5a5,true);assert.equal(call('GetConsoleMode',0,out),0n);assert.equal(v.getUint32(out,true),0xa5a5a5a5);assert.equal(call('SetConsoleMode',0,4),0n);assert.equal(v.getUint32(tib+0x68,true),6);
console.log('PASS: native-checked detached standard handles, preserved output, console failures and guest continuation');
