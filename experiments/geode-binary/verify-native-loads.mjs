import assert from 'node:assert/strict';
import {NativeLoads} from './native-loads.mjs';
import {crtString} from './crt-strings.mjs';
const memory=new WebAssembly.Memory({initial:256}),v=new DataView(memory.buffer),cpu=4096,tib=0x400000;
const module={base:0x10000,entry:0x11000,initialized:false,tls:{index:1,indexAddress:0x18000,base:0xd00000,size:65536,templateHex:'aabbccdd',callbacks:[0x12000,0x13000]}};
const loads=new NativeLoads(tib),prepare=()=>{v.setBigUint64(cpu+32,0x1f008n,true);v.setBigUint64(0x1f008,0x1234fedcn,true);};prepare();
loads.begin(module,memory,cpu);assert.equal(module.initialized,false);assert.equal(loads.frame.next,1);assert.equal(v.getBigUint64(cpu+192,true),0x12000n);assert.equal(v.getUint32(0x18000,true),1);assert.equal(v.getBigUint64(tib+0x2008,true),0xd00000n);assert.equal(v.getUint32(0xd00000,true),0xddccbbaa);
assert.throws(()=>loads.begin(module,memory,cpu),/NESTED_DEPENDENCY/);
for(const target of [0x13000n,0x11000n,0x1234fedcn]){
 const sp=v.getBigUint64(cpu+32,true);assert.equal(v.getBigUint64(Number(sp),true),0x73000000n);
 v.setBigUint64(cpu+192,0x73000000n,true);v.setBigUint64(cpu+32,sp+8n,true);v.setBigUint64(cpu,1n,true);loads.resume(memory,cpu);assert.equal(v.getBigUint64(cpu+192,true),target);
}
assert.equal(module.initialized,true);assert.equal(loads.completedTls,2);assert.equal(loads.completedEntries,1);assert.equal(loads.completedLoads,1);assert.equal(v.getBigUint64(cpu,true),0x10000n);assert.equal(v.getBigUint64(cpu+32,true),0x1f010n);
prepare();module.initialized=false;module.tls.callbacks=[];loads.begin(module,memory,cpu);const sp=v.getBigUint64(cpu+32,true);v.setBigUint64(cpu+192,0x73000000n,true);v.setBigUint64(cpu+32,sp+8n,true);v.setBigUint64(cpu,0n,true);assert.throws(()=>loads.resume(memory,cpu),/MODULE_ATTACH_FAILED_DETACH_REQUIRED/);assert.equal(module.initialized,false);
const bytes=new Uint8Array(memory.buffer);bytes.set([65,66,0,68],32768);
function call(symbol,a,b=0n,n=0n){prepare();v.setBigUint64(cpu+8,a,true);v.setBigUint64(cpu+16,b,true);v.setBigUint64(cpu+64,n,true);return crtString('api-ms-win-crt-string-l1-1-0.dll!'+symbol,memory,cpu);}
assert.equal(call('strlen',32768n),2n);assert.equal(call('memcpy',32800n,32768n,4n),32800n);assert.deepEqual([...bytes.slice(32800,32804)],[65,66,0,68]);
assert.throws(()=>call('memcpy',32769n,32768n,3n),/overlap/);call('memmove',32769n,32768n,3n);assert.deepEqual([...bytes.slice(32768,32772)],[65,65,66,0]);
assert.equal(call('memcmp',32768n,32800n,2n),0xffffffffn);call('memset',32800n,0x1234n,3n);assert.deepEqual([...bytes.slice(32800,32803)],[0x34,0x34,0x34]);
bytes.set([65,66,0,90],33000);bytes.set([65,66,0,80],33200);assert.equal(call('strcmp',33000n,33200n),0n);bytes[33201]=255;assert.equal(call('strcmp',33000n,33200n),BigInt.asUintN(32,66n-255n));assert.equal(call('strcmp',33200n,33000n),255n-66n);
bytes.set([65,66,0],33000);bytes.fill(0xcc,33100,33105);assert.equal(call('strcpy_s',33100n,3n,33000n),0n);assert.deepEqual([...bytes.slice(33100,33105)],[65,66,0,0xcc,0xcc]);assert.throws(()=>call('strcpy_s',33100n,2n,33000n),/INVALID_PARAMETER_HANDLER_REQUIRED/);assert.throws(()=>call('strcpy_s',33000n,3n,33000n),/OVERLAP_UNSUPPORTED/);assert.throws(()=>call('strcpy_s',0n,3n,33000n),/INVALID_PARAMETER_HANDLER_REQUIRED/);
bytes.set([0x81,0,0x81,0xff],32900);assert.equal(call('memchr',32900n,0x181n,4n),32900n);assert.equal(call('memchr',32900n,0n,4n),32901n);assert.equal(call('memchr',32900n,0xffn,3n),0n);assert.equal(call('memchr',32900n,0xffn,4n),32903n);assert.equal(call('memchr',0n,0n,0n),0n);assert.throws(()=>call('memchr',BigInt(memory.buffer.byteLength)-1n,1n,2n),/bounds/);
assert.throws(()=>call('strlen',BigInt(memory.buffer.byteLength)),/bounds/);assert.throws(()=>call('memcpy',32800n,32768n,0x800001n),/bounds/);
console.log('PASS: TLS-before-attach, real native frame handoff, delayed load completion, failed attach rejection, bounded CRT string/memory operations');
