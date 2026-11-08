// Actual pinned game/prologue in Chromium; no mocked game services.
const {chromium}=require('playwright');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage({viewport:{width:1280,height:720}}),events=[];
 page.on('pageerror',e=>events.push(String(e)));
 page.on('console',m=>{if(m.type()==='error')events.push(m.text().slice(0,800));});
 const started=Date.now();
 const setup=process.env.GEODE_DEFERRED==='1',capture=process.env.GEODE_CAPTURE_HEADERS==='1',expected=setup?'LIVE_SETUP_SERVICE_BOUNDARY_PASS':'LIVE_DLL_MAPPING_PROLOGUE_PASS';
 try{
  await page.addInitScript(()=>{const instantiate=WebAssembly.instantiate;WebAssembly.instantiate=async function(...args){const out=await instantiate.apply(this,args),e=(out.instance||out).exports;if(e?.gd_frames_get&&e.memory)window.__testGameMemory=e.memory;return out;};window.WestminsterGeodeDllBytes=fetch('/integration-input/Geode.dll').then(r=>{if(!r.ok)throw Error('Fixture DLL HTTP '+r.status);return r.arrayBuffer();});});
  await page.goto('http://127.0.0.1:8765/experiments/geode-binary/handoff/?quality=low&geodemap=1'+(setup?'&geodesetup=1':''),{timeout:60000,waitUntil:'domcontentloaded'});
  await page.waitForFunction(expected=>{
   const r=window.WestminsterHandoffReport;
   if(r?.status==='HANDOFF_STOPPED')throw Error(r.error);
   return r?.status===expected&&r.gameFrames>=120;
  },expected,{timeout:360000});
  const result=await page.evaluate(()=>{
   const r=JSON.parse(JSON.stringify(window.WestminsterHandoffReport)),images=[];
   for(const name of ['GeometryDash.exe.img','libcocos2d.dll.img','libExtensions.dll.img']){
    try{
     const b=Module.FS.readFile('/Resources/bin/'+name),v=new DataView(b.buffer,b.byteOffset,b.byteLength);
     const item={name,bytes:b.length,headerHex:Array.from(b.subarray(0,64),x=>x.toString(16).padStart(2,'0')).join('')};
     if(v.getUint16(0,true)===0x5a4d){const pe=v.getUint32(0x3c,true);if(v.getUint32(pe,true)===0x4550){item.imageBase='0x'+v.getBigUint64(pe+48,true).toString(16);item.imageSize=v.getUint32(pe+80,true);}}
     images.push(item);
    }catch(e){images.push({name,error:String(e)});}
   }
   return {report:r,images,jspi:typeof WebAssembly.Suspending==='function'};
  });
  if(!result.report.originalGameCpuPreserved||!result.report.liveStackRestored||!result.report.dllMappedIntoLiveGame||!result.report.dllReservation.active)throw Error('DLL mapping or CPU/stack preservation failed');
  if(setup){const w=result.report.worker;if(!w||w.status!=='WORKER_CALLBACK_BOUNDARY_PASS'||w.instructions<=1709||w.id!==2||!w.rootCpuPreserved||!w.rootCpuRetained||!w.contextRetained||w.threadCreationImplemented!==false||w.crtThreadStartupImplemented!==false)throw Error('Actual worker callback or retained context validation failed');if(w.performanceClock?.frequency!=='10000000'||!w.executedServices.includes('QueryPerformanceFrequency'))throw Error('Live performance clock validation failed');if(!w.executedServices.includes('_Mtx_lock')||!w.mutexes?.length)throw Error('Actual worker MSVC mutex validation failed');if(!w.executedServices.includes('GetQueuedCompletionStatusEx')||!w.batchPolls?.some(p=>p.capacity===64&&p.removed===0&&p.error===258&&p.timeoutMs===0&&p.alertable===0))throw Error('Actual nonblocking batch poll validation failed');}
  if(capture){
   const headers=await page.evaluate(()=>{const base=0x400000,memory=window.__testGameMemory,b=new Uint8Array(memory.buffer,base,4096),v=new DataView(b.buffer,b.byteOffset,b.byteLength);if(v.getUint16(0,true)!==0x5a4d)throw Error('Live game DOS header missing');const pe=v.getUint32(0x3c,true);if(pe>3500||v.getUint32(pe,true)!==0x4550)throw Error('Live game PE header missing');return {base,imageSize:v.getUint32(pe+80,true),gameWasmSha256:window.WestminsterHandoffReport.gameModuleSha256,hex:Array.from(b,x=>x.toString(16).padStart(2,'0')).join('')};});
   fs.writeFileSync('integration-input/game-headers.json',JSON.stringify(headers,null,2));console.log('GAME_HEADERS_FIXTURE '+JSON.stringify(headers));
   const cocos=await page.evaluate(async()=>{const {inspectCocos}=await import(location.origin+'/experiments/geode-binary/game-imports.mjs');return {...inspectCocos(window.__testGameMemory,Module.FS),gameWasmSha256:window.WestminsterHandoffReport.gameModuleSha256};});
   fs.writeFileSync('integration-input/cocos-binding.json',JSON.stringify(cocos,null,2));console.log('COCOS_BINDING_FIXTURE '+JSON.stringify(cocos));
  }
  fs.writeFileSync('browser-result.json',JSON.stringify({...result,seconds:(Date.now()-started)/1000,events},null,2));
  console.log(JSON.stringify(result,null,2));
 }catch(error){
  const state=await page.evaluate(()=>({report:window.WestminsterHandoffReport,errorOverlay:document.getElementById('errOverlay')?.textContent,body:document.body.innerText.slice(-3000)})).catch(()=>({}));
  fs.writeFileSync('browser-result.json',JSON.stringify({error:String(error),state,events,seconds:(Date.now()-started)/1000},null,2));
  console.error(error,state,events.slice(-8));process.exitCode=1;
 }finally{await browser.close();}
})();
