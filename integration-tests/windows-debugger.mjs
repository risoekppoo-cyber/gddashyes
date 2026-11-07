import assert from 'node:assert/strict';
import {GuestDebugger} from '../experiments/geode-binary/windows-debugger.mjs';
const memory=new WebAssembly.Memory({initial:1}),v=new DataView(memory.buffer),cpu=4096,sp=9000,args=12000,name=13000,s=new GuestDebugger(memory,{RaiseException:123});
new Uint8Array(memory.buffer,name,10).set(new TextEncoder().encode('GeodeMain\0'));
function call(code=0x406d1388,flags=0,count=3){v.setBigUint64(cpu+8,BigInt(code),true);v.setBigUint64(cpu+16,BigInt(flags),true);v.setBigUint64(cpu+64,BigInt(count),true);v.setBigUint64(cpu+72,BigInt(args),true);v.setBigUint64(cpu+32,BigInt(sp),true);v.setBigUint64(sp,321n,true);s.invoke(cpu,123n);}
v.setUint32(args,0x1000,true);v.setUint32(args+4,0xa5a5a5a5,true);v.setBigUint64(args+8,BigInt(name),true);v.setUint32(args+16,0xffffffff,true);
call();assert.equal(s.threadNames.get(1),'GeodeMain');assert.equal(v.getBigUint64(cpu+192,true),321n);assert.equal(v.getBigUint64(cpu+32,true),9008n);
assert.throws(()=>call(0xc0000005),/Unsupported guest exception/);assert.throws(()=>call(0x406d1388,1),/Unsupported guest exception/);assert.throws(()=>call(0x406d1388,0,2),/Unsupported guest exception/);
v.setUint32(args+16,2,true);assert.throws(()=>call(),/Unsupported guest thread-name/);v.setUint32(args+16,1,true);v.setUint32(args+20,1,true);assert.throws(()=>call(),/Unsupported guest thread-name/);
assert.equal(s.calls.length,1);console.log('PASS: real thread-name event delivery, ignored struct padding, guest continuation and rejection of other exceptions');
