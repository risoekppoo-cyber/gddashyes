import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {instantiateLift} from './verify.mjs';
import {getSystemTimeAsFileTime} from './windows-time.mjs';
import {GuestThreads,getCurrentThreadId} from './windows-threads.mjs';
const dir=process.argv[2],reportPath=process.argv[3];
const [expected,image,stack,wasm,report]=await Promise.all([
 readFile(dir+'/expected.json').then(JSON.parse),readFile(dir+'/image.bin'),
 readFile(dir+'/stack.bin'),readFile(dir+'/startup.wasm'),readFile(reportPath).then(JSON.parse)]);
const memory=new WebAssembly.Memory({initial:1024,maximum:65536});
const instance=await instantiateLift(wasm,memory),v=new DataView(memory.buffer),cpu=4096;
new Uint8Array(memory.buffer,expected.base,image.length).set(image);
v.setBigUint64(cpu+8,BigInt(expected.base),true);v.setBigUint64(cpu+16,1n,true);
v.setBigUint64(cpu+32,0x2fff08n,true);v.setBigUint64(0x2fff08,0x1234fedcn,true);
const threads=new GuestThreads();threads.register('main');
let steps=0,handled=0,pc=BigInt(expected.entry);
for(let transfers=0;transfers<64;transfers++){
 const result=instance.exports.lift_run(cpu,pc,BigInt(expected.base),0,BigInt(expected.stop),10000)>>>0;
 steps+=result&0x7fffffff;
 if(!(result&0x80000000))break;
 const call=expected.hostCalls[handled];pc=v.getBigUint64(cpu+192,true);
 assert.ok(call&&pc===BigInt(call.address),'Unexpected native import');
 if(call.name.toLowerCase()==='kernel32.dll!getsystemtimeasfiletime')
  getSystemTimeAsFileTime(memory,cpu,()=>call.unixMilliseconds);
 else if(call.name.toLowerCase()==='kernel32.dll!getcurrentthreadid'){
  assert.equal(threads.id('main'),call.threadId);
  getCurrentThreadId(memory,cpu,threads,'main');
 }else throw Error('Unimplemented import '+call.name);
 handled++;
 pc=v.getBigUint64(cpu+192,true);
}
assert.equal(handled,expected.hostCalls.length);
assert.equal(steps,expected.instructions);
for(let i=0;i<16;i++)assert.equal(v.getBigUint64(cpu+i*8,true),BigInt(expected.registers[i]),'GPR '+i);
assert.equal(v.getBigUint64(cpu+192,true),BigInt(expected.stop));
assert.deepEqual(Buffer.from(memory.buffer,0x200000,0x100000),stack);
Object.assign(report,{status:'DLL_STARTUP_REACHED_WINDOWS_IMPORT',wasmStartupExecuted:true,
 wasmStartupInstructions:steps,allGeneralRegistersMatch:true,entireNativeStackMatches:true,
 dllInitializationCompleted:false,windowsImportsExecuted:handled>0,implementedWindowsCalls:handled});
await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
