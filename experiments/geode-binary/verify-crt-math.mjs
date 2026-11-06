import assert from 'node:assert/strict';
import {ceilf} from './crt-math.mjs';
const memory=new WebAssembly.Memory({initial:2}),v=new DataView(memory.buffer),cpu=4096;
for(const value of [0,-0,0.1,-0.1,1.5,-1.5,16777216,-16777216,1e30,-1e30,2**-140,-(2**-140)]){
 v.setFloat32(cpu+256,value,true);const input=v.getFloat32(cpu+256,true);v.setUint32(cpu+260,0xfeedcafe,true);v.setBigUint64(cpu,0x1234n,true);v.setBigUint64(cpu+32,8192n,true);v.setBigUint64(8192,0x1234fedcn,true);
 ceilf(memory,cpu);assert.ok(Object.is(v.getFloat32(cpu+256,true),Math.fround(Math.ceil(input))));assert.equal(v.getUint32(cpu+260,true),0xfeedcafe);assert.equal(v.getBigUint64(cpu,true),0x1234n);assert.equal(v.getBigUint64(cpu+192,true),0x1234fedcn);
}
for(const bits of [0x7fc00000,0x7f800000,0xff800000]){v.setUint32(cpu+256,bits,true);assert.throws(()=>ceilf(memory,cpu),/UNMODELED_CRT_NONFINITE/);}
console.log('PASS: ceilf XMM0 ABI, fractional signs, signed zero, tiny/large inputs, native return and explicit nonfinite rejection');
