import assert from 'node:assert/strict';
import {GuestPaths,fullWindowsPath} from '../experiments/geode-binary/windows-paths.mjs';
for(const [input,expected] of [['C:\\GeometryDash\\.\\geode\\..\\GeometryDash.exe','C:\\GeometryDash\\GeometryDash.exe'],['C:\\GeometryDash\\geode\\','C:\\GeometryDash\\geode\\'],['C:\\a. \\b  ','C:\\a. \\b'],['C:/GeometryDash/../file.txt','C:\\file.txt'],['C:\\','C:\\'],['..\\file','C:\\file'],['C:geode','C:\\GeometryDash\\geode']])assert.equal(fullWindowsPath(input),expected);
assert.equal(fullWindowsPath(''),null);assert.throws(()=>fullWindowsPath('D:relative'),/Unknown drive/);
const memory=new WebAssembly.Memory({initial:1}),v=new DataView(memory.buffer),cpu=4096,tib=16384,input=20000,output=22000,part=23000;
const s=new GuestPaths(memory,{GetFullPathNameW:100},{tib});
const text='C:\\GeometryDash\\GeometryDash.exe';for(let i=0;i<text.length;i++)v.setUint16(input+i*2,text.charCodeAt(i),true);
function call(capacity){v.setBigUint64(cpu+8,BigInt(input),true);v.setBigUint64(cpu+16,BigInt(capacity),true);v.setBigUint64(cpu+64,capacity?BigInt(output):0n,true);v.setBigUint64(cpu+72,BigInt(part),true);v.setBigUint64(cpu+32,9000n,true);v.setBigUint64(9000,12345n,true);v.setUint32(tib+0x68,777,true);s.invoke(cpu,100n);return Number(v.getBigUint64(cpu,true));}
assert.equal(call(0),33);assert.equal(call(4),33);assert.equal(call(64),32);assert.equal(v.getBigUint64(part,true),BigInt(output+16*2));assert.equal(v.getUint32(tib+0x68,true),777);
console.log('PASS: virtual DOS full paths, native-checked dot segments, size queries and filename pointers');
