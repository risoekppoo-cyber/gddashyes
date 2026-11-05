/* Opt-in full-game experiment. No code runs for the normal game URL. */
(function(root) {
  'use strict';
  if(new URLSearchParams(location.search).get('sdkmenu')!=='1')return;
  const base=new URL('.',document.currentScript.src);
  const prototype=root.GDHookPrototype;
  if(!prototype)throw Error('Missing pinned game hook bridge');
  prototype.enabled=true;
  const report={status:'PREPARING',sdkSubset:true,fullGeodeLoader:false,existingGeodePackagesSupported:false,
    fullGameBootTested:false,menuLabelTested:false,menuLabelVisibleConfirmed:false,browser:navigator.userAgent,entries:0,bodyReturns:0};
  let gameExports;
  root.WestminsterSdkReport=report;
  const panel=document.createElement('details');
  panel.dataset.westUi='sdk-menu';
  panel.style.cssText='position:fixed;right:10px;top:10px;z-index:100002;max-width:min(420px,90vw);background:#0a1829ef;color:#d7ffe5;border:1px solid #487b65;border-radius:9px;padding:8px 12px;font:12px system-ui';
  const summary=document.createElement('summary');summary.textContent='Geode SDK subset: preparing…';
  const pre=document.createElement('pre');pre.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;max-height:55vh;overflow:auto';
  const copy=document.createElement('button');copy.textContent='Copy report';
  copy.addEventListener('click',()=>navigator.clipboard.writeText(JSON.stringify(report,null,2)));
  const confirm=document.createElement('button');confirm.textContent='I can see the menu label';confirm.hidden=true;
  confirm.addEventListener('click',()=>{report.menuLabelVisibleConfirmed=true;report.gameFrames=gameExports?.gd_frames_get?.()||0;
    report.fullGameBootTested=report.gameFrames>0;report.gameplayTested=false;update();confirm.hidden=true;});
  panel.append(summary,pre,copy,confirm);document.body.append(panel);
  const update=()=>{pre.textContent=JSON.stringify(report,null,2);};
  const fail=error=>{report.status='FAIL';report.error=error.stack||String(error);summary.textContent='SDK menu test stopped — expand for report';update();};
  prototype.instantiate=async function(response,imports) {
    try {
      summary.textContent='SDK menu test: loading compiled mod…';
      const [{default:createEngine},{GuestApi,MenuCompletion},pluginResponse,bytes]=await Promise.all([
        import(new URL('dist/engine.mjs',base).href),import(new URL('guest-api.mjs',base).href),
        fetch(new URL('dist/menu-mod.wasm',base)),response.arrayBuffer()
      ]);
      if(!pluginResponse.ok)throw Error('SDK plugin download failed');
      const prepared=await prototype.patch(bytes);
      const out=await WebAssembly.instantiate(prepared.bytes,imports),e=out.instance.exports;
      gameExports=e;
      const runtime=await createEngine(),completion=new MenuCompletion(e.memory);
      let guestApi;
      const labels=new Set();
      runtime.bridge={
        original:(address,cpu)=>e[address===0x8720c0?'westminster_original_menu':'westminster_original_leaf'](cpu),
        readRax:cpu=>Number(new DataView(e.memory.buffer).getBigUint64(cpu,true)),
        writeRax:(cpu,value)=>new DataView(e.memory.buffer).setBigUint64(cpu,BigInt(value),true),
        menuCompleted:cpu=>completion.finished(cpu),
        label(cpu,text) {
          const menu=completion.take(cpu);
          if(menu===undefined||labels.has(menu.toString()))return;
          labels.add(menu.toString());
          // Run after the original menu call has left the hook stack.
          queueMicrotask(()=>{
            try {
              guestApi ||= new GuestApi(e);
              const result=guestApi.addLabel(menu,text);
              report.status='NATIVE_LABEL_ATTACHED';report.menuLabelTested=true;
              report.menuNativeInitCompleted=true;report.label=result;
              summary.textContent='SDK mod: native menu label attached';confirm.hidden=false;update();
            } catch(error) {fail(error);}
          });
        }
      };
      if(runtime._ws_init()!==1)throw Error('SDK hook engine initialization failed');
      runtime.FS.writeFile('/menu-mod.wasm',new Uint8Array(await pluginResponse.arrayBuffer()));
      if(runtime.ccall('ws_load_mod','number',['string'],['/menu-mod.wasm'])!==1)
        throw Error(runtime.ccall('ws_error','string',[],[])||'SDK mod entry failed');
      report.sdkSubsetModLoaded=true;
      // Initialize unmodified originals in both new slots before installing SDK dispatch.
      await prototype.install(out.instance,prepared.targets);
      const menu=prepared.targets.find(t=>t.id==='menu');
      const wrapper=await WebAssembly.instantiate(prototype.bridgeBytes(),{hook:{
        before(cpu){report.entries++;completion.before(cpu);},
        original:cpu=>runtime._ws_next(menu.address,cpu),
        after(){report.bodyReturns++;if(report.bodyReturns%50===0)update();}
      }});
      e.__indirect_function_table.set(menu.slot,wrapper.instance.exports.run);
      report.status='WAITING_FOR_MENU';summary.textContent='SDK mod loaded · waiting for native menu return…';update();
      // Even successful native object attachment needs the user's visual/gameplay check.
      return out;
    } catch(error){fail(error);throw error;}
  };
})(globalThis);
