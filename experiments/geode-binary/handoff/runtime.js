/* Opt-in real-game startup handoff with bounded, verified DLL continuation. */
(function(root){'use strict';
 if(new URLSearchParams(location.search).get('geodehandoff')!=='1')return;
 const base=new URL('.',document.currentScript.src),prototype=root.GDHookPrototype;
 if(!prototype)throw Error('Missing pinned game bridge');prototype.enabled=true;
 const report={status:'PREPARING',fullGeodeLoader:false,existingGeodePackagesSupported:false,dllMappedIntoLiveGame:false,deferredLoaderInitialized:false,callbackPrologueExecuted:false,callbackPrologueOnly:true,gameFrames:0,browser:navigator.userAgent};root.WestminsterHandoffReport=report;
 const panel=document.createElement('details');panel.open=true;panel.style.cssText='position:fixed;right:10px;top:10px;z-index:100010;max-width:min(440px,90vw);background:#0a1829ed;color:#e4ffdc;padding:10px;border:1px solid #79a659;border-radius:9px;font:12px system-ui';
 const title=document.createElement('summary'),pre=document.createElement('pre'),copy=document.createElement('button');pre.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;max-height:50vh;overflow:auto';copy.textContent='Copy report';copy.onclick=()=>navigator.clipboard.writeText(JSON.stringify(report,null,2));panel.append(title,pre,copy);document.body.append(panel);
 const update=()=>{title.textContent=report.status;pre.textContent=JSON.stringify(report,null,2);};const fail=e=>{report.status='HANDOFF_STOPPED';report.error=e?.stack||String(e);update();};update();
 prototype.instantiate=async function(response,imports){try{
  const [m,bytes,prologue,helper]=await Promise.all([fetch(new URL('manifest.json',base)).then(r=>{if(!r.ok)throw Error('Manifest HTTP '+r.status);return r.json();}),response.arrayBuffer(),fetch(new URL('prologue.wasm',base)).then(r=>{if(!r.ok)throw Error('Prologue HTTP '+r.status);return r.arrayBuffer();}),import(new URL('startup-module.mjs',base).href)]);
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',prologue)),b=>b.toString(16).padStart(2,'0')).join('');if(digest!==m.prologueSha256)throw Error('Compiled callback prologue hash mismatch');
  report.sourceDllSha256=m.dllSha256;report.gameModuleSha256=m.gameSha256;
  if(prototype.TARGETS.some(t=>t.id==='startup'))throw Error('Duplicate startup hook');prototype.TARGETS.push({...m.gameTarget,name:'Geode deferred startup target'});
  const prepared=await prototype.patch(bytes),out=await WebAssembly.instantiate(prepared.bytes,imports),e=out.instance.exports,aux=await helper.instantiateStartupLift(prologue,e.memory);
  const mapRequested=new URLSearchParams(location.search).get('geodemap')==='1';
  const setupRequested=new URLSearchParams(location.search).get('geodesetup')==='1';
  if(setupRequested&&!mapRequested)throw Error('Setup requires the owned DLL mapping');
  const setupContext=setupRequested?await (await import(new URL('../setup-context.mjs?rev=setup-cocos-20261107',base).href)).loadSetup(e,helper,base):null;
  let mapHelper,preparedImage,mappedImage;
  if(mapRequested){
   if(!root.WestminsterGeodeDllBytes)throw Error('Select the pinned DLL on the mapped check page first');
   mapHelper=await import(new URL('../owned-image.mjs?rev=setup-cocos-20261107',base).href);
   preparedImage=await mapHelper.prepareGeodeImage(await root.WestminsterGeodeDllBytes);
  }
  let observed=false;
  await prototype.install(out.instance,prepared.targets,{before(target,cpu){if(target.id!=='startup'||observed)return;
   const initial=new DataView(e.memory.buffer),resume=initial.getUint32(346324656,true);if(resume&&resume!==m.gameTarget.address)return;observed=true;
   let saved,stackLinear,shadow=0,compiler=0,succeeded=false,failed=false,firstError;
   const remember=error=>{if(!failed){failed=true;firstError=error;}};
   try{
    const guestBase=initial.getUint32(346225600,true),sp=initial.getBigUint64(cpu+32,true);if(sp<512n||sp>0xffffffffn)throw Error('Unsupported live stack pointer');stackLinear=guestBase+Number(sp)-512;
    if(stackLinear<0||stackLinear+544>e.memory.buffer.byteLength)throw Error('Live stack bounds');
    let imageBase=0x2000000;
    if(mapRequested){
     if(setupContext)setupContext.reserve();
     mappedImage=mapHelper.mapOwnedGeodeImage(preparedImage,e,guestBase,[[cpu,cpu+208],[stackLinear,stackLinear+544]],setupContext?item=>setupContext.resolveImport(item):undefined);
     imageBase=mappedImage.image.imageBase;
     report.dllMappedIntoLiveGame=true;report.dllReservation=mappedImage.reservation;
     report.unresolvedImportCount=mappedImage.image.unresolvedImports.length;
     report.dllRelocations=mappedImage.image.relocationCount;
     root.addEventListener('pagehide',()=>{try{mappedImage.release();report.dllReservation.active=false;}finally{setupContext?.release();}},{once:true});
    }
    shadow=e.malloc(4096);compiler=e.malloc(65536);if(!shadow||!compiler)throw Error('Could not reserve isolated translator state');
    if([[shadow,4096],[compiler,65536]].some(([p,n])=>p<stackLinear+544&&p+n>stackLinear))throw Error('Translator allocation overlaps live stack');
    report.memoryLayout={memoryBytes:e.memory.buffer.byteLength,guestBase,cpuLinear:cpu,cpuSnapshotBytes:208,stackWindowLinear:[stackLinear,stackLinear+544],shadowLinear:[shadow,shadow+4096],compilerLinear:[compiler,compiler+65536],guestReservationVerified:false};
    const v=new DataView(e.memory.buffer);saved=new Uint8Array(e.memory.buffer,stackLinear,544).slice();const cpuBefore=new Uint8Array(e.memory.buffer,cpu,208).slice();new Uint8Array(e.memory.buffer,shadow,4096).fill(0);new Uint8Array(e.memory.buffer,shadow,128).set(cpuBefore.subarray(0,128));
    for(const [from,to] of [[160,2560],[162,2562],[164,2564],[166,2566],[167,2567],[171,2571]])v.setUint8(shadow+to,v.getUint8(cpu+from));
    if(!(aux.exports.__stack_pointer instanceof WebAssembly.Global))throw Error('Missing isolated compiler stack');aux.exports.__stack_pointer.value=(compiler+65536)&~15;
    const entry=BigInt(imageBase+m.entry-0x2000000),stop=BigInt(imageBase+m.stop-0x2000000);
    if(mapRequested){const code=new Uint8Array(e.memory.buffer,guestBase+Number(entry),m.nativeBytesHex.length/2);if(Array.from(code,x=>x.toString(16).padStart(2,'0')).join('')!==m.nativeBytesHex)throw Error('Mapped callback instruction bytes mismatch');}
    let setupResult;
    if(setupContext)setupResult=setupContext.run(shadow,imageBase,Number(sp),(compiler+65536)&~15);
    else{
     const result=aux.exports.lift_run(shadow,entry,BigInt(imageBase),guestBase,stop,32)>>>0;
     if((result&0x7fffffff)!==14||v.getBigUint64(shadow+192,true)!==stop)throw Error('Deferred prologue did not stop before its first call');
    }
    report.callbackPrologueExecuted=true;report.instructions=14;report.stoppedBeforeFirstCall=true;report.liveGuestBase='0x'+guestBase.toString(16);report.liveStack='0x'+sp.toString(16);report.gameStartupTarget='0x'+m.gameTarget.address.toString(16);report.callbackStop='0x'+stop.toString(16);report.arguments=[8,16,64,72].map(o=>'0x'+v.getBigUint64(cpu+o,true).toString(16));report.sharedGameMemory=true;
    if(setupResult){report.instructions=setupResult.steps;report.stoppedBeforeFirstCall=false;report.callbackPrologueOnly=false;report.callbackStop='0x'+setupResult.stop.toString(16);report.nextRequiredService=setupResult.service;report.nextBoundaryKind=setupContext.metadata.nextBoundaryKind||'service-call';report.nextServiceArguments=setupResult.nextArguments;report.executedServices=setupResult.calls;report.staticTlsTemplateInitialized=true;report.tlsCallbacksExecuted=false;report.crtOnexitTablesInitialized=true;report.pendingExitCallbacks=setupResult.onexitCallbacks;report.bootstrapGameTimestamp=setupContext.metadata.bootstrap.gameTimestamp;report.loaderDiagnostic=setupResult.dialog;report.isolatedSetupStack='0x'+setupResult.isolatedStack.toString(16);}
    if(setupResult&&setupContext.cocos){const c=setupContext.cocos;report.boundGameImports=[{dll:c.dll,name:c.name,address:'0x'+c.address.toString(16),moduleBase:'0x'+c.base.toString(16)}];}
    if(setupResult?.threadNames?.length){report.guestThreadNames=setupResult.threadNames;report.threadNameNotificationHandled=true;}
    if(setupResult?.pipeRequest)report.pendingPipeRequest=setupResult.pipeRequest;
    if(setupResult?.stdioState)report.guestStdioDescriptors=setupResult.stdioState.fds;
    if(!cpuBefore.every((b,i)=>new Uint8Array(e.memory.buffer)[cpu+i]===b))throw Error('Original game CPU changed');report.originalGameCpuPreserved=true;
    succeeded=true;
   }catch(error){remember(error);}finally{
    try{if(saved){new Uint8Array(e.memory.buffer,stackLinear,saved.length).set(saved);report.liveStackRestored=saved.every((b,i)=>new Uint8Array(e.memory.buffer)[stackLinear+i]===b);if(!report.liveStackRestored)throw Error('Live stack restoration mismatch');}}
    catch(error){remember(error);}
    for(const ptr of [shadow,compiler])if(ptr){try{if(typeof e.free!=='function')throw Error('Missing game allocator free');e.free(ptr);}catch(error){remember(error);}}
    if(succeeded&&!failed&&report.liveStackRestored!==true)remember(Error('Live stack not restored'));
    if(failed&&mappedImage){try{mappedImage.release();report.dllReservation.active=false;report.dllMappedIntoLiveGame=false;}catch(error){remember(error);}}
    if(failed&&setupContext){try{setupContext.release();}catch(error){remember(error);}}
    if(failed)fail(firstError);
    else if(succeeded)report.status=setupRequested?'LIVE_SETUP_SERVICE_BOUNDARY_PASS':mapRequested?'LIVE_DLL_MAPPING_PROLOGUE_PASS':'LIVE_CALLBACK_PROLOGUE_PASS';
    update();
   }
  }});
  if(report.status==='PREPARING'){report.status='WAITING_FOR_REAL_GAME_STARTUP';update();}
  const interval=setInterval(()=>{report.gameFrames=e.gd_frames_get?.()??0;if(report.gameFrames>0){report.gameContinuedAfterHandoff=true;update();if(report.gameFrames>120)clearInterval(interval);}},1000);
  return out;
 }catch(error){fail(error);throw error;}};
})(globalThis);
