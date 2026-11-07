import assert from 'node:assert/strict';
import {GuestEncoding,ENCODING_NAMES} from '../experiments/geode-binary/windows-encoding.mjs';
const memory=new WebAssembly.Memory({initial:1}),v=new DataView(memory.buffer),cpu=4096,tib=16384,input=20000,output=22000,sp=9000;
const addresses=Object.fromEntries(ENCODING_NAMES.map((n,i)=>[n,100+i*16])),s=new GuestEncoding(memory,addresses,{tib});
function call(name,count,capacity,flags=0){v.setBigUint64(cpu+8,65001n,true);v.setBigUint64(cpu+16,BigInt(flags),true);v.setBigUint64(cpu+64,BigInt(input),true);v.setBigUint64(cpu+72,BigInt.asUintN(64,BigInt(count)),true);v.setBigUint64(cpu+32,BigInt(sp),true);v.setBigUint64(sp,12345n,true);v.setBigUint64(sp+40,capacity?BigInt(output):0n,true);v.setBigUint64(sp+48,BigInt(capacity),true);v.setBigUint64(sp+56,0n,true);v.setBigUint64(sp+64,0n,true);v.setUint32(tib+0x68,777,true);s.invoke(cpu,BigInt(addresses[name]));return [Number(v.getBigUint64(cpu,true)),v.getUint32(tib+0x68,true)];}
for(const [i,n] of [65,0xd83d,0xde00,0].entries())v.setUint16(input+i*2,n,true);
assert.deepEqual(call('WideCharToMultiByte',3,0),[5,777]);assert.deepEqual(call('WideCharToMultiByte',-1,32),[6,777]);assert.equal(Buffer.from(memory.buffer,output,6).toString('hex'),'41f09f988000');
assert.deepEqual(call('WideCharToMultiByte',3,2),[0,122]);assert.deepEqual(call('WideCharToMultiByte',0,32),[0,87]);
v.setUint16(input,0xd800,true);assert.deepEqual(call('WideCharToMultiByte',1,32,0x80),[0,1113]);assert.deepEqual(call('WideCharToMultiByte',1,32),[3,777]);assert.equal(Buffer.from(memory.buffer,output,3).toString('hex'),'efbfbd');
new Uint8Array(memory.buffer,input,6).set([65,240,159,152,128,0]);assert.deepEqual(call('MultiByteToWideChar',-1,32),[4,777]);assert.equal(v.getUint16(output+2,true),0xd83d);assert.equal(v.getUint16(output+4,true),0xde00);assert.equal(v.getUint16(output+6,true),0);
v.setUint8(input,255);assert.deepEqual(call('MultiByteToWideChar',1,32,8),[0,1113]);assert.deepEqual(call('MultiByteToWideChar',1,32),[1,777]);assert.equal(v.getUint16(output,true),0xfffd);
assert.deepEqual(call('MultiByteToWideChar',1,32,1),[0,1004]);
console.log('PASS: native-checked UTF-8 conversion, query sizes, terminators, surrogate pairs, malformed input and errors');
