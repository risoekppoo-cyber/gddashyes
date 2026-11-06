import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {instantiateStartupLift} from './startup-module.mjs';
import {getSystemTimeAsFileTime} from './windows-time.mjs';
import {GuestThreads,getCurrentThreadId} from './windows-threads.mjs';
import {StartupServices} from './windows-startup.mjs';
import {NativeInitializers} from './native-initializers.mjs';
import {OnExitTables} from './onexit-tables.mjs';
import {SrwLocks} from './srw-locks.mjs';
import {ConditionVariables} from './condition-variables.mjs';
import {GuestModules} from './guest-modules.mjs';
import {GuestHeap} from './guest-heap.mjs';
import {NativeLoads} from './native-loads.mjs';
import {crtString} from './crt-strings.mjs';
import {ceilf} from './crt-math.mjs';
const dir=process.argv[2],reportPath=process.argv[3];
const [expected,image,stack,wasm,report]=await Promise.all([
 readFile(dir+'/expected.json').then(JSON.parse),readFile(dir+'/image.bin'),
 readFile(dir+'/stack.bin'),readFile(dir+'/startup.wasm'),readFile(reportPath).then(JSON.parse)]);
assert.ok(expected.generationId&&expected.generationId===report.generationId,'Stale startup output from another run');
assert.equal(report.firstTranslationBlocker,null,'Native path contains unsupported IR');
assert.deepEqual(report.unmodeledTibReads,[],'Native path used an unmodeled TEB field');
assert.equal(report.originalX64InstructionsExecuted,expected.instructions,'Native report and reference disagree');
assert.deepEqual(report.hostCalls,expected.hostCalls,'Host call transcript is stale');
const memory=new WebAssembly.Memory({initial:Math.max(1024,...expected.modules.map(m=>Math.ceil((m.base+m.size)/65536))),maximum:65536});
const instance=await instantiateStartupLift(wasm,memory),v=new DataView(memory.buffer),cpu=4096;
new Uint8Array(memory.buffer,expected.base,image.length).set(image);
for(const m of expected.modules.filter(m=>m.name!=='Geode.dll'))new Uint8Array(memory.buffer,m.base,m.size).set(await readFile(dir+'/module-'+m.base.toString(16)+'.bin'));
if(expected.tibBase){
 new Uint8Array(memory.buffer,expected.tibBase,expected.tibSize).set(await readFile(dir+'/tib.bin'));
 v.setBigUint64(cpu+128,BigInt(expected.tibBase),true);
}
if(expected.tlsBase)new Uint8Array(memory.buffer,expected.tlsBase,expected.tlsSize).set(await readFile(dir+'/tls.bin'));
for(const m of expected.modules.filter(m=>m.primaryTls))new Uint8Array(memory.buffer,m.primaryTls.base,m.primaryTls.size).set(await readFile(dir+'/primary-tls.bin'));
v.setUint32(cpu+expected.mxcsr.offset,0x1f80,true);
v.setBigUint64(cpu+8,BigInt(expected.base),true);v.setBigUint64(cpu+16,1n,true);
v.setBigUint64(cpu+32,0x2fff08n,true);v.setBigUint64(0x2fff08,0x1234fedcn,true);
const threads=new GuestThreads();threads.register('main');
let currentCall;const services=new StartupServices({counter:()=>BigInt(currentCall.counter),tibBase:expected.tibBase,version:report.windowsCompatibilityProfile});
const modules=new GuestModules(expected.modules,{setLastError:value=>{services.lastError=value;v.setUint32(expected.tibBase+0x68,value,true);}});
const heap=new GuestHeap(memory,report.crtHeap);
const loads=new NativeLoads(expected.tibBase);
const initializers=new NativeInitializers();
const onexit=new OnExitTables();
const locks=new SrwLocks();
const conditions=new ConditionVariables();
let steps=0,handled=0,pc=BigInt(expected.entry);
for(let transfers=0;transfers<4096;transfers++){
 const result=instance.exports.lift_run(cpu,pc,BigInt(expected.base),0,0xffffffffffffffffn,expected.instructions-steps)>>>0;
 if(instance.exports.__stack_pointer)assert.equal(instance.exports.__stack_pointer.value,0x900000,'Compiler stack was not restored');
 steps+=result&0x7fffffff;
 assert.ok(result&0x80000000,'Startup dispatcher must yield or pause');
 pc=v.getBigUint64(cpu+192,true);
 if(steps===expected.instructions&&handled===expected.hostCalls.length&&pc===BigInt(expected.stop))break;
 if(loads.handles(pc)){loads.resume(memory,cpu);pc=v.getBigUint64(cpu+192,true);continue;}
 if(initializers.handles(pc)){initializers.resume(memory,cpu);pc=v.getBigUint64(cpu+192,true);continue;}
 const call=expected.hostCalls[handled];
 currentCall=call;
 assert.ok(call&&pc===BigInt(call.address),'Unexpected native import');
 if(call.name==='api-ms-win-crt-math-l1-1-0.dll!ceilf')assert.equal(BigInt(ceilf(memory,cpu)),BigInt(call.outputBits));
 else if(/^(api-ms-win-crt-string-.*|VCRUNTIME140.dll)!(strlen|wcslen|memcpy|memmove|memset|memcmp)$/i.test(call.name))assert.equal(crtString(call.name,memory,cpu),BigInt(call.result));
 else if(call.action==='initializeDependency')loads.begin(expected.modules.find(m=>m.base===call.base),memory,cpu);
 else if((/^api-ms-win-crt-heap-.*!(malloc|free|calloc|realloc|_msize)$/.test(call.name))||call.name==='api-ms-win-crt-runtime-l1-1-0.dll!_errno'){
  const value=heap.invoke(call.name,cpu);assert.equal(value===undefined?null:'0x'+value.toString(16),call.result);
 }else if(/!(getmodulehandle[aw]|getprocaddress|disablethreadlibrarycalls)$/i.test(call.name)){
  const result=modules.invoke(call.name,memory,cpu);assert.equal(BigInt(result),BigInt(call.result));
 }else if(/!(getcurrentthread|setthreaddescription|getthreaddescription|localfree)$/i.test(call.name))threads.invoke(call.name,memory,cpu,'main');
 else if(call.name.toLowerCase()==='kernel32.dll!getsystemtimeasfiletime')
  getSystemTimeAsFileTime(memory,cpu,()=>call.unixMilliseconds);
 else if(call.name.toLowerCase()==='kernel32.dll!getcurrentthreadid'){
  assert.equal(threads.id('main'),call.threadId);
  getCurrentThreadId(memory,cpu,threads,'main');
 }else if(call.name.endsWith('!_register_onexit_function'))onexit.register(memory,cpu);
 else if(/!((try)?acquire|release|initialize)srwlock/i.test(call.name))locks.invoke(call.name,memory,cpu);
 else if(/!(wakeall|wake|initialize)conditionvariable/i.test(call.name))conditions.invoke(call.name,memory,cpu);
 else if(call.name.endsWith('!_initterm_e')||call.name.endsWith('!_initterm'))initializers.begin(call.name,memory,cpu);
 else services.invoke(call.name,memory,cpu);
 handled++;
 pc=v.getBigUint64(cpu+192,true);
}
assert.equal(handled,expected.hostCalls.length);
assert.equal(steps,expected.instructions);
assert.equal(v.getUint32(cpu+expected.mxcsr.offset,true),expected.mxcsr.value,'MXCSR');report.mxcsrMatches=true;
for(let i=0;i<16;i++)assert.equal(v.getBigUint64(cpu+i*8,true),BigInt(expected.registers[i]),'GPR '+i);
for(let i=0;i<16;i++)assert.equal(v.getBigUint64(cpu+256+i*16,true)|(v.getBigUint64(cpu+264+i*16,true)<<64n),BigInt(expected.xmm[i]),'XMM '+i);
for(const [name,flag] of Object.entries(expected.flags))assert.equal(v.getUint8(cpu+flag.offset),flag.value,name);
assert.equal(v.getBigUint64(cpu+192,true),BigInt(expected.stop));
assert.deepEqual(Buffer.from(memory.buffer,0x200000,0x100000),stack);
assert.deepEqual(Buffer.from(memory.buffer,expected.base,image.length),await readFile(dir+'/image-after.bin'));
assert.deepEqual(Buffer.from(memory.buffer,0x500000,0x100000),await readFile(dir+'/arena-after.bin'));
assert.deepEqual(Buffer.from(memory.buffer,expected.tibBase,expected.tibSize),await readFile(dir+'/tib-after.bin'));
assert.deepEqual(Buffer.from(memory.buffer,expected.tlsBase,expected.tlsSize),await readFile(dir+'/tls-after.bin'));
for(const m of expected.modules.filter(m=>m.name!=='Geode.dll'))assert.deepEqual(Buffer.from(memory.buffer,m.base,m.size),await readFile(dir+'/module-'+m.base.toString(16)+'-after.bin'));
assert.deepEqual(Buffer.from(memory.buffer,heap.base,heap.size),await readFile(dir+'/crt-heap-after.bin'));
assert.deepEqual(Buffer.from(memory.buffer,heap.errno,0x10000),await readFile(dir+'/errno-after.bin'));
assert.deepEqual(Object.fromEntries(heap.allocations),report.crtHeap.allocations);assert.deepEqual(heap.available,report.crtHeap.freeBlocks);assert.equal(heap.calls,report.crtHeap.calls);
report.crtHeapMemoryMatches=true;
for(const m of expected.modules.filter(m=>m.primaryTls))assert.deepEqual(Buffer.from(memory.buffer,m.primaryTls.base,m.primaryTls.size),await readFile(dir+'/primary-tls-after.bin'));
assert.deepEqual(Buffer.from(memory.buffer,0xa00000,0x100000),await readFile(dir+'/local-heap-after.bin'));
assert.deepEqual(Object.fromEntries(threads.localAllocations),report.localAllocations);
assert.equal(threads.descriptions.get('main')??null,report.threadDescription);
for(const m of expected.modules.filter(m=>m.tls)){assert.deepEqual(Buffer.from(memory.buffer,m.tls.base,m.tls.size),await readFile(dir+'/dependency-tls-after.bin'));assert.equal(m.initialized,report.guestModules.find(x=>x.base===m.base).initialized);}
assert.equal(!!loads.frame,report.dependencyLoadInProgress);
report.dependencyTlsCallbacksCompleted=loads.completedTls;report.dependencyEntriesCompleted=loads.completedEntries;report.dependencyLoadsCompleted=loads.completedLoads;
report.moduleLookups=modules.lookups;report.exportResolutions=modules.resolutions;report.shimModuleImagesMatch=true;
Object.assign(report,{status:'DLL_STARTUP_PREFIX_VERIFIED',wasmStartupExecuted:true,
 wasmStartupInstructions:steps,allGeneralRegistersMatch:true,entireNativeStackMatches:true,
 dllInitializationCompleted:false,windowsImportsExecuted:handled>0,implementedWindowsCalls:handled,
 initializerCallbacksExecuted:initializers.callbackCount,completedInitializerTables:initializers.completedTables,
 entireDllImageMatches:true,allXmmRegistersMatch:true,arithmeticFlagsMatch:true,tlsMemoryMatches:true});
report.onexitRegistrations=onexit.registrations;
report.srwAcquisitions=locks.acquisitions;
report.emptyQueueConditionWakes=conditions.wakes;
report.initializerCallbacksStarted=initializers.callbackCount;
report.initializerCallbacksCompleted=initializers.completedCallbacks;
report.initializerTablesInProgress=initializers.frames.length;
report.executedImportCalls=handled;
report.implementedImports=[...new Set(report.hostCalls.map(call=>call.name))].sort();
await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
