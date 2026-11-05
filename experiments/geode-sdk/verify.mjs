import createEngine from './dist/engine.mjs';
import {GuestApi, COCOS, MenuCompletion} from './guest-api.mjs';
export async function verifySdk(bytes, prototype, pluginBytes, progress = () => {}) {
  const check = (ok, message) => {if (!ok) throw Error(message);};
  progress('Compiling the pinned game');
  const prepared = await prototype.patch(bytes), compiled = await WebAssembly.compile(prepared.bytes);
  const imports = {};let e;
  for (const i of WebAssembly.Module.imports(compiled)) (imports[i.module] ||= {})[i.name] =
    i.name==='emscripten_asm_const_int' ? code => {if(code===346202866)return 0;throw Error('Unexpected inline host call '+code);} :
    i.name==='fd_write' ? (fd,iovs,count,written) => {
      const v=new DataView(e.memory.buffer);let n=0;
      for(let j=0;j<count;j++)n+=v.getUint32(iovs+j*8+4,true);
      v.setUint32(written,n,true);return 0;
    } : () => {throw Error('Unexpected host call ' + i.name);};
  const game = await WebAssembly.instantiate(compiled, imports);e = game.exports;
  const runtime = await createEngine();
  runtime.bridge = {
    original: (a,c) => e[a === 0x8720c0 ? 'westminster_original_menu' : 'westminster_original_leaf'](c),
    readRax: c => Number(new DataView(e.memory.buffer).getBigUint64(c,true)),
    writeRax: (c,v) => new DataView(e.memory.buffer).setBigUint64(c,BigInt(v),true),
    menuCompleted: () => false, label: () => {throw Error('Unexpected menu label request');}
  };
  check(runtime._ws_init() === 1, 'SDK engine initialization failed');
  runtime.FS.writeFile('/menu-mod.wasm', pluginBytes);
  progress('Loading Geode Hook SDK source mod');
  check(runtime.ccall('ws_load_mod','number',['string'],['/menu-mod.wasm']) === 1,
    'SDK mod load failed: ' + runtime.ccall('ws_error','string',[],[]));
  check(runtime._ws_test_install() === 1, 'Geode Hook::enable failed');
  const handles = await prototype.install(game, prepared.targets);
  for (const target of prepared.targets) {
    const bridge = await WebAssembly.instantiate(prototype.bridgeBytes(), {hook: {
      before() {}, original: c => runtime._ws_next(target.address,c), after() {}
    }});
    e.__indirect_function_table.set(target.slot,bridge.instance.exports.run);
  }
  const cpu=4096,stack=8192,ret=0x12345678n;
  function run(fn,expected) {
    let v=new DataView(e.memory.buffer);
    new Uint8Array(e.memory.buffer,cpu,4096).fill(0);
    v.setBigUint64(cpu+32,BigInt(stack),true);v.setBigUint64(stack,ret,true);
    fn(cpu);v=new DataView(e.memory.buffer);
    check(v.getBigUint64(cpu,true)===BigInt(expected),'Incorrect SDK hook return');
    check(v.getBigUint64(cpu+32,true)===8200n&&v.getBigUint64(cpu+192,true)===ret,'Native return state was not preserved');
  }
  progress('Checking real Geode Hook enable, disable and re-enable');
  run(e.westminster_probe_direct,600);
  run(e.__indirect_function_table.get(5341),600);
  check(runtime._ws_test_toggle(0)===1,'Hook::toggle(false) failed');run(e.westminster_probe_direct,480);
  check(runtime._ws_test_toggle(1)===1,'Hook::toggle(true) failed');run(e.westminster_probe_direct,600);
  check(runtime._ws_test_toggle(0)===1,'Final disable failed');run(e.westminster_probe_direct,480);
  for (const h of Object.values(handles)) h.restore();
  progress('Checking a native Cocos object method and translated menu-return detection');
  const api=new GuestApi(e,{cpu:16384,stack:65536,scratch:32768});
  check(api.call(0x717680)===480n,'Guest call adapter failed');
  const node=24000n,point=api.point(284,24),v=new DataView(e.memory.buffer);
  api.call(COCOS.setPosition,[node,point]);
  check(v.getFloat32(Number(node)+76,true)===284 && v.getFloat32(Number(node)+80,true)===24,
    'Actual Cocos setPosition failed to update the guest object');
  check(v.getUint8(Number(node)+274)===1 && v.getUint8(Number(node)+284)===1,'Native Cocos dirty flags were not set');
  v.setBigUint64(cpu+32,BigInt(stack),true);v.setBigUint64(stack,ret,true);v.setBigUint64(cpu+8,node,true);
  const completion=new MenuCompletion(e.memory);completion.before(cpu);
  v.setBigUint64(cpu+32,BigInt(stack)-16n,true);v.setBigUint64(cpu+192,ret,true);v.setBigUint64(cpu,1n,true);
  check(!completion.finished(cpu),'Intermediate WASM return was incorrectly accepted');
  v.setBigUint64(cpu+32,BigInt(stack)+8n,true);v.setBigUint64(346225608,1n,true);
  check(!completion.finished(cpu),'Pending native call was incorrectly accepted');
  v.setBigUint64(346225608,0n,true);
  check(completion.finished(cpu)&&completion.take(cpu)===node,'Completed menu return was not recognized');
  return {status:'PASS',module:prototype.PIN,upstreamGeodeHookCppCompiled:true,
    geodeHookPublicApi:true,sdkSubsetModLoaded:true,original:480,modified:600,
    directCall:true,indirectCall:true,toggleAndRestore:true,nativeReturnPreserved:true,
    nativeCocosSetPosition:true,menuCompletionFixture:true,
    fullGeodeLoader:false,existingGeodePackagesSupported:false,fullGameBootTested:false,
    menuLabelTested:false};
}
