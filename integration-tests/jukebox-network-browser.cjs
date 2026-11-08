// Checks the ORIGINAL configured endpoints and response formats. No menu,
// replacement catalog, mock server, authentication bypass or mod-success flag.
const {chromium}=require('playwright');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true});const page=await browser.newPage();
 let report;
 try{
  await page.route('http://127.0.0.1:8765/__jukebox_probe',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Jukebox network prerequisite probe</title>'}));
  await page.goto('http://127.0.0.1:8765/__jukebox_probe');
  report=await page.evaluate(async()=>{
   const result={status:'RUNNING',originalModLoaded:false,originalUIExecuted:false,cppWebCallbacksConnected:false,indexes:[],downloads:[]};
   const get=async(url,headers={},max=32*1024*1024)=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
    try{
     const r=await fetch(url,{mode:'cors',credentials:'omit',cache:'no-store',headers,signal:controller.signal});
     const meta={url,code:r.status,etag:r.headers.get('etag'),lastModified:r.headers.get('Last-Modified'),type:r.headers.get('Content-Type'),length:r.headers.get('Content-Length')};
     if(r.status===304)return {...meta,bytes:new Uint8Array()};
     if(!r.ok)throw Error('HTTP '+r.status+' from '+new URL(url).host);
     const reader=r.body.getReader(),chunks=[];let length=0;
     try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>max)throw Error('Response exceeds bounded probe limit');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
     const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
     return {...meta,bytes};
    }finally{clearTimeout(timer);controller.abort();}
   };
   try{
    const manifestURL='https://raw.githubusercontent.com/Fleeym/jukebox/abb0b3c9f87336acb594278de5b25525d9177dcf/mod.json';
    const manifest=JSON.parse(new TextDecoder().decode((await get(manifestURL)).bytes));
    if(manifest.id!=='fleym.nongd')throw Error('Unexpected upstream manifest');
    result.sourceCommit='abb0b3c9f87336acb594278de5b25525d9177dcf';result.defaultSources=manifest.settings.indexes.default;
    let samples=[];
    for(const source of result.defaultSources){
     if(!source.enabled)continue;
     const fetched=await get(source.url),data=JSON.parse(new TextDecoder().decode(fetched.bytes));
     if(data.manifest!==1||typeof data.id!=='string'||typeof data.name!=='string'||!data.nongs?.hosted)throw Error('Original index schema is unsupported');
     const hosted=Object.entries(data.nongs.hosted),youtube=Object.keys(data.nongs.youtube||{});
     const item={url:source.url,id:data.id,name:data.name,manifest:data.manifest,bytes:fetched.bytes.length,hosted:hosted.length,youtube:youtube.length,etag:fetched.etag,lastModified:fetched.lastModified};
     const conditional={};if(fetched.etag)conditional['If-None-Match']=fetched.etag;if(fetched.lastModified)conditional['If-Modified-Since']=fetched.lastModified;
     if(Object.keys(conditional).length){const cached=await get(source.url,conditional);item.conditionalCode=cached.code;}
     else item.conditionalHeadersExposed=false;
     result.indexes.push(item);
     const eligible=hosted.filter(([,s])=>typeof s.url==='string'&&s.url.startsWith('https://'));
     for(const i of [0,Math.floor(eligible.length/2),eligible.length-1])if(eligible[i]&&!samples.some(s=>s.url===eligible[i][1].url))samples.push({indexID:data.id,uniqueID:eligible[i][0],...eligible[i][1]});
    }
    for(const song of samples.slice(0,3)){
     const record={host:new URL(song.url).host,indexID:song.indexID,uniqueID:song.uniqueID,songIDs:song.songs,startOffset:song.startOffset??0};
     try{
      const response=await get(song.url),bytes=response.bytes;
      record.code=response.code;record.bytes=bytes.length;record.sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
      const decoder=new OfflineAudioContext(2,1,44100),audio=await decoder.decodeAudioData(bytes.buffer);
      record.duration=audio.duration;record.channels=audio.numberOfChannels;record.sampleRate=audio.sampleRate;
      if(audio.duration<=0)throw Error('Empty decoded audio');record.complete=true;
     }catch(error){record.complete=false;record.error=String(error);}
     result.downloads.push(record);if(record.complete)break;
    }
    if(!result.downloads.some(d=>d.complete))throw Error('No sampled original hosted song could be downloaded and decoded');
    result.status='ORIGINAL_JUKEBOX_BROWSER_NETWORK_PASS';
   }catch(error){result.status='NETWORK_PREREQUISITE_BLOCKED';result.error=String(error);}
   return result;
  });
  fs.writeFileSync('jukebox-network-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  if(report.status!=='ORIGINAL_JUKEBOX_BROWSER_NETWORK_PASS')process.exitCode=1;
 }catch(error){fs.writeFileSync('jukebox-network-result.json',JSON.stringify({status:'FAIL',error:String(error),report},null,2));console.error(error);process.exitCode=1;}finally{await browser.close();}
})();
