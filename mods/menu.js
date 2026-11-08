/* Basic browser features. This does not load or impersonate upstream Geode mods. */
(() => {
 'use strict';
 if (window.WestminsterModMenu || new URLSearchParams(location.search).get('modmenu') === '0') return;
 const defaults = {clicks:false,release:true,volume:0.35,fps:false};
 let settings = {...defaults};
 try { const saved=JSON.parse(localStorage.getItem('westminster-mod-menu')||'{}'); for(const key of ['clicks','release','fps'])if(typeof saved[key]==='boolean')settings[key]=saved[key];if(Number.isFinite(saved.volume))settings.volume=Math.max(0,Math.min(1,saved.volume)); } catch {}
 const report=window.WestminsterModMenu={version:1,nativePackagesLoaded:false,clickSoundStarts:0,activeSongIds:[],storageReady:false,gameReady:false};
 let opened=false,dialog,launch,status,db,audio,noise,pendingOpen=false,busy=false;
 const held=new Set(),suppressed=new Set(),originals=new Map(),applied=new Map();
 let songs=[];
 const save=()=>{try{localStorage.setItem('westminster-mod-menu',JSON.stringify(settings));}catch{message('Settings could not be saved in this browser.');}};
 const editable=e=>e.target?.closest?.('input,textarea,select,[contenteditable="true"]');
 // Installed before the game's capture listener: menu keys never become game input.
 window.addEventListener('keydown',e=>{
  const toggle=e.code==='F2'||(!opened&&e.code==='Tab'&&!editable(e)&&!e.ctrlKey&&!e.altKey&&!e.metaKey);
  if(toggle||opened&&e.code==='Escape'){
   e.preventDefault();e.stopImmediatePropagation();suppressed.add(e.code);
   if(!e.repeat){if(dialog)setOpen(!opened);else pendingOpen=true;}return;
  }
  if(opened)e.stopImmediatePropagation();
 },true);
 window.addEventListener('keyup',e=>{if(opened||suppressed.has(e.code)){e.stopImmediatePropagation();if(suppressed.delete(e.code))e.preventDefault();}},true);
 const ready=()=>!!(window.__gdRuntimeReady&&window.__gdSavesRestored&&window.Module?.FS?.writeFile);
 function message(text){if(status)status.textContent=text;}
 function setOpen(value){
  if(value===opened)return;
  if(value){window.dispatchEvent(new Event('blur'));dialog.showModal();opened=true;}
  else{dialog.close();opened=false;document.getElementById('canvas')?.focus({preventScroll:true});}
  launch.setAttribute('aria-expanded',String(opened));
 }
 async function sound(release=false){
  try{
   const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)throw Error('Audio is unavailable in this browser.');
   audio ||= new Audio({latencyHint:'interactive'});if(audio.state==='suspended')await audio.resume();
   if(audio.state!=='running')throw Error('Press Test sound to enable audio.');
   if(!noise){noise=audio.createBuffer(1,Math.ceil(audio.sampleRate*0.035),audio.sampleRate);const data=noise.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*Math.exp(-i/(audio.sampleRate*0.004));}
   const t=audio.currentTime,source=audio.createBufferSource(),filter=audio.createBiquadFilter(),gain=audio.createGain();
   source.buffer=noise;filter.type='highpass';filter.frequency.value=release?2200:900;
   gain.gain.setValueAtTime(Math.max(0.0001,settings.volume*(release?0.45:0.8)),t);gain.gain.exponentialRampToValueAtTime(0.00001,t+0.035);
   source.connect(filter).connect(gain).connect(audio.destination);source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};source.start(t);report.clickSoundStarts++;
  }catch(error){message(error.message);}
 }
 const inputReady=()=>settings.clicks&&!opened&&window.__gdInputReady;
 window.addEventListener('keydown',e=>{if(!inputReady()||editable(e)||e.repeat||e.ctrlKey||e.altKey||e.metaKey||!['Space','ArrowUp','KeyW'].includes(e.code)||held.has(e.code))return;held.add(e.code);void sound();},true);
 window.addEventListener('keyup',e=>{if(held.delete(e.code)&&inputReady()&&settings.release)void sound(true);},true);
 window.addEventListener('pointerdown',e=>{if(inputReady()&&e.target?.id==='canvas'&&e.button===0){held.add('pointer:'+e.pointerId);void sound();}},true);
 window.addEventListener('pointerup',e=>{if(held.delete('pointer:'+e.pointerId)&&inputReady()&&settings.release)void sound(true);},true);
 window.addEventListener('pointercancel',e=>held.delete('pointer:'+e.pointerId),true);
 window.addEventListener('blur',()=>held.clear());
 document.addEventListener('visibilitychange',()=>{if(document.hidden)held.clear();});
 window.addEventListener('pagehide',()=>{db?.close();if(audio)void audio.close().catch(()=>{});},{once:true});
 function openStorage(){return new Promise((resolve,reject)=>{const request=indexedDB.open('westminster-browser-mods',1);request.onupgradeneeded=()=>request.result.createObjectStore('songs',{keyPath:'id'});request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('Close other game tabs to unlock song storage.'));request.onsuccess=()=>resolve(request.result);});}
 function stored(mode,operation){return new Promise((resolve,reject)=>{const tx=db.transaction('songs',mode);let request;try{request=operation(tx.objectStore('songs'));}catch(error){reject(error);return;}tx.oncomplete=()=>resolve(request?.result);tx.onerror=tx.onabort=()=>reject(tx.error||Error('Song storage failed.'));});}
 function install(song){
  if(!ready())return;
  const fs=window.Module.FS,path='/Resources/'+song.id+'.mp3';
  if(!originals.has(song.id))originals.set(song.id,fs.analyzePath(path).exists?fs.readFile(path).slice():null);
  fs.writeFile(path,new Uint8Array(song.bytes));applied.set(song.id,song);report.activeSongIds=[...applied.keys()];
 }
 function restore(song){
  if(!applied.has(song.id))return false;
  const fs=window.Module.FS,path='/Resources/'+song.id+'.mp3',current=fs.analyzePath(path).exists?fs.readFile(path):null,own=new Uint8Array(applied.get(song.id).bytes);
  const matches=current&&current.length===own.length&&current.every((v,i)=>v===own[i]);
  if(matches){const original=originals.get(song.id);if(original===null)fs.unlink(path);else fs.writeFile(path,original);}
  applied.delete(song.id);originals.delete(song.id);report.activeSongIds=[...applied.keys()];return !matches;
 }
 async function importSong(event){
  event.preventDefault();if(busy)return;
  const idText=document.getElementById('westSongId').value.trim(),file=document.getElementById('westSongFile').files[0];
  if(!/^[1-9]\d{0,9}$/.test(idText)||Number(idText)>2147483647){message('Enter a Newgrounds song ID from 1 to 2147483647.');return;}
  if(!file||!file.name.toLowerCase().endsWith('.mp3')||file.size===0||file.size>25*1024*1024){message('Choose a nonempty MP3, up to 25 MB.');return;}
  if(!db){message('Song storage is unavailable. Allow site storage and reload.');return;}
  busy=true;document.getElementById('westImportSong').disabled=true;
  try{
   const song={id:Number(idText),name:file.name,bytes:await file.arrayBuffer()};
   await stored('readwrite',s=>s.put(song));songs=songs.filter(s=>s.id!==song.id);songs.push(song);install(song);renderSongs();
   document.getElementById('westSongFile').value='';message(ready()?'Song installed. Restart the level to hear the replacement.':'Song saved. It will be installed when the game is ready.');
  }catch(error){message('Import failed: '+error.message);}finally{busy=false;document.getElementById('westImportSong').disabled=false;}
 }
 async function removeSong(song){
  if(busy)return;busy=true;
  try{
   await stored('readwrite',s=>s.delete(song.id));
   let changed;try{changed=restore(song);}catch(error){await stored('readwrite',s=>s.put(song));throw error;}
   songs=songs.filter(s=>s.id!==song.id);renderSongs();message(changed?'Replacement removed. A newer game file was preserved.':'Replacement removed. Restart the level to use the original song.');
  }catch(error){message('Could not remove song: '+error.message);}finally{busy=false;}
 }
 function renderSongs(){
  const list=document.getElementById('westSongList');if(!list)return;list.replaceChildren();
  if(!songs.length){const empty=document.createElement('p');empty.className='west-muted';empty.textContent='No replacements yet. Your imported songs stay in this browser.';list.append(empty);}
  for(const song of songs.slice().sort((a,b)=>a.id-b.id)){
   const row=document.createElement('div'),text=document.createElement('span'),name=document.createElement('strong'),detail=document.createElement('small'),remove=document.createElement('button');row.className='west-song';name.textContent=song.name;detail.textContent='Song '+song.id+' · '+(applied.has(song.id)?'Installed':'Saved · waiting for game');text.append(name,detail);remove.type='button';remove.textContent='Remove';remove.setAttribute('aria-label','Remove song '+song.id);remove.onclick=()=>void removeSong(song);row.append(text,remove);list.append(row);
  }
 }
 function mount(){
  const style=document.createElement('style');style.textContent=CSS;document.head.append(style);
  launch=document.createElement('button');launch.id='westModsButton';launch.type='button';launch.dataset.westUi='mods';launch.innerHTML='<span aria-hidden="true">✦</span> Mods <kbd>Tab</kbd>';launch.setAttribute('aria-expanded','false');launch.setAttribute('aria-controls','westModsDialog');launch.onclick=()=>setOpen(!opened);
  dialog=document.createElement('dialog');dialog.id='westModsDialog';dialog.dataset.westUi='mods';dialog.setAttribute('aria-labelledby','westModsTitle');
  dialog.innerHTML=HTML;document.body.append(launch,dialog);status=document.getElementById('westModsStatus');
  const fps=document.createElement('output');fps.id='westModsFps';fps.dataset.westUi='mods';fps.hidden=!settings.fps;document.body.append(fps);
  const tabs=[...dialog.querySelectorAll('[role=tab]')];
  function select(tab){for(const item of tabs){const active=item===tab;item.setAttribute('aria-selected',String(active));item.tabIndex=active?0:-1;document.getElementById(item.getAttribute('aria-controls')).hidden=!active;}}
  for(const tab of tabs){tab.onclick=()=>select(tab);tab.onkeydown=e=>{if(!['ArrowDown','ArrowUp','ArrowRight','ArrowLeft','Home','End'].includes(e.key))return;e.preventDefault();const i=e.key==='Home'?0:e.key==='End'?tabs.length-1:(tabs.indexOf(tab)+(e.key==='ArrowDown'||e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;select(tabs[i]);tabs[i].focus();};}
  document.getElementById('westModsClose').onclick=()=>setOpen(false);
  dialog.addEventListener('cancel',e=>{e.preventDefault();setOpen(false);});
  dialog.addEventListener('close',()=>{opened=false;launch.setAttribute('aria-expanded','false');});
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)setOpen(false);}});
  for(const kind of ['pointerdown','pointerup','click','wheel'])dialog.addEventListener(kind,e=>e.stopPropagation());
  document.getElementById('westClicks').checked=settings.clicks;document.getElementById('westRelease').checked=settings.release;document.getElementById('westVolume').value=Math.round(settings.volume*100);document.getElementById('westVolumeValue').value=Math.round(settings.volume*100)+'%';
  document.getElementById('westClicks').onchange=e=>{settings.clicks=e.target.checked;held.clear();save();if(settings.clicks)void sound();};
  document.getElementById('westRelease').onchange=e=>{settings.release=e.target.checked;save();};
  document.getElementById('westVolume').oninput=e=>{settings.volume=Number(e.target.value)/100;document.getElementById('westVolumeValue').value=e.target.value+'%';save();};
  document.getElementById('westTestSound').onclick=()=>void sound();
  document.getElementById('westSongForm').onsubmit=importSong;
  document.getElementById('westFpsToggle').checked=settings.fps;document.getElementById('westFpsToggle').onchange=e=>{settings.fps=e.target.checked;fps.hidden=!settings.fps;save();};
  document.getElementById('westFullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch(error){message('Fullscreen: '+error.message);}};
  document.getElementById('westSaveProgress').onclick=()=>{if(!window.__gdRuntimeReady){message('Wait for the game to load before saving.');return;}document.getElementById('saveBtn')?.click();message('Game save requested.');};
  const timer=setInterval(()=>{report.gameReady=ready();document.getElementById('westGameStatus').textContent=report.gameReady?'Game ready':'Game loading';if(settings.fps)fps.textContent=document.getElementById('fpsval')?.textContent||'— fps';if(report.gameReady&&db)for(const song of songs)if(!applied.has(song.id))try{install(song);renderSongs();}catch(error){message('Song installation failed: '+error.message);}},1000);
  window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
  renderSongs();void(async()=>{try{db=await openStorage();report.storageReady=true;songs=await stored('readonly',s=>s.getAll());if(ready())for(const song of songs)install(song);renderSongs();}catch(error){message('Song storage: '+error.message);}})();
  if(pendingOpen)setOpen(true);
 }
 const HTML=`
 <header class="west-head"><div><p class="west-eyebrow">WESTMINSTER DASH</p><h1 id="westModsTitle">Your game. Your setup.</h1></div><button id="westModsClose" type="button" aria-label="Close mod menu">✕</button></header>
 <p class="west-notice">Basic browser features are available below. The four original Geode mods are still being integrated.</p>
 <div class="west-layout"><nav role="tablist" aria-label="Mod sections" aria-orientation="vertical">
 <button role="tab" id="westTabClicks" aria-controls="westPanelClicks" aria-selected="true" tabindex="0"><span>01</span> Click Sounds</button>
 <button role="tab" id="westTabSongs" aria-controls="westPanelSongs" aria-selected="false" tabindex="-1"><span>02</span> Jukebox</button>
 <button role="tab" id="westTabQol" aria-controls="westPanelQol" aria-selected="false" tabindex="-1"><span>03</span> QOLMod</button>
 <button role="tab" id="westTabGlobed" aria-controls="westPanelGlobed" aria-selected="false" tabindex="-1"><span>04</span> Globed</button></nav>
 <main class="west-content">
 <section role="tabpanel" id="westPanelClicks" aria-labelledby="westTabClicks"><span class="west-badge">BASIC FEATURE</span><h2>Hear every press.</h2><p>Synthesized click feedback for Space, W, ↑ and taps on the game. This is input feedback; the original sound-pack system is not loaded.</p>
 <label class="west-row" for="westClicks"><span>Input click sounds<small>Play a short click on each press</small></span><input id="westClicks" type="checkbox" role="switch"></label>
 <label class="west-row" for="westRelease"><span>Release sounds<small>A lighter click when you let go</small></span><input id="westRelease" type="checkbox" role="switch"></label>
 <label class="west-volume" for="westVolume">Volume <output id="westVolumeValue">35%</output><input id="westVolume" type="range" min="0" max="100" value="35"></label><button class="west-primary" id="westTestSound" type="button">Test sound ↗</button></section>
 <section role="tabpanel" id="westPanelSongs" aria-labelledby="westTabSongs" hidden><span class="west-badge">MANUAL REPLACEMENTS</span><h2>Bring your own song.</h2><p>Import an MP3 against its Newgrounds song ID, then restart the level. Songs stay on this device. Index downloads are not connected yet.</p>
 <form id="westSongForm"><label for="westSongId">Newgrounds song ID</label><input id="westSongId" type="text" inputmode="numeric" placeholder="e.g. 123456" autocomplete="off" required><label for="westSongFile">Your MP3 · up to 25 MB</label><input id="westSongFile" type="file" accept=".mp3,audio/mpeg" required><button class="west-primary" id="westImportSong" type="submit">Import replacement ↗</button></form><div id="westSongList" aria-live="polite"></div></section>
 <section role="tabpanel" id="westPanelQol" aria-labelledby="westTabQol" hidden><span class="west-badge">BASIC CONTROLS</span><h2>A little more control.</h2><p>Browser conveniences you can use now. QOLMod's gameplay features are not integrated yet.</p><label class="west-row" for="westFpsToggle"><span>Show FPS<small>Keep the game's frame counter visible</small></span><input id="westFpsToggle" type="checkbox" role="switch"></label><div class="west-actions"><button id="westFullscreen" type="button">Toggle fullscreen</button><button id="westSaveProgress" type="button">Save game progress</button></div></section>
 <section role="tabpanel" id="westPanelGlobed" aria-labelledby="westTabGlobed" hidden><span class="west-badge west-pending">NOT CONNECTED</span><h2>Better together.</h2><p>Globed multiplayer still needs a working connection to its servers and synchronized players. No multiplayer session is active.</p><button type="button" disabled>Connect · not available yet</button></section>
 </main></div><footer><span id="westGameStatus">Game loading</span><span>Tab / F2 to open · Esc to close</span></footer><p id="westModsStatus" role="status" aria-live="polite"></p>`;
 const CSS=`
 #westModsButton,#westModsDialog,#westModsFps{font-family:system-ui,-apple-system,sans-serif;box-sizing:border-box;color:#e9edeb}#westModsButton{position:fixed;left:14px;top:14px;z-index:100020;display:flex;align-items:center;gap:9px;border:1px solid #404b43;border-radius:10px;padding:11px 14px;background:#141b18ed;font-size:14px;font-weight:650;cursor:pointer;box-shadow:0 5px 20px #0004}#westModsButton>span{color:#c8f589}#westModsButton kbd{font:10px system-ui;color:#a4afa7;border:1px solid #4b574e;border-radius:4px;padding:2px 4px}
 #westModsDialog{width:min(760px,calc(100vw - 28px));max-width:760px;max-height:calc(100dvh - 28px);margin:auto;padding:0;background:#141a18;border:1px solid #3a463e;border-radius:18px;box-shadow:0 30px 100px #0009;overflow:auto;line-height:1.5;font-size:14px}#westModsDialog::backdrop{background:#020806a8;backdrop-filter:blur(5px)}#westModsDialog *{box-sizing:border-box}#westModsDialog [hidden]{display:none!important}#westModsDialog button,#westModsDialog input{font:inherit}#westModsDialog button{border:1px solid #3b4940;border-radius:8px;padding:10px 13px;background:#222d26;color:#e8efe9;cursor:pointer}#westModsDialog button:hover{background:#303d33}#westModsDialog button:disabled{cursor:not-allowed;opacity:.5}#westModsDialog :focus-visible,#westModsButton:focus-visible{outline:2px solid #c8f589;outline-offset:3px}.west-head{display:flex;align-items:center;justify-content:space-between;padding:25px 27px 18px;gap:20px}.west-eyebrow{font-size:10px;letter-spacing:2.3px;color:#a6b4aa;margin:0 0 8px}#westModsDialog h1{font-size:23px;letter-spacing:-.7px;line-height:1.2;margin:0;font-weight:620}#westModsDialog #westModsClose{padding:6px 10px;background:transparent;color:#a6b4aa;font-size:18px}.west-notice{margin:0 27px 22px;padding:11px 13px;background:#202922;color:#aebfb2;font-size:12px;border-left:2px solid #a8cb83}.west-layout{display:grid;grid-template-columns:172px minmax(0,1fr);border-top:1px solid #2c3930}.west-layout nav{padding:16px 10px;background:#111713;border-right:1px solid #2c3930;display:flex;flex-direction:column;gap:6px}#westModsDialog [role=tab]{text-align:left;border-color:transparent;background:transparent;padding:12px 10px;white-space:nowrap;font-size:13px}#westModsDialog [role=tab] span{font-size:10px;color:#73887b;margin-right:9px}#westModsDialog [role=tab][aria-selected=true]{background:#2c392d;color:#d5f8ac;border-color:#46583e}.west-content{padding:27px;min-height:350px}.west-badge{display:inline-block;font-size:9px;font-weight:650;letter-spacing:1px;padding:4px 7px;border-radius:4px;color:#c4e6a1;background:#263222}.west-pending{background:#342d20;color:#d8c193}#westModsDialog h2{font-size:25px;letter-spacing:-.7px;font-weight:600;margin:13px 0 8px}#westModsDialog p{color:#a6b4aa}.west-content>section>p{font-size:12px;line-height:1.7;margin:0 0 20px}.west-row{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:15px 0;border-bottom:1px solid #2b3730;cursor:pointer}.west-row small{display:block;font-size:11px;color:#94a599;margin-top:3px}#westModsDialog input[type=checkbox]{width:19px;height:19px;accent-color:#b8ec80;flex-shrink:0;cursor:pointer}.west-volume{display:block;margin:20px 0;font-size:12px}.west-volume output{float:right;color:#c8f589}.west-volume input{width:100%;display:block;margin:13px 0;accent-color:#b8ec80}#westModsDialog .west-primary{background:#c1ef88;border-color:#c1ef88;color:#182514;font-weight:650}#westModsDialog .west-primary:hover{background:#d4ffa2}#westSongForm{display:flex;flex-direction:column;gap:8px}#westSongForm>label{font-size:11px;color:#aebfb2}#westSongForm input{max-width:100%;width:100%;min-width:0;border:1px solid #3a4c3f;border-radius:7px;background:#0f1611;color:#eef4ef;padding:10px;margin-bottom:6px}#westSongForm input[type=file]{font-size:11px;padding:9px}#westSongForm button{align-self:start;margin-top:5px}.west-song{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 0;border-bottom:1px solid #2b3730}.west-song>span{min-width:0}.west-song strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:270px;font-size:12px;font-weight:500}.west-song small{display:block;color:#94a599;font-size:10px;margin-top:4px}#westModsDialog .west-song button{font-size:10px;padding:6px 9px}.west-muted{font-size:11px}.west-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}#westModsDialog footer{display:flex;justify-content:space-between;gap:12px;padding:14px 27px;background:#101712;border-top:1px solid #2c3930;color:#83968a;font-size:10px}#westGameStatus{color:#c1dbac}#westModsStatus{font-size:11px;padding:0 27px;min-height:0}#westModsStatus:empty{display:none}#westModsFps{position:fixed;top:65px;left:16px;z-index:100019;border-radius:5px;background:#0b120dd9;padding:5px 8px;font-size:11px;pointer-events:none}#westModsFps[hidden]{display:none}
 @media(max-width:600px){#westModsDialog{width:calc(100vw - 16px);max-height:calc(100dvh - 16px);border-radius:12px}.west-head{padding:20px 18px 16px}#westModsDialog h1{font-size:20px}.west-notice{margin:0 18px 16px}.west-layout{display:block}.west-layout nav{flex-direction:row;overflow:auto;border-right:0;border-bottom:1px solid #2c3930;padding:8px;gap:3px}#westModsDialog [role=tab]{font-size:11px;padding:9px 8px}#westModsDialog [role=tab] span{display:none}.west-content{padding:21px 18px;min-height:310px}#westModsDialog footer{padding:12px 18px;font-size:9px;flex-wrap:wrap}.west-song strong{max-width:180px}}`;
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
