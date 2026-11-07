import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {instantiateStartupLift} from '../experiments/geode-binary/handoff/startup-module.mjs';
import {mapPe64} from '../experiments/geode-binary/pe-image.mjs';
import {GuestScheduler} from '../experiments/geode-binary/guest-scheduler.mjs';
const dir=resolve(process.argv[2]),dll=await readFile('/tmp/Geode.dll');
const {ServiceClass,SERVICE_NAMES}=await import(pathToFileURL(dir+'/services.mjs'));
const manifest=JSON.parse(await readFile(dir+'/manifest.json'));
const wasm=await readFile(dir+'/deferred.wasm');
assert.equal(createHash('sha256').update(dll).digest('hex'),manifest.dllSha256);
const memory=new WebAssembly.Memory({initial:6144,maximum:65536}),cpu=4096;
const instance=await instantiateStartupLift(wasm,memory);
for(const [index,c] of manifest.cases.entries()){
 const cc=manifest.cocos;new Uint8Array(memory.buffer,cc.pageBase,4096).set(Buffer.from(cc.pageHex,'hex'));
 const gh=manifest.gameHeaders;new Uint8Array(memory.buffer,gh.base,4096).set(Buffer.from(gh.hex,'hex'));
 let heapAt=0x1800000;new Uint8Array(memory.buffer,heapAt,0x400000).fill(0);
 const allocator={malloc(n){const p=heapAt;heapAt=Math.ceil((p+n)/8)*8;if(heapAt>0x1c00000)throw Error('Fixture heap exhausted');return p;},free(){}};
 const services=new ServiceClass(memory,Object.fromEntries(SERVICE_NAMES.map((n,i)=>[n,0x70000000+i*16])),{imageBase:c.imageBase,tib:c.tib,allocator,filesystem:{stat(path){return path.toLowerCase()==='c:\\geometrydash'?{directory:true}:null;}}});
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
 let count=0,pc=entry,completed=false;
 for(let transfers=0;transfers<1000;transfers++){
  const r=instance.exports.lift_run(cpu,pc,BigInt(c.imageBase),0,stop,20000)>>>0;count+=r&0x7fffffff;
  if(!(r&0x80000000)){completed=true;break;}
  services.invoke(cpu,v.getBigUint64(cpu+192,true));pc=v.getBigUint64(cpu+192,true);
 }
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
 assert.deepEqual([...services.threadNames],c.threadNames,`case ${index} delivered thread names`);
 assert.deepEqual(services.stdioSnapshot(),c.stdioState,`case ${index} stdio object and descriptor ownership`);
 assert.deepEqual(services.pipeSnapshot(),c.pipeState,`case ${index} pipe endpoints, queues and completion ownership`);
 assert.deepEqual(services.criticalSnapshot(),c.criticalState,`case ${index} critical-section ownership and recursion`);
 assert.deepEqual(services.iocpSnapshot(),c.iocpState,`case ${index} completion ports, associations and queued packets`);
 if(manifest.boundaries[index].stopService==='_beginthreadex')assert.deepEqual(services.readThreadRequest(cpu,c.imageBase),manifest.boundaries[index].threadRequest,`case ${index} captured worker request`);
 assert.equal(Buffer.compare(Buffer.from(memory.buffer,gh.base,4096),Buffer.from(gh.hex,'hex')),0,`case ${index} primary game headers`);
 assert.equal(Buffer.compare(Buffer.from(memory.buffer,cc.pageBase,4096),Buffer.from(cc.pageHex,'hex')),0,`case ${index} Cocos code`);
 if(c.worker){
  const w=c.worker,scheduler=new GuestScheduler(services,{quantum:20000,firstId:2}),rootCpu=Buffer.from(memory.buffer,cpu,4096).slice(),previous=services.threadState,oldCalls=services.calls.length;
  const thread=scheduler.createContext({entry:BigInt(c.imageBase+w.entryRva),argument:BigInt(w.argument),returnAddress:BigInt(w.returnAddress),tlsTemplate:new Uint8Array(memory.buffer,c.imageBase+t.templateRva,t.templateSize),tlsZeroFill:t.zeroFill});
  assert.equal(thread.cpu,w.cpu);assert.equal(thread.tib,w.tib);assert.equal(thread.stack,w.stack);
  const workerStop=BigInt(c.imageBase+w.boundary.rva);let completed=false;
  scheduler.runRound((thread,budget)=>{
   let steps=0,pc=BigInt(c.imageBase+w.entryRva);
   for(let transfers=0;transfers<1000;transfers++){
    assert.ok(steps<budget,'worker quantum exhausted');const r=instance.exports.lift_run(thread.cpu,pc,BigInt(c.imageBase),0,workerStop,budget-steps)>>>0;steps+=r&0x7fffffff;
    if(!(r&0x80000000)){completed=true;break;}
    services.invoke(thread.cpu,v.getBigUint64(thread.cpu+192,true));pc=v.getBigUint64(thread.cpu+192,true);
   }
   assert.equal(completed,true);assert.equal(steps,w.steps);return {steps,state:'blocked',waitKey:'verified-worker-boundary'};
  });
  assert.equal(services.threadState,previous);assert.deepEqual(Buffer.from(memory.buffer,cpu,4096),rootCpu,'root CPU unchanged by actual worker');
  w.expected.forEach((n,i)=>assert.equal(v.getBigUint64(thread.cpu+i*8,true),BigInt(n),`worker GPR ${i}`));
  w.expectedXmm.forEach((n,i)=>assert.equal(v.getBigUint64(thread.cpu+512+i*16,true)|(v.getBigUint64(thread.cpu+520+i*16,true)<<64n),BigInt(n),`worker XMM ${i}`));
  assert.equal(v.getBigUint64(thread.cpu+192,true),workerStop);assert.deepEqual(services.calls.slice(oldCalls),w.serviceCalls);assert.deepEqual([...services.threadNames],w.threadNames);assert.deepEqual(services.criticalSnapshot(),w.criticalState);
  const expectedHeap=Buffer.from(w.heapHex,'hex');
  for(const bit of [0,2,4,6,7,11]){const actual=v.getUint8(thread.cpu+2560+bit);if(w.definedFlagsMask&(1<<bit))assert.equal(actual,(w.expectedFlags>>>bit)&1,`worker flag ${bit}`);else expectedHeap[thread.cpu-0x1800000+2560+bit]=actual;}
  assert.deepEqual(Buffer.from(memory.buffer,0x1800000,expectedHeap.length),expectedHeap,'worker heap, CPU, stack and TIB/TLS writes');
  const expectedWorkerImage=Buffer.from(baselineImage);for(const change of w.dllChanges)Buffer.from(change.hex,'hex').copy(expectedWorkerImage,change.rva);
  assert.deepEqual(Buffer.from(memory.buffer,c.imageBase,image.size),expectedWorkerImage,'worker DLL writes');
  assert.deepEqual(Buffer.from(memory.buffer,gh.base,4096),Buffer.from(gh.hex,'hex'),'worker preserves game headers');assert.deepEqual(Buffer.from(memory.buffer,cc.pageBase,4096),Buffer.from(cc.pageHex,'hex'),'worker preserves Cocos');
  scheduler.dispose();
 }

}
const result={status:'DEFERRED_NATIVE_REFERENCE_PASS',cases:manifest.cases.length,workerCases:manifest.cases.filter(c=>c.worker).length,workerBoundaries:manifest.cases.filter(c=>c.worker).map(c=>({imageBase:c.imageBase,...c.worker.boundary,steps:c.worker.steps,entryRva:c.worker.entryRva})),uniqueInstructions:manifest.uniqueInstructions,boundaries:manifest.boundaries,wasmSha256:createHash('sha256').update(wasm).digest('hex'),fullGeodeLoader:false};
await writeFile(dir+'/reference-result.json',JSON.stringify(result,null,2));
const first=manifest.cases[0];
await writeFile(dir+'/runtime-manifest.json',JSON.stringify({dllSha256:manifest.dllSha256,wasmSha256:result.wasmSha256,servicesSha256:createHash('sha256').update(await readFile(dir+'/services.mjs')).digest('hex'),entryRva:manifest.entryRva,stopRva:first.stopRva,steps:first.steps,nextService:manifest.boundaries[0].service,stopService:manifest.boundaries[0].stopService,nextThreadRequest:manifest.boundaries[0].threadRequest,nextBoundaryKind:manifest.boundaries[0].kind,nextDialog:manifest.boundaries[0].dialog,nextPipeRequest:manifest.boundaries[0].pipeRequest,cocos:manifest.cocos,bootstrap:manifest.bootstrap,tls:manifest.tls,gsOffset:manifest.gsOffset,onexitTables:manifest.onexitTables},null,2));
console.log(JSON.stringify(result,null,2));
