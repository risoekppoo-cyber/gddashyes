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
     nextArguments:[8,16,64,72].map(o=>'0x'+state.getBigUint64(shadow+o,true).toString(16))};
   }
   this.services.invoke(shadow,state.getBigUint64(shadow+192,true));pc=new DataView(e.memory.buffer).getBigUint64(shadow+192,true);
  }
  throw Error('Setup transfer limit');
 }
 runWorker(rootCpu,imageBase,request,compilerTop){
  const {e,metadata:m}=this,w=m.worker,s=this.services;
  if(this.scheduler||!request||request.entryRva!==w.entryRva||request.security!=='0x0'||request.stackSize!==0||request.initFlags!==0)throw Error('Unverified worker call profile');
  this.scheduler=new this.serviceTypes.GuestScheduler(s,{quantum:20000,firstId:2});
  const before=new Uint8Array(e.memory.buffer,rootCpu,4096).slice(),oldCalls=s.calls.length,parentStack=new Uint8Array(e.memory.buffer,this.stack,65536).slice(),parentTib=new Uint8Array(e.memory.buffer,this.tib,65536).slice();
  const thread=this.scheduler.createContext({entry:BigInt(imageBase+w.entryRva),argument:BigInt(request.argument),returnAddress:BigInt(this.tib+0xeff0),tlsTemplate:new Uint8Array(e.memory.buffer,imageBase+m.tls.templateRva,m.tls.templateSize),tlsZeroFill:m.tls.zeroFill});
  const stop=w.stopService?BigInt(s.addresses[w.stopService]):BigInt(imageBase+w.stopRva);
  this.aux.exports.__stack_pointer.value=compilerTop;let completed=false;
  this.scheduler.runRound((thread,budget)=>{
   let pc=BigInt(imageBase+w.entryRva),steps=0;
   for(let transfers=0;transfers<1000;transfers++){
    if(steps>=budget)throw Error('Worker instruction quantum exhausted');
    const r=this.aux.exports.lift_run(thread.cpu,pc,BigInt(imageBase),0,stop,budget-steps)>>>0;steps+=r&0x7fffffff;
    const v=new DataView(e.memory.buffer);
    if(!(r&0x80000000)){if(steps!==w.steps||v.getBigUint64(thread.cpu+192,true)!==stop)throw Error('Unexpected worker boundary');completed=true;break;}
    s.invoke(thread.cpu,v.getBigUint64(thread.cpu+192,true));pc=new DataView(e.memory.buffer).getBigUint64(thread.cpu+192,true);
   }
   if(!completed)throw Error('Worker transfer budget exhausted');return {steps,state:'blocked',waitKey:'verified-worker-boundary'};
  });
  for(const [snapshot,pointer] of [[before,rootCpu],[parentStack,this.stack],[parentTib,this.tib]])if(!snapshot.every((b,i)=>new Uint8Array(e.memory.buffer)[pointer+i]===b))throw Error('Worker changed parent CPU/stack/TIB');
  // Keep an owned parent snapshot: the handoff frees its temporary CPU shadow.
  this.savedRoot=Number(s.allocate(4096n));if(!this.savedRoot)throw Error('Could not retain parent CPU');new Uint8Array(e.memory.buffer,this.savedRoot,4096).set(before);
  return {status:'WORKER_CALLBACK_BOUNDARY_PASS',id:thread.id,entryRva:w.entryRva,instructions:thread.steps,nextRequiredService:w.nextService,nextBoundaryKind:w.nextBoundaryKind,rootCpuPreserved:true,rootCpuRetained:true,contextRetained:true,threadCreationImplemented:false,crtThreadStartupImplemented:false,executedServices:s.calls.slice(oldCalls)};
 }
 release(){let first;try{this.scheduler?.dispose();}catch(error){first=error;}try{this.services?.releaseHeap();}catch(error){first??=error;}for(const p of this.allocations.splice(0)){try{this.e.free(p);}catch(error){first??=error;}}if(first)throw first;}
}
