export async function loadSetup(e,helper,base){
 const m=await fetch(new URL('setup-manifest.json',base),{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error('Setup manifest HTTP '+r.status);return r.json();});
 const [bytes,services]=await Promise.all([fetch(new URL('setup.wasm?sha='+m.wasmSha256,base)).then(r=>{if(!r.ok)throw Error('Setup WASM HTTP '+r.status);return r.arrayBuffer();}),import(new URL('setup-services.mjs?sha='+m.servicesSha256,base).href)]);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
 if(hash!==m.wasmSha256||m.dllSha256!=='ccedc2f1c86baf342f6720b9685991ca31fba246453efe2a1daf609dc40b6499')throw Error('Pinned setup module mismatch');
 return new SetupContext(e,m,await helper.instantiateStartupLift(bytes,e.memory),services);
}
class SetupContext{
 constructor(e,m,aux,services){this.e=e;this.metadata=m;this.aux=aux;this.serviceTypes=services;this.allocations=[];}
 allocate(size){const p=this.e.malloc(size);if(!Number.isSafeInteger(p)||p<=0||p+size>this.e.memory.buffer.byteLength)throw Error('Setup reservation failed');this.allocations.push(p);return p;}
 reserve(){
  if(typeof SharedArrayBuffer!=='undefined'&&this.e.memory.buffer instanceof SharedArrayBuffer)throw Error('Startup atomic profile requires one non-shared guest CPU');
  this.tib=Math.ceil(this.allocate(0x10010)/16)*16;
  this.stack=this.allocate(0x10000);this.stackTop=Math.floor((this.stack+0x10000-128)/16)*16-8;
  const decoders=[null,new TextDecoder(),new TextDecoder()];
  this.services=new this.serviceTypes.ServiceClass(this.e.memory,Object.fromEntries(this.serviceTypes.SERVICE_NAMES.map((n,i)=>[n,this.tib+0xf000+i*16])),{tib:this.tib,allocator:this.e,filesystem:this.serviceTypes.gameFilesystem(globalThis.Module?.FS),input:new this.serviceTypes.BrowserModifiers(globalThis.window),outputSink:(channel,bytes)=>globalThis.console.log(decoders[channel].decode(bytes,{stream:true}))});
  if(this.metadata.cocos){
   this.cocos=this.serviceTypes.inspectCocos(this.e.memory,globalThis.Module.FS);
   for(const key of ['base','imageSize','timestamp','dll','name','rva','address','pageBase','pageHex'])if(this.cocos[key]!==this.metadata.cocos[key])throw Error('Unverified live Cocos binding: '+key);
  }
 }
 resolveImport(item){if(this.cocos&&item.dll.toLowerCase()===this.cocos.dll&&item.name===this.cocos.name)return BigInt(this.cocos.address);return this.services.resolve(item);}
 run(shadow,imageBase,liveSp,compilerTop){
  const {e,metadata:m}=this,t=m.tls;
  this.services.modules.set(BigInt(imageBase),'C:\\GeometryDash\\Geode.dll');
  const game=new DataView(e.memory.buffer),pe=game.getUint32(0x40003c,true),stamp=game.getUint32(0x400000+pe+8,true);
  if(pe>3500||game.getUint16(0x400000,true)!==0x5a4d||game.getUint32(0x400000+pe,true)!==0x4550||stamp!==m.bootstrap.gameTimestamp)throw Error('Unverified primary game PE header');
  if(m.bootstrap.timestampRva!==0xfb22a8)throw Error('Unverified pinned bootstrap timestamp location');
  game.setUint32(imageBase+m.bootstrap.timestampRva,stamp,true);
  for(const rva of m.onexitTables)this.services.initializeOnexit(BigInt(imageBase+rva));
  if(t.templateSize+t.zeroFill>4096||t.templateRva+t.templateSize>17035264||t.indexRva+4>17035264)throw Error('Setup TLS template bounds');
  new Uint8Array(e.memory.buffer,this.tib,0x10000).fill(0);
  new Uint8Array(e.memory.buffer,this.stack,0x10000).fill(0xa5);
  const v=new DataView(e.memory.buffer),array=this.tib+0x1000,data=this.tib+0x2000;
  v.setBigUint64(this.tib+0x58,BigInt(array),true);v.setBigUint64(array,BigInt(data),true);
  v.setBigUint64(this.tib+0x48,1n,true);
  v.setBigUint64(this.tib+0x40,1n,true);
  new Uint8Array(e.memory.buffer,data,t.templateSize).set(new Uint8Array(e.memory.buffer,imageBase+t.templateRva,t.templateSize));
  v.setUint32(imageBase+t.indexRva,0,true);
  if(liveSp+64>v.byteLength)throw Error('Caller home-frame bounds');
  new Uint8Array(e.memory.buffer,this.stackTop,64).set(new Uint8Array(e.memory.buffer,liveSp,64));
  v.setBigUint64(shadow+32,BigInt(this.stackTop),true);v.setBigUint64(shadow+m.gsOffset,BigInt(this.tib),true);
  this.aux.exports.__stack_pointer.value=compilerTop;
  const stop=m.stopService?BigInt(this.services.addresses[m.stopService]):BigInt(imageBase+m.stopRva);let pc=BigInt(imageBase+m.entryRva),steps=0;
  for(let transfers=0;transfers<1000;transfers++){
   const r=this.aux.exports.lift_run(shadow,pc,BigInt(imageBase),0,stop,20000)>>>0;steps+=r&0x7fffffff;
   if(steps>m.steps)throw Error('Setup exceeded verified instruction budget');
   const state=new DataView(e.memory.buffer);
   if(!(r&0x80000000)){
    if(state.getBigUint64(shadow+192,true)!==stop||steps!==m.steps||this.services.held.size)throw Error('Unexpected setup stop state');
    const dialog=m.nextService==='USER32.dll!MessageBoxW'?{text:this.services.wide(state.getBigUint64(shadow+16,true)),caption:this.services.wide(state.getBigUint64(shadow+64,true))}:undefined;
    if(m.nextDialog&&JSON.stringify(dialog)!==JSON.stringify(m.nextDialog))throw Error('Live loader diagnostic differs from native reference');
    let pipeRequest;
    if(m.nextPipeRequest){const sp=state.getBigUint64(shadow+32,true);this.services.range(sp,64);const p=Number(sp);pipeRequest={path:this.services.wide(state.getBigUint64(shadow+8,true)),openMode:state.getUint32(shadow+16,true),pipeMode:state.getUint32(shadow+64,true),maxInstances:state.getUint32(shadow+72,true),outBufferSize:state.getUint32(p+32,true),inBufferSize:state.getUint32(p+40,true),defaultTimeout:state.getUint32(p+48,true),security:'0x'+state.getBigUint64(p+56,true).toString(16)};if(JSON.stringify(pipeRequest)!==JSON.stringify(m.nextPipeRequest))throw Error('Live named-pipe request differs from native reference');}
    const threadRequest=m.stopService==='_beginthreadex'?this.services.readThreadRequest(shadow,imageBase):undefined;
    if(m.nextThreadRequest)for(const key of ['security','stackSize','entryRva','argumentIsNull','initFlags','threadIdOutputIsNull','threadCreationImplemented'])if(threadRequest[key]!==m.nextThreadRequest[key])throw Error('Live worker request differs from native reference: '+key);
    const worker=m.worker?this.runWorker(shadow,imageBase,threadRequest,compilerTop):undefined;
    return {steps,stop,service:m.nextService,dialog,pipeRequest,threadRequest,worker,pipeState:this.services.pipeSnapshot?.(),iocpState:this.services.iocpSnapshot?.(),criticalState:this.services.criticalSnapshot?.(),calls:[...this.services.calls],threadNames:[...(this.services.threadNames||[])],stdioState:this.services.stdioSnapshot?.(),tib:this.tib,isolatedStack:this.stackTop,onexitCallbacks:[...this.services.onexit.values()].reduce((n,t)=>n+t.callbacks.length,0),
     nextArguments:[8,16,64,72].map(o=>'0x'+new DataView(e.memory.buffer).getBigUint64(shadow+o,true).toString(16))};
   }
   this.services.invoke(shadow,state.getBigUint64(shadow+192,true));pc=new DataView(e.memory.buffer).getBigUint64(shadow+192,true);
  }
  throw Error('Setup transfer limit');
 }
 runWorker(rootCpu,imageBase,request){
  const {e,metadata:m}=this,w=m.worker,s=this.services,quantum=w.sliceQuantum;
  if(this.scheduler||!request||request.entryRva!==w.entryRva||request.security!=='0x0'||request.stackSize!==0||request.initFlags!==0)throw Error('Unverified worker call profile');
  if(!Number.isInteger(quantum)||quantum<1||quantum>1000||typeof this.aux.exports.lift_slice!=='function')throw Error('Missing verified worker slice contract');
  this.scheduler=new this.serviceTypes.GuestScheduler(s,{quantum,firstId:2});
  const before=new Uint8Array(e.memory.buffer,rootCpu,4096).slice(),oldCalls=s.calls.length,parentStack=new Uint8Array(e.memory.buffer,this.stack,65536).slice(),parentTib=new Uint8Array(e.memory.buffer,this.tib,65536).slice();
  const thread=this.scheduler.createContext({entry:BigInt(imageBase+w.entryRva),argument:BigInt(request.argument),returnAddress:BigInt(this.tib+0xeff0),tlsTemplate:new Uint8Array(e.memory.buffer,imageBase+m.tls.templateRva,m.tls.templateSize),tlsZeroFill:m.tls.zeroFill});
  // The original handoff frees its temporary translator allocations. Both CPU
  // and compiler stack used by later browser turns have independent ownership.
  this.savedRoot=Number(s.allocate(4096n));if(!this.savedRoot)throw Error('Could not retain parent CPU');
  new Uint8Array(e.memory.buffer,this.savedRoot,4096).set(before);
  const compiler=this.allocate(65536);
  this.workerState={thread,imageBase,oldCalls,quantum,compilerTop:(compiler+65536)&~15,checkpoints:[],rounds:0,maxSliceSteps:0,previousNative:0,index:0,points:[...w.checkpoints.map(p=>({...p,kind:'worker-poll-yield'})),{rva:w.stopRva,steps:w.steps,stopService:w.stopService,kind:w.nextBoundaryKind}],parentSnapshots:[[before,this.savedRoot],[parentStack,this.stack],[parentTib,this.tib]]};
  const report=this.resumeWorker();
  if(!before.every((b,i)=>new Uint8Array(e.memory.buffer)[rootCpu+i]===b))throw Error('Worker changed parent CPU');
  return report;
 }
 readPendingWorkerWait(){
  const {thread}=this.workerState,s=this.services,v=new DataView(this.e.memory.buffer);
  if(v.getBigUint64(thread.cpu+192,true)!==BigInt(s.addresses.GetQueuedCompletionStatusEx))return;
  const sp=v.getBigUint64(thread.cpu+32,true);s.range(sp,56);const tail=Number(sp)+40,timeoutMs=v.getUint32(tail,true),alertable=v.getUint32(tail+8,true);
  if(!timeoutMs&&!alertable)return;
  const request={entryCount:v.getUint32(thread.cpu+64,true),timeoutMs,alertable,entriesNonNull:v.getBigUint64(thread.cpu+16,true)!==0n,removedNonNull:v.getBigUint64(thread.cpu+72,true)!==0n,ownedPort:s.ports.has(v.getBigUint64(thread.cpu+8,true))};
  if(request.entryCount!==64||alertable!==0||!request.entriesNonNull||!request.removedNonNull||!request.ownedPort)throw Error('Unverified pending worker wait profile');
  // Retain the API-entry CPU unchanged. Timed waits need actual wakeup support;
  // neither a return value nor a completion packet is supplied here.
  return request;
 }
 resumeWorker(){
  const state=this.workerState,{e,metadata:m}=this,s=this.services,w=m.worker;
  if(this.disposed||!state||state.index>=state.points.length||state.pendingWait)throw Error('Worker has no pending verified continuation');
  const {thread,imageBase,quantum}=state,point=state.points[state.index],startSteps=thread.steps,startPc=new DataView(e.memory.buffer).getBigUint64(thread.cpu+192,true),targetSteps=startSteps+point.steps-state.previousNative;
  if(thread.status!=='runnable')throw Error('Worker is not runnable');
  const stop=point.stopService?BigInt(s.addresses[point.stopService]):BigInt(imageBase+point.rva);let completed=false;
  this.aux.exports.__stack_pointer.value=state.compilerTop;
  while(!completed){
   const pending=this.readPendingWorkerWait();
   if(pending){state.pendingWait=pending;thread.status='blocked';thread.waitKey='verified-worker-wait';break;}
   if(++state.rounds>1000||thread.steps-startSteps>=20000)throw Error('Worker continuation budget exhausted');
   this.scheduler.runRound((thread,budget)=>{
    let steps=0;
    for(let transfers=0;transfers<1000;transfers++){
     if(steps===budget)break;
     const pc=new DataView(e.memory.buffer).getBigUint64(thread.cpu+192,true),skip=thread.steps+steps===startSteps&&pc===stop;
     let limit=skip?1:budget-steps;
     if(point.kind==='worker-budget-yield')limit=Math.min(limit,targetSteps-thread.steps-steps);
     const r=this.aux.exports.lift_slice(thread.cpu,BigInt(imageBase),0,point.kind==='worker-budget-yield'||skip?0xffffffffffffffffn:stop,limit)>>>0;steps+=r&0x3fffffff;
     if(point.kind==='worker-budget-yield'&&thread.steps+steps===targetSteps){completed=true;break;}
     if(r&0x40000000){if(skip&&steps<budget)continue;break;}
     if(!(r&0x80000000)){completed=true;break;}
     const pending=this.readPendingWorkerWait();
     if(pending){state.pendingWait=pending;break;}
     s.invoke(thread.cpu,new DataView(e.memory.buffer).getBigUint64(thread.cpu+192,true));
    }
    if(!steps)throw Error('Worker slice made no instruction progress');
    state.maxSliceSteps=Math.max(state.maxSliceSteps,steps);
    return {steps,state:state.pendingWait||completed&&!['worker-poll-yield','worker-budget-yield'].includes(point.kind)?'blocked':'runnable',waitKey:'verified-worker-boundary'};
   });
   if(state.pendingWait)break;
  }
  const endPc=new DataView(e.memory.buffer).getBigUint64(thread.cpu+192,true);
  if(!w.clockDependent&&(thread.steps!==targetSteps||endPc!==stop))throw Error('Worker continuation differs from native reference');
  for(const [snapshot,pointer] of state.parentSnapshots)if(!snapshot.every((b,i)=>new Uint8Array(e.memory.buffer)[pointer+i]===b))throw Error('Worker changed parent CPU/stack/TIB');
  const kind=state.pendingWait?'unsupported-batch-wait':point.kind;
  state.checkpoints.push({startPc:'0x'+startPc.toString(16),endPc:'0x'+endPc.toString(16),instructions:thread.steps-startSteps,kind});
  state.previousNative=point.steps;state.index++;
  const pendingContinuations=!state.pendingWait&&thread.status==='runnable'&&state.index<state.points.length;
  const report={status:'WORKER_CALLBACK_BOUNDARY_PASS',id:thread.id,entryRva:w.entryRva,instructions:thread.steps,sliceQuantum:quantum,sliceCount:state.rounds,maxSliceSteps:state.maxSliceSteps,continuations:state.checkpoints.length-1,continuedFromSavedCpu:state.checkpoints.length>1,checkpoints:state.checkpoints.slice(),pendingContinuations,compilerStackRetained:true,nextRequiredService:state.pendingWait?'KERNEL32.dll!GetQueuedCompletionStatusEx':state.index===state.points.length?w.nextService:'Worker scheduler continuation',nextBoundaryKind:kind,rootCpuPreserved:true,rootCpuRetained:true,contextRetained:true,runnable:thread.status==='runnable',threadCreationImplemented:false,crtThreadStartupImplemented:false,performanceClock:s.clockSnapshot?.(),mutexes:s.mutexSnapshot?.(),batchPolls:s.batchSnapshot?.(),pendingCompletionRequest:state.pendingWait,executedServices:s.calls.slice(state.oldCalls)};
  if(!pendingContinuations&&m.parentContinuation){state.parentReport??=this.resumeParent();report.parentContinuation=state.parentReport;report.threadCreationImplemented=true;}
  return report;
 }
 resumeParent(){
  const {e,metadata:m,services:s,workerState:w}=this,p=m.parentContinuation,cpu=this.savedRoot,previous=s.threadState;
  const parent=this.scheduler.adoptContext({id:1,cpu,tib:this.tib,tibSize:65536,stack:this.stack,stackSize:65536,errno:s.errno});
  const runtime=this.threadRuntime=new this.serviceTypes.GuestThreadLifecycle(this.scheduler,{entry:BigInt(w.imageBase+m.worker.entryRva),returnAddress:BigInt(this.tib+0xeff0),tlsTemplate:new Uint8Array(e.memory.buffer,w.imageBase+m.tls.templateRva,m.tls.templateSize),tlsZeroFill:m.tls.zeroFill});
  const snapshots=[[w.thread.cpu,4096],[w.thread.stack,w.thread.stackSize],[w.thread.tib,0x4000]].map(([pointer,n])=>({pointer,bytes:new Uint8Array(e.memory.buffer,pointer,n).slice()})),old=s.calls.length;
  s.selectThread(parent);let steps=0,done=false,turns=0,created;
  try{
   created=runtime.completeStart(cpu,w.imageBase,w.thread);
   const stop=p.boundary.stopService?BigInt(s.addresses[p.boundary.stopService]):BigInt(w.imageBase+p.boundary.rva);
   this.aux.exports.__stack_pointer.value=w.compilerTop;
   for(;turns<1000;turns++){
    if(steps>=4000)throw Error('Parent continuation exceeded bounded profile');
    const budget=p.boundary.kind==='parent-budget-yield'?Math.min(127,p.steps-steps):Math.min(127,4000-steps);
    const effectiveStop=p.boundary.kind==='parent-budget-yield'||p.boundary.stopService==='_beginthreadex'&&runtime.created.size<p.completedThreadStarts?0xffffffffffffffffn:stop;
    const r=this.aux.exports.lift_slice(cpu,BigInt(w.imageBase),0,effectiveStop,budget)>>>0;steps+=r&0x3fffffff;
    if(p.boundary.kind==='parent-budget-yield'&&steps===p.steps){done=true;break;}
    if(r&0x40000000)continue;
    if(!(r&0x80000000)){done=true;break;}
    const pc=new DataView(e.memory.buffer).getBigUint64(cpu+192,true);if(pc===BigInt(s.addresses._beginthreadex))runtime.completeStart(cpu,w.imageBase);else if(!runtime.closeCall(cpu,pc))s.invoke(cpu,pc);
   }
   if(!done||runtime.created.size!==p.completedThreadStarts||steps!==p.steps||new DataView(e.memory.buffer).getBigUint64(cpu+192,true)!==stop)throw Error('Parent differs from native continuation boundary');
   for(const {pointer,bytes} of snapshots)if(!bytes.every((b,i)=>new Uint8Array(e.memory.buffer)[pointer+i]===b))throw Error('Parent continuation changed worker private storage');
   parent.steps+=steps;parent.status='blocked';parent.waitKey='verified-parent-boundary';
   const nextThreadRequest=p.boundary.stopService==='_beginthreadex'?s.readThreadRequest(cpu,w.imageBase):undefined;
   return {status:'COMPONENT_PARENT_CONTINUATION_PASS',instructions:steps,slices:turns+1,nextRequiredService:p.boundary.service,nextBoundaryKind:p.boundary.kind||'service-call',nextThreadRequest,handle:'0x'+created.handle.toString(16),threadId:created.id,createdThreadCount:runtime.created.size,runnableWorkers:[...this.scheduler.threads.values()].filter(t=>t.id!==1&&t.status==='runnable').length,idOutputWritten:true,existingWorkerReused:true,workerPrivateStoragePreserved:true,executedServices:s.calls.slice(old),activeThreadHandles:[...runtime.handles.keys()].map(h=>'0x'+h.toString(16)),crtThreadStartupImplemented:false,tlsCallbacksExecuted:false,staticTlsComponentModel:true};
  }finally{s.threadState=previous;}
 }
 release(){if(this.disposed)return;this.disposed=true;let first;try{this.scheduler?.dispose();}catch(error){first=error;}try{this.services?.releaseHeap();}catch(error){first??=error;}for(const p of this.allocations.splice(0)){try{this.e.free(p);}catch(error){first??=error;}}if(first)throw first;}
}



