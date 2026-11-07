import assert from 'node:assert/strict';
import {GuestPipes,PIPE_NAMES,PIPE_CRT_NAMES} from '../experiments/geode-binary/windows-pipes.mjs';
import {STDIO_NAMES} from '../experiments/geode-binary/windows-stdio.mjs';
const memory=new WebAssembly.Memory({initial:4}),cpu=4096,sp=9000,tib=16000,input=20000,path=22000,mode=24000,out=26000,buffer=28000,count=30000,ov=31000;
const names=[...new Set([...PIPE_NAMES,...PIPE_CRT_NAMES,...STDIO_NAMES,'CloseHandle'])],addresses=Object.fromEntries(names.map((n,i)=>[n,100+i*16]));let heap=65536;const live=new Set(),allocator={malloc(n){const p=heap;heap+=n;live.add(p);return p;},free(p){assert(live.delete(p));}},s=new GuestPipes(memory,addresses,{tib,allocator});
const view=()=>new DataView(memory.buffer);function ascii(p,text){new Uint8Array(memory.buffer,p,text.length+1).set(new TextEncoder().encode(text+'\0'));}function wide(p,text){for(let i=0;i<=text.length;i++)view().setUint16(p+i*2,i===text.length?0:text.charCodeAt(i),true);}
function call(name,a=0,b=0,c=0,d=0,stack=[]){const v=view();for(const [o,n] of [[8,a],[16,b],[64,c],[72,d]])v.setBigUint64(cpu+o,BigInt(n),true);v.setBigUint64(cpu+32,BigInt(sp),true);v.setBigUint64(sp,321n,true);for(let i=0;i<5;i++)v.setBigUint64(sp+40+i*8,BigInt(stack[i]||0),true);s.invoke(cpu,BigInt(addresses[name]));return view().getBigUint64(cpu,true);}
const pipeName='\\\\.\\pipe\\geode-stdout-1';wide(path,pipeName);ascii(input,pipeName);ascii(mode,'w');
const server=call('CreateNamedPipeW',path,0x40000001,8,1,[0,1024,0,0]);assert(s.pipeEnds.has(server));assert.equal(call('CreateNamedPipeW',path,0x40000001,8,1,[0,1024,0,0]),0xffffffffffffffffn);assert.equal(view().getUint32(tib+0x68,true),231);
const stdout=call('__acrt_iob_func',1),saved=call('_dup',1),savedHandle=call('_get_osfhandle',saved);
assert.equal(call('freopen_s',out,input,mode,stdout),0n);assert.equal(view().getBigUint64(out,true),stdout);assert.equal(call('_fileno',stdout),1n);assert.equal(call('_get_osfhandle',saved),savedHandle);
const client=call('_get_osfhandle',1);assert.notEqual(client,savedHandle);
new Uint8Array(memory.buffer,buffer,32).fill(0xa5);assert.equal(call('ReadFile',server,buffer,32,count,[ov]),0n);assert.equal(view().getUint32(tib+0x68,true),997);assert.equal(view().getUint32(count,true),0);assert.equal(view().getBigUint64(ov,true),0x103n);
assert.equal(call('GetOverlappedResult',server,ov,count,0),0n);assert.equal(view().getUint32(tib+0x68,true),996);
assert.throws(()=>call('GetOverlappedResult',client,ov,count,0),/Mismatched/);assert.throws(()=>call('ReadFile',server,buffer,32,count,[ov]),/reuse/);
ascii(input,'pipe\n');assert.equal(call('_write',1,input,5),5n);assert.equal(call('GetOverlappedResult',server,ov,count,1),1n);assert.equal(view().getUint32(count,true),6);assert.equal(Buffer.from(memory.buffer,buffer,6).toString(),'pipe\r\n');assert.equal(view().getBigUint64(ov,true),0n);
// Duplication keeps the writer alive until the last descriptor closes.
const other=call('_dup',1);assert.equal(call('_close',1),0n);assert.equal(call('ReadFile',server,buffer,32,count,[ov]),0n);assert.equal(view().getUint32(tib+0x68,true),997);assert.equal(call('_close',other),0n);assert.equal(view().getBigUint64(ov,true),0xc000014bn);assert.equal(call('GetOverlappedResult',server,ov,count,1),0n);assert.equal(view().getUint32(tib+0x68,true),109);
assert.equal(call('ReadFile',server,buffer,32,count,[ov]),0n);assert.equal(view().getUint32(tib+0x68,true),109);assert.equal(view().getBigUint64(ov,true),0x103n);
// The preserved original stdout remains a real output channel.
ascii(input,'ok');assert.equal(call('WriteFile',savedHandle,input,2,count),1n);assert.equal(s.outputRecords.at(-1).hex,'6f6b');assert.equal(call('CloseHandle',server),1n);
s.releaseHeap();assert.equal(live.size,0);assert.equal(s.pipeEnds.size,0);
console.log('PASS: real pipe queues, CRT reopen/dup ownership, text conversion, pending completion, EOF, preserved stdout and cleanup');
