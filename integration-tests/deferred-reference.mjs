import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {instantiateStartupLift} from '../experiments/geode-binary/handoff/startup-module.mjs';
import {mapPe64} from '../experiments/geode-binary/pe-image.mjs';
import {GuestThreadLifecycle} from '../experiments/geode-binary/guest-thread-lifecycle.mjs';
import {GuestScheduler} from '../experiments/geode-binary/guest-scheduler.mjs';
const dir=resolve(process.argv[2]),dll=await readFile('/tmp/Geode.dll');
const {ServiceClass,SERVICE_NAMES}=await import(pathToFileURL(dir+'/services.mjs'));
const manifest=JSON.parse(await readFile(dir+'/manifest.json'));
const wasm=await readFile(dir+'/deferred.wasm');
assert.equal(createHash('sha256').update(dll).digest('hex'),manifest.dllSha256);
const memory=new WebAssembly.Memory({initial:6144,maximum:65536}),cpu=4096;
const instance=await instantiateStartupLift(wasm,memory);
let slicedCases=0,slicedWorkerCases=0,workerSlices=0;
for(const mode of ['whole','sliced']){
for(const [index,c] of manifest.cases.entries()){
 let sliceIndex=0;const quantum=()=>[1,7,31,127][sliceIndex++%4];
 const cc=manifest.cocos;new Uint8Array(memory.buffer,cc.pageBase,4096).set(Buffer.from(cc.pageHex,'hex'));
 const gh=manifest.gameHeaders;new Uint8Array(memory.buffer,gh.base,4096).set(Buffer.from(gh.hex,'hex'));
 let heapAt=0x1800000;new Uint8Array(memory.buffer,heapAt,0x400000).fill(0);
 const allocator={malloc(n){const p=heapAt;heapAt=Math.ceil((p+n)/8)*8;if(heapAt>0x1c00000)throw Error('Fixture heap exhausted');return p;},free(){}};
 let clockTicks=BigInt(manifest.performanceClock.initial);const performanceClock={frequency:BigInt(manifest.performanceClock.frequency),counter(){clockTicks+=BigInt(manifest.performanceClock.increment);return clockTicks;}};
 const services=new ServiceClass(memory,Object.fromEntries(SERVICE_NAMES.map((n,i)=>[n,0x70000000+i*16])),{imageBase:c.imageBase,tib:c.tib,allocator,performanceClock,filesystem:{stat(path){return path.toLowerCase()==='c:\\geometrydash'?{directory:true}:null;}}});
 const image=mapPe64(dll,memory,c.imageBase,{resolveImport:item=>item.dll.toLowerCase()===cc.dll&&item.name===cc.name?BigInt(cc.address):services.resolve(item)}),v=new DataView(memory.buffer);
 const baselineImage=Buffer.from(new Uint8Array(memory.buffer,c.imageBase,image.size)),expectedImage=Buffer.from(baselineImage);
 v.setUint32(c.imageBase+manifest.bootstrap.timestampRva,c.initialTimestamp,true);
 for(const rva of manifest.onexitTables)services.initializeOnexit(BigInt(c.imageBase+rva));
 for(const change of c.dllChanges)Buffer.from(change.hex,'hex').copy(expectedImage,change.rva);
 new Uint8Array(memory.buffer,cpu,4096).fill(0);
 c.initial.forEach((value,i)=>v.setBigUint64(cpu+i*8,BigInt(value),true));
 c.initialXmm.forEach((value,i)=>{const n=BigInt(value);v.setBigUint64(cpu+512+i*16,BigInt.asUintN(64,n),true);v.setBigUint64(cpu+520+i*16,n>>64n,true);});
 for(const bit of [0,2,4,6,7,11])v.setUint8(cpu+2560+bit,(c.flags>>>bit)&1);
 new Uint8Array(memory.buffer,c.stackBase,c.stackHex.length/2).fill(0xa5);
 new Uint8Array(memory.buffer,c.tib,0x10000).fill(0);
 v.setBigUint64(c.tib+0x58,BigInt(c.tlsArray),true);v.setBigUint64(c.tlsArray,BigInt(c.tlsData),true);
 v.setBigUint64(c.tib+0x48,1n,true);
 v.setBigUint64(c.tib+0x40,1n,true);
 v.setBigUint64(cpu+manifest.gsOffset,BigInt(c.tib),true);
 const t=manifest.tls;
 new Uint8Array(memory.buffer,c.tlsData,t.templateSize).set(new Uint8Array(memory.buffer,c.imageBase+t.templateRva,t.templateSize));
 v.setUint32(c.imageBase+t.indexRva,0,true);
 const entry=BigInt(c.imageBase+c.entryRva),stop=BigInt(c.imageBase+c.stopRva);
 const executionStop=c.expectedFault?entry+BigInt(c.instructionLength):stop;
 let count=0,pc=entry,completed=false,faultObserved=false;
 v.setBigUint64(cpu+192,entry,true);
 try{
 for(let transfers=0;transfers<100000;transfers++){
  const r=(mode==='whole'?instance.exports.lift_run(cpu,pc,BigInt(c.imageBase),0,executionStop,20000):instance.exports.lift_slice(cpu,BigInt(c.imageBase),0,executionStop,quantum()))>>>0;count+=r&0x3fffffff;
  if(r&0x40000000)continue;
  if(!(r&0x80000000)){completed=true;break;}
  services.invoke(cpu,v.getBigUint64(cpu+192,true));pc=v.getBigUint64(cpu+192,true);
 }
 }catch(error){if(c.expectedFault&&String(error).includes('Startup lift fault '+c.expectedFault+' ')){faultObserved=true;completed=true;}else throw error;}
 assert.equal(faultObserved,!!c.expectedFault,`case ${index} division exception`);
 assert.equal(completed,true,`case ${index} transfer budget`);
 assert.deepEqual(services.calls,c.serviceCalls,`case ${index} service calls`);
 assert.equal(count,c.steps,`case ${index} steps`);
 assert.equal(v.getBigUint64(cpu+192,true),stop,`case ${index} stop`);
 c.expected.forEach((value,i)=>assert.equal(v.getBigUint64(cpu+i*8,true),BigInt(value),`case ${index} GPR ${i}`));
 c.expectedXmm.forEach((value,i)=>assert.equal(v.getBigUint64(cpu+512+i*16,true)|(v.getBigUint64(cpu+520+i*16,true)<<64n),BigInt(value),`case ${index} XMM ${i}`));
 for(const bit of [0,2,4,6,7,11])if(c.definedFlagsMask&(1<<bit))assert.equal(v.getUint8(cpu+2560+bit),(c.expectedFlags>>>bit)&1,`case ${index} flag ${bit}`);
 assert.equal(Buffer.compare(Buffer.from(memory.buffer,c.stackBase,c.stackHex.length/2),Buffer.from(c.stackHex,'hex')),0,`case ${index} native stack`);
 assert.equal(Buffer.compare(Buffer.from(memory.buffer,c.tlsData,c.tlsHex.length/2),Buffer.from(c.tlsHex,'hex')),0,`case ${index} TLS`);
 assert.equal(Buffer.compare(Buffer.from(memory.buffer,c.imageBase,image.size),expectedImage),0,`case ${index} DLL writes`);
 assert.equal(Buffer.compare(Buffer.from(memory.buffer,0x1800000,c.heapHex.length/2),Buffer.from(c.heapHex,'hex')),0,`case ${index} heap`);
 assert.deepEqual([...services.onexit.values()].flatMap(t=>t.callbacks).map(String),c.onexitCallbacks,`case ${index} exit callback registrations`);
 assert.deepEqual(services.batchSnapshot(),c.batchState,'parent batch dequeue state');
 assert.deepEqual(services.mutexSnapshot(),c.mutexState,'parent MSVC mutex state');
 assert.deepEqual(services.clockSnapshot(),c.performanceClock,'parent performance-clock state');
 assert.deepEqual(services.exceptionSnapshot().sort((a,b)=>Number(a)-Number(b)),c.exceptionState,'parent exception_ptr state');
 assert.deepEqual([...services.threadNames],c.threadNames,`case ${index} delivered thread names`);
 assert.deepEqual(services.stdioSnapshot(),c.stdioState,`case ${index} stdio object and descriptor ownership`);
 assert.deepEqual(services.pipeSnapshot(),c.pipeState,`case ${index} pipe endpoints, queues and completion ownership`);
 assert.deepEqual(services.criticalSnapshot(),c.criticalState,`case ${index} critical-section ownership and recursion`);
 assert.deepEqual(services.iocpSnapshot(),c.iocpState,`case ${index} completion ports, associations and queued packets`);
 if(manifest.boundaries[index].stopService==='_beginthreadex')assert.deepEqual(services.readThreadRequest(cpu,c.imageBase),manifest.boundaries[index].threadRequest,`case ${index} captured worker request`);
 assert.equal(Buffer.compare(Buffer.from(memory.buffer,gh.base,4096),Buffer.from(gh.hex,'hex')),0,`case ${index} primary game headers`);
 assert.equal(Buffer.compare(Buffer.from(memory.buffer,cc.pageBase,4096),Buffer.from(cc.pageHex,'hex')),0,`case ${index} Cocos code`);
 if(c.worker){
  const w=c.worker,scheduler=new GuestScheduler(services,{quantum:20000,firstId:2}),rootCpu=Buffer.from(memory.buffer,cpu,4096).slice(),previous=services.threadState,oldCalls=services.calls.length,rootStack=Buffer.from(memory.buffer,c.stackBase,65536).slice(),rootTib=Buffer.from(memory.buffer,c.tib,65536).slice();
  const thread=scheduler.createContext({entry:BigInt(c.imageBase+w.entryRva),argument:BigInt(w.argument),returnAddress:BigInt(w.returnAddress),tlsTemplate:new Uint8Array(memory.buffer,c.imageBase+t.templateRva,t.templateSize),tlsZeroFill:t.zeroFill});
  assert.equal(thread.cpu,w.cpu);assert.equal(thread.tib,w.tib);assert.equal(thread.stack,w.stack);
  let checkpointStart=0;
  for(const point of [...w.checkpoints.map(p=>({...p,kind:'worker-poll-yield'})),{...w.boundary,steps:w.steps}]){
   if(checkpointStart)clockTicks+=BigInt(w.resumePauseTicks);
   const workerStop=point.stopService?BigInt(services.addresses[point.stopService]):BigInt(c.imageBase+point.rva);let completed=false;
   while(!completed){
    assert.equal(thread.status,'runnable','continuation uses the retained runnable context');
    scheduler.runRound((thread,budget)=>{
     if(mode==='sliced')budget=Math.min(budget,quantum());
     let steps=0;
     for(let transfers=0;transfers<1000;transfers++){
      if(steps===budget)break;
      const pc=v.getBigUint64(thread.cpu+192,true),skip=thread.steps+steps===checkpointStart&&pc===workerStop;
      let limit=skip?1:budget-steps;
      if(point.kind==='worker-budget-yield')limit=Math.min(limit,point.steps-thread.steps-steps);
      const r=instance.exports.lift_slice(thread.cpu,BigInt(c.imageBase),0,point.kind==='worker-budget-yield'||skip?0xffffffffffffffffn:workerStop,limit)>>>0;steps+=r&0x3fffffff;
      if(point.kind==='worker-budget-yield'&&thread.steps+steps===point.steps){completed=true;break;}
      if(r&0x40000000){if(skip&&steps<budget)continue;break;}
      if(!(r&0x80000000)){completed=true;break;}
      services.invoke(thread.cpu,v.getBigUint64(thread.cpu+192,true));
     }
     assert.ok(steps>0,'worker slices make instruction progress');
     workerSlices++;return {steps,state:completed&&!['worker-poll-yield','worker-budget-yield'].includes(point.kind)?'blocked':'runnable',waitKey:'verified-worker-boundary'};
    });
    assert.ok(thread.steps<=w.steps,'bounded native worker trace');
   }
   assert.equal(thread.steps,point.steps,'worker checkpoint instruction count');
   assert.equal(v.getBigUint64(thread.cpu+192,true),workerStop,'worker checkpoint PC');
   if(point.expected){
    point.expected.forEach((n,i)=>assert.equal(v.getBigUint64(thread.cpu+i*8,true),BigInt(n),'checkpoint GPR '+i));
    point.expectedXmm.forEach((n,i)=>assert.equal(v.getBigUint64(thread.cpu+512+i*16,true)|(v.getBigUint64(thread.cpu+520+i*16,true)<<64n),BigInt(n),'checkpoint XMM '+i));
    for(const bit of [0,2,4,6,7,11])if(point.definedFlagsMask&(1<<bit))assert.equal(v.getUint8(thread.cpu+2560+bit),(point.expectedFlags>>>bit)&1,'checkpoint flag '+bit);
    assert.deepEqual(services.calls.slice(oldCalls),point.serviceCalls,'checkpoint service order');
   }
   checkpointStart=thread.steps;
  }
  const workerStop=w.boundary.stopService?BigInt(services.addresses[w.boundary.stopService]):BigInt(c.imageBase+w.boundary.rva);
  assert.equal(services.threadState,previous);assert.deepEqual(Buffer.from(memory.buffer,cpu,4096),rootCpu,'root CPU unchanged by actual worker');assert.deepEqual(Buffer.from(memory.buffer,c.stackBase,65536),rootStack,'root stack preserved');assert.deepEqual(Buffer.from(memory.buffer,c.tib,65536),rootTib,'root TIB preserved');
  w.expected.forEach((n,i)=>assert.equal(v.getBigUint64(thread.cpu+i*8,true),BigInt(n),`worker GPR ${i}`));
  w.expectedXmm.forEach((n,i)=>assert.equal(v.getBigUint64(thread.cpu+512+i*16,true)|(v.getBigUint64(thread.cpu+520+i*16,true)<<64n),BigInt(n),`worker XMM ${i}`));
  assert.equal(v.getBigUint64(thread.cpu+192,true),workerStop);assert.deepEqual(services.calls.slice(oldCalls),w.serviceCalls);assert.deepEqual([...services.threadNames],w.threadNames);assert.deepEqual(services.criticalSnapshot(),w.criticalState);assert.deepEqual(services.mutexSnapshot(),w.mutexState,'worker MSVC mutex state');assert.deepEqual(services.batchSnapshot(),w.batchState,'worker batch dequeue state');assert.deepEqual(services.exceptionSnapshot().sort((a,b)=>Number(a)-Number(b)),w.exceptionState,'worker exception_ptr state');assert.deepEqual(services.clockSnapshot(),w.performanceClock,'worker performance-clock state');
  const expectedHeap=Buffer.from(w.heapHex,'hex');
  for(const bit of [0,2,4,6,7,11]){const actual=v.getUint8(thread.cpu+2560+bit);if(w.definedFlagsMask&(1<<bit))assert.equal(actual,(w.expectedFlags>>>bit)&1,`worker flag ${bit}`);else expectedHeap[thread.cpu-0x1800000+2560+bit]=actual;}
  assert.deepEqual(Buffer.from(memory.buffer,0x1800000,expectedHeap.length),expectedHeap,'worker heap, CPU, stack and TIB/TLS writes');
  const expectedWorkerImage=Buffer.from(baselineImage);for(const change of w.dllChanges)Buffer.from(change.hex,'hex').copy(expectedWorkerImage,change.rva);
  assert.deepEqual(Buffer.from(memory.buffer,c.imageBase,image.size),expectedWorkerImage,'worker DLL writes');
  assert.deepEqual(Buffer.from(memory.buffer,gh.base,4096),Buffer.from(gh.hex,'hex'),'worker preserves game headers');assert.deepEqual(Buffer.from(memory.buffer,cc.pageBase,4096),Buffer.from(cc.pageHex,'hex'),'worker preserves Cocos');
  if(c.parentContinuation){
   const p=c.parentContinuation,threadRuntime=new GuestThreadLifecycle(scheduler,{entry:thread.entry,returnAddress:BigInt(w.returnAddress),tlsTemplate:new Uint8Array(memory.buffer,c.imageBase+t.templateRva,t.templateSize),tlsZeroFill:t.zeroFill});
   const parent=scheduler.adoptContext({id:1,cpu,tib:c.tib,tibSize:65536,stack:c.stackBase,stackSize:65536,errno:services.errno});
   const previousState=services.threadState,old=services.calls.length;services.selectThread(parent);
   try{
    threadRuntime.completeStart(cpu,c.imageBase,thread);
    const stop=p.boundary.stopService?BigInt(services.addresses[p.boundary.stopService]):BigInt(c.imageBase+p.boundary.rva);
    let steps=0,done=false;
    for(let turns=0;turns<10000;turns++){
     const budget=p.boundary.kind==='parent-budget-yield'?Math.min(mode==='whole'?20000:quantum(),p.steps-steps):mode==='whole'?20000:quantum();
     const effectiveStop=p.boundary.kind==='parent-budget-yield'||p.boundary.stopService==='_beginthreadex'&&threadRuntime.created.size<p.completedThreadStarts?0xffffffffffffffffn:stop;
     const r=instance.exports.lift_slice(cpu,BigInt(c.imageBase),0,effectiveStop,budget)>>>0;steps+=r&0x3fffffff;
     if(p.boundary.kind==='parent-budget-yield'&&steps===p.steps){done=true;break;}
     if(r&0x40000000)continue;
     if(!(r&0x80000000)){done=true;break;}
     const pc=v.getBigUint64(cpu+192,true);if(pc===BigInt(services.addresses._beginthreadex))threadRuntime.completeStart(cpu,c.imageBase);else if(!threadRuntime.closeCall(cpu,pc))services.invoke(cpu,pc);
    }
    assert.ok(done);assert.equal(steps,p.steps);assert.equal(v.getBigUint64(cpu+192,true),stop);
    p.expected.forEach((n,i)=>assert.equal(v.getBigUint64(cpu+i*8,true),BigInt(n),'resumed parent GPR '+i));
    p.expectedXmm.forEach((n,i)=>assert.equal(v.getBigUint64(cpu+512+i*16,true)|(v.getBigUint64(cpu+520+i*16,true)<<64n),BigInt(n),'resumed parent XMM '+i));
    for(const bit of [0,2,4,6,7,11])if(p.definedFlagsMask&(1<<bit))assert.equal(v.getUint8(cpu+2560+bit),(p.expectedFlags>>>bit)&1);
    assert.deepEqual(Buffer.from(memory.buffer,c.stackBase,65536),Buffer.from(p.stackHex,'hex'),'resumed parent stack');
    assert.deepEqual(Buffer.from(memory.buffer,c.tlsData,p.tlsHex.length/2),Buffer.from(p.tlsHex,'hex'),'resumed parent TLS');
    const expected=Buffer.from(p.heapHex,'hex');for(const bit of [0,2,4,6,7,11])if(!(w.definedFlagsMask&(1<<bit)))expected[thread.cpu-0x1800000+2560+bit]=v.getUint8(thread.cpu+2560+bit);
    assert.deepEqual(Buffer.from(memory.buffer,0x1800000,expected.length),expected,'resumed parent process heap');
    const imageExpected=Buffer.from(baselineImage);for(const change of p.dllChanges)Buffer.from(change.hex,'hex').copy(imageExpected,change.rva);assert.deepEqual(Buffer.from(memory.buffer,c.imageBase,image.size),imageExpected,'resumed parent DLL');
    assert.equal(threadRuntime.created.size,p.completedThreadStarts);for(const expected of p.createdWorkers){const actual=scheduler.threads.get(expected.id);assert.equal(actual.cpu,expected.cpu);assert.equal(actual.tib,expected.tib);assert.equal(actual.stack,expected.stack);}
    assert.deepEqual(services.calls.slice(old),p.serviceCalls);assert.deepEqual([...threadRuntime.handles.keys()].map(String),p.threadHandles);assert.deepEqual(services.clockSnapshot(),p.clock);assert.deepEqual(services.mutexSnapshot(),p.mutexState);
   }finally{services.threadState=previousState;}
  }
  scheduler.dispose();if(mode==='sliced')slicedWorkerCases++;
 }

 if(mode==='sliced')slicedCases++;
}
}
// Instruction-budget yields preserve RIP and all state. Exact-budget stops
// take precedence for the slice API; legacy lift_run still faults on exhaustion.
let sliceContractCases=0;
{
 const v=new DataView(memory.buffer),base=BigInt(manifest.cases[0].imageBase),entry=base+0x50fc87n,end=entry+3n;
 const reset=()=>{new Uint8Array(memory.buffer,cpu,4096).fill(0);v.setBigUint64(cpu,123n,true);v.setBigUint64(cpu+56,3n,true);v.setBigUint64(cpu+192,entry,true);};
 reset();let before=Buffer.from(memory.buffer,cpu,4096).slice();
 assert.equal(instance.exports.lift_slice(cpu,base,0,end,0)>>>0,0x40000000);assert.deepEqual(Buffer.from(memory.buffer,cpu,4096),before);sliceContractCases++;
 assert.equal(instance.exports.lift_slice(cpu,base,0,entry,0),0);assert.deepEqual(Buffer.from(memory.buffer,cpu,4096),before);sliceContractCases++;
 assert.equal(instance.exports.lift_slice(cpu,base,0,end,1),1);assert.equal(v.getBigUint64(cpu,true),41n);assert.equal(v.getBigUint64(cpu+192,true),end);sliceContractCases++;
 reset();assert.equal(instance.exports.lift_slice(cpu,base,0,0xffffffffffffffffn,1)>>>0,0x40000001);assert.equal(v.getBigUint64(cpu+192,true),end);sliceContractCases++;
 v.setBigUint64(cpu+192,0x70000000n,true);before=Buffer.from(memory.buffer,cpu,4096).slice();assert.equal(instance.exports.lift_slice(cpu,base,0,0xffffffffffffffffn,1)>>>0,0x80000000);assert.deepEqual(Buffer.from(memory.buffer,cpu,4096),before);sliceContractCases++;
 reset();before=Buffer.from(memory.buffer,cpu,4096).slice();assert.throws(()=>instance.exports.lift_slice(cpu,base,0,end,0x40000000),/Startup lift fault 6 /);assert.deepEqual(Buffer.from(memory.buffer,cpu,4096),before);sliceContractCases++;
 reset();assert.throws(()=>instance.exports.lift_run(cpu,entry,base,0,end,1),/Startup lift fault 4 /);assert.equal(v.getBigUint64(cpu+192,true),end);sliceContractCases++;
}
// Differential checks execute the actual lifted DIV instructions. BigInt is
// the independent arithmetic oracle; no division algorithm is copied here.
let divisionCases=0,seed=0x123456789abcdefn;
const random64=()=>{seed=BigInt.asUintN(64,seed^(seed<<13n));seed=BigInt.asUintN(64,seed^(seed>>7n));seed=BigInt.asUintN(64,seed^(seed<<17n));return seed;};
for(const [rva,width,operand,length] of [[0x4f060f,32,64,3],[0x4f074e,32,72,3],[0x50fc6e,32,56,2],[0x50fc87,64,56,3]]){
 const bits=BigInt(width),mask=(1n<<bits)-1n,v=new DataView(memory.buffer),imageBase=BigInt(manifest.cases[0].imageBase),entry=imageBase+BigInt(rva);
 for(let i=0;i<256;i++){
  const divisor=(random64()&mask)||1n,high=random64()%divisor,low=random64()&mask,numerator=(high<<bits)|low;
  new Uint8Array(memory.buffer,cpu,4096).fill(0);v.setBigUint64(cpu,low,true);v.setBigUint64(cpu+16,high,true);v.setBigUint64(cpu+operand,divisor,true);
  if(width===32){v.setBigUint64(cpu,low|((random64()&mask)<<32n),true);v.setBigUint64(cpu+16,high|((random64()&mask)<<32n),true);v.setBigUint64(cpu+operand,divisor|((random64()&mask)<<32n),true);}
  assert.equal(instance.exports.lift_run(cpu,entry,imageBase,0,entry+BigInt(length),2),1);
  assert.equal(v.getBigUint64(cpu,true),numerator/divisor,'differential quotient');assert.equal(v.getBigUint64(cpu+16,true),numerator%divisor,'differential remainder');divisionCases++;
 }
 for(const [high,divisor] of [[0n,0n],[2n,2n]]){
  new Uint8Array(memory.buffer,cpu,4096).fill(0);v.setBigUint64(cpu,123n,true);v.setBigUint64(cpu+16,high,true);v.setBigUint64(cpu+operand,divisor,true);v.setBigUint64(cpu+192,entry,true);
  const before=Buffer.from(memory.buffer,cpu,4096).slice();assert.throws(()=>instance.exports.lift_run(cpu,entry,imageBase,0,entry+BigInt(length),2),/Startup lift fault 5 /);assert.deepEqual(Buffer.from(memory.buffer,cpu,4096),before,'divide fault preserves complete CPU shadow');divisionCases++;
 }
}
const result={status:'DEFERRED_NATIVE_REFERENCE_PASS',sliceContractCases,slicedCases,slicedWorkerCases,workerSlices,divisionCases,cases:manifest.cases.length,workerCases:manifest.cases.filter(c=>c.worker).length,parentContinuations:manifest.cases.filter(c=>c.parentContinuation).map(c=>({imageBase:c.imageBase,steps:c.parentContinuation.steps,boundary:c.parentContinuation.boundary})),workerBoundaries:manifest.cases.filter(c=>c.worker).map(c=>({imageBase:c.imageBase,...c.worker.boundary,steps:c.worker.steps,entryRva:c.worker.entryRva,resumePauseTicks:c.worker.resumePauseTicks,checkpoints:c.worker.checkpoints.map(p=>({rva:p.rva,steps:p.steps}))})),uniqueInstructions:manifest.uniqueInstructions,boundaries:manifest.boundaries,wasmSha256:createHash('sha256').update(wasm).digest('hex'),fullGeodeLoader:false};
await writeFile(dir+'/reference-result.json',JSON.stringify(result,null,2));
const first=manifest.cases[0];
await writeFile(dir+'/runtime-manifest.json',JSON.stringify({dllSha256:manifest.dllSha256,wasmSha256:result.wasmSha256,servicesSha256:createHash('sha256').update(await readFile(dir+'/services.mjs')).digest('hex'),entryRva:manifest.entryRva,stopRva:first.stopRva,steps:first.steps,nextService:manifest.boundaries[0].service,stopService:manifest.boundaries[0].stopService,nextThreadRequest:manifest.boundaries[0].threadRequest,nextBoundaryKind:manifest.boundaries[0].kind,parentContinuation:first.parentContinuation?{completedThreadStarts:first.parentContinuation.completedThreadStarts,steps:first.parentContinuation.steps,entryRva:first.parentContinuation.entryRva,boundary:first.parentContinuation.boundary}:undefined,worker:first.worker?{checkpoints:first.worker.checkpoints.map(p=>({rva:p.rva,steps:p.steps})),sliceQuantum:127,nextCompletionRequest:first.worker.boundary.completionRequest,clockDependent:first.worker.performanceClock.counterReads>0,entryRva:first.worker.entryRva,steps:first.worker.steps,stopRva:first.worker.boundary.rva,stopService:first.worker.boundary.stopService,nextService:first.worker.boundary.service,nextBoundaryKind:first.worker.boundary.kind||'service-call'}:undefined,nextDialog:manifest.boundaries[0].dialog,nextPipeRequest:manifest.boundaries[0].pipeRequest,cocos:manifest.cocos,bootstrap:manifest.bootstrap,tls:manifest.tls,gsOffset:manifest.gsOffset,onexitTables:manifest.onexitTables},null,2));
console.log(JSON.stringify(result,null,2));


