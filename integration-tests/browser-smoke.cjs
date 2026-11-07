// Actual pinned game/prologue in Chromium; no mocked game services.
const {chromium}=require('playwright');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage({viewport:{width:1280,height:720}}),events=[];
 page.on('pageerror',e=>events.push(String(e)));
 page.on('console',m=>{if(m.type()==='error')events.push(m.text().slice(0,800));});
 const started=Date.now();
 try{
  await page.goto('http://127.0.0.1:8765/experiments/geode-binary/handoff/?quality=low',{timeout:60000,waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>{
   const r=window.WestminsterHandoffReport;
   if(r?.status==='HANDOFF_STOPPED')throw Error(r.error);
   return r?.status==='LIVE_CALLBACK_PROLOGUE_PASS'&&r.gameFrames>=120;
  },{},{timeout:360000});
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
  if(!result.report.originalGameCpuPreserved||!result.report.liveStackRestored)throw Error('CPU/stack preservation failed');
  fs.writeFileSync('browser-result.json',JSON.stringify({...result,seconds:(Date.now()-started)/1000,events},null,2));
  console.log(JSON.stringify(result,null,2));
 }catch(error){
  const state=await page.evaluate(()=>({report:window.WestminsterHandoffReport,errorOverlay:document.getElementById('errOverlay')?.textContent,body:document.body.innerText.slice(-3000)})).catch(()=>({}));
  fs.writeFileSync('browser-result.json',JSON.stringify({error:String(error),state,events,seconds:(Date.now()-started)/1000},null,2));
  console.error(error,state,events.slice(-8));process.exitCode=1;
 }finally{await browser.close();}
})();
