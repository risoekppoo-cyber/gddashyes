import assert from 'node:assert/strict';
import {GuestFiles,FILE_NAMES,gameFilesystem} from '../experiments/geode-binary/windows-files.mjs';
const memory=new WebAssembly.Memory({initial:1}),v=new DataView(memory.buffer),cpu=4096,tib=16384,input=20000,out=22000,sp=9000;
const addresses=Object.fromEntries(FILE_NAMES.map((n,i)=>[n,100+i*16]));
const s=new GuestFiles(memory,addresses,{tib,filesystem:{stat(path){return path==='C:\\GeometryDash'?{directory:true}:null;}}});
for(const [i,c] of [...'C:\\GeometryDash'].entries())v.setUint16(input+i*2,c.charCodeAt(0),true);
function call(name,a,b=0n,c=0n,d=0n){for(const [o,n] of [[8,a],[16,b],[64,c],[72,d]])v.setBigUint64(cpu+o,BigInt(n),true);v.setBigUint64(cpu+32,BigInt(sp),true);v.setBigUint64(sp,12345n,true);v.setUint32(sp+40,3,true);v.setUint32(sp+48,0x2000000,true);s.invoke(cpu,BigInt(addresses[name]));return v.getBigUint64(cpu,true);}
const handle=call('CreateFileW',input,0,7);assert.equal(s.handles.size,1);
const n=call('GetFinalPathNameByHandleW',handle,0,0);assert.equal(n,20n);assert.equal(call('GetFinalPathNameByHandleW',handle,out,64),19n);
let text='';for(let p=out;v.getUint16(p,true);p+=2)text+=String.fromCharCode(v.getUint16(p,true));assert.equal(text,'\\\\?\\C:\\GeometryDash');
assert.equal(call('CloseHandle',handle),1n);assert.equal(call('CloseHandle',handle),0n);assert.equal(v.getUint32(tib+0x68,true),6);
assert.throws(()=>call('CreateFileW',input,0x80000000,7),/metadata-only/);
assert.equal(call('SetCurrentDirectoryW',input),1n);assert.equal(call('GetCurrentDirectoryW',0,0),16n);assert.equal(call('GetCurrentDirectoryW',64,out),15n);
const fs=gameFilesystem({readdir(){return ['Resources'];},stat(p){return {mode:p==='/Resources'?1:1};},isDir(){return true;}});assert.equal(fs.stat('C:\\GeometryDash\\resources').directory,true);assert.equal(fs.stat('C:\\GeometryDash\\missing'),null);
console.log('PASS: real-filesystem adapter, owned directory handles, final paths, close and unsupported access rejection');
