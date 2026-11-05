const fromHex=s=>Uint8Array.from(s.match(/../g),x=>parseInt(x,16));
const hex=bytes=>Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
const check=(ok,text)=>{if(!ok)throw Error(text);};
export async function instantiateLift(bytes,memory) {
  // An auxiliary module must not initialize or overwrite the game's memory.
  const b=new Uint8Array(bytes);let p=8;
  const leb=()=>{let n=0,s=0,v;do{v=b[p++];n+=(v&127)*2**s;s+=7;}while(v&128);return n;};
  while(p<b.length){const id=b[p++],size=leb();check(![6,8,11].includes(id),'Rejected stateful auxiliary module');p+=size;}
  const module=await WebAssembly.compile(bytes);
  const descriptors=WebAssembly.Module.imports(module);
  check(descriptors.length===2 && descriptors.every(i=>i.module==='env' &&
    (i.name==='memory'&&i.kind==='memory'||i.name==='lift_fault'&&i.kind==='function')),'Unexpected auxiliary imports');
  return WebAssembly.instantiate(module,{env:{memory,lift_fault(code,address,pc){
    throw Error(`Geode binary translation stopped: fault ${code}, address 0x${address.toString(16)}, PC 0x${pc.toString(16)}`);
  }}});
}
export async function verifyVectors(bytes,manifest,reference) {
  check(reference.dllSha256===manifest.dllSha256,'Reference DLL mismatch');
  const memory=new WebAssembly.Memory({initial:32,maximum:65536});
  const instance=await instantiateLift(bytes,memory),cpu=0x20000,stop=0x1234fedcn;
  let tested=0;
  for(const test of reference.vectors){
    new Uint8Array(memory.buffer).fill(0);
    const v=new DataView(memory.buffer);
    for(let i=0;i<16;i++)v.setBigUint64(cpu+i*8,BigInt(test.initial[i]),true);
    v.setBigUint64(0x40000,0x40100n,true);v.setBigUint64(0x60008,stop,true);
    new Uint8Array(memory.buffer,0x40100,256).set(fromHex(test.objectBefore));
    const base=BigInt(test.imageBase),entry=base+BigInt(manifest.roots[test.name].rva);
    const steps=instance.exports.lift_run(cpu,entry,base,0,stop,128);
    check(steps===4,'Unexpected translated instruction count');
    for(let i=0;i<16;i++)check(v.getBigUint64(cpu+i*8,true)===BigInt(test.expected[i]),`${test.name}: ${reference.registers[i]} disagrees with independent x64 execution`);
    check(v.getBigUint64(cpu+192,true)===stop,'Native return PC changed');
    check(hex(new Uint8Array(memory.buffer,0x40100,256))===test.objectAfter,'Object bytes disagree with x64 reference');
    check(v.getBigUint64(0x60008,true)===stop,'Return stack memory changed');
    tested++;
  }
  const reject=(fn,fragment)=>{let error;try{fn();}catch(e){error=e;}check(error&&String(error).includes(fragment),'Missing expected rejection: '+fragment);};
  const base=BigInt(manifest.imageBase);
  reject(()=>instance.exports.lift_run(cpu,base+123n,base,0,stop,128),'fault 1');
  reject(()=>instance.exports.lift_run(cpu,base+BigInt(manifest.roots.getAddress.rva),base,0,stop,0),'fault 4');
  const v=new DataView(memory.buffer);v.setBigUint64(cpu+8,0x100000000n,true);
  reject(()=>instance.exports.lift_run(cpu,base+BigInt(manifest.roots.getAddress.rva),base,0,stop,128),'fault 3');
  return {status:'PASS',officialDllInstructionsExecutedAsWasm:true,functions:Object.keys(manifest.roots),
    instructionCount:manifest.instructions.length,independentX64Reference:reference.reference,referenceCases:tested,
    codeBaseRebasingTested:true,fullPeRelocationTested:false,unknownPcRejected:true,stepBudgetEnforced:true,
    unmappedHighDataPointerRejected:true,dllSha256:manifest.dllSha256,
    fullGeodeLoader:false,existingGeodePackagesSupported:false,fullGameBootTested:false};
}

// A synthetic MSVC-layout Hook/Impl fixture in the ACTUAL GD memory. The return
// value of the translated DLL getter is then dispatched into an actual GD body.
// This does not construct or initialize a genuine Geode Hook through its loader.
export async function verifyGameMemory(bytes,manifest,e,api) {
  const instance=await instantiateLift(bytes,e.memory),{cpu,stack,scratch}=api.arena;
  const top=stack+65536-256,hook=scratch,impl=scratch+256,stop=0x1234fedcn;
  const imageBase=BigInt(manifest.imageBase),v=()=>new DataView(e.memory.buffer);
  new Uint8Array(e.memory.buffer,hook,512).fill(0);
  v().setBigUint64(hook,api.guest(impl),true);
  v().setBigUint64(impl+0x20,0x717680n,true);
  v().setInt32(impl+0xb0,-17,true);
  function call(name,arg=0n) {
    new Uint8Array(e.memory.buffer,cpu,4096).fill(0);
    const view=v();view.setBigUint64(cpu+8,api.guest(hook),true);view.setBigUint64(cpu+16,arg,true);
    view.setBigUint64(cpu+32,api.guest(top),true);view.setBigUint64(top,stop,true);
    const n=instance.exports.lift_run(cpu,imageBase+BigInt(manifest.roots[name].rva),imageBase,api.base(),stop,128);
    check(n===4&&view.getBigUint64(cpu+192,true)===stop&&view.getBigUint64(cpu+32,true)===api.guest(top)+8n,'Game-memory return state mismatch');
    return view.getBigUint64(cpu,true);
  }
  check(call('isEnabled')===0n,'Unexpected Hook enabled state');
  check(call('getAutoEnable')===0n,'Unexpected Hook auto-enable state');
  call('setAutoEnable',1n);check(call('getAutoEnable')===1n,'Native Hook setter/getter failed');
  check(call('getPriority')===0xffffffefn,'Native priority getter failed');
  const address=call('getAddress');check(address===0x717680n,'Native Hook address getter failed');
  check(api.call(Number(address))===480n,'Translated Geode address could not call GD');
  return {status:'BINARY_GEODE_CANARY_PASS',officialDllFunctionsInGameMemory:true,
    syntheticHookFixture:true,returnedAddressCalledInGame:true,originalGameReturn:480,
    nativeReturnPreserved:true,fullGeodeLoader:false,existingGeodePackagesSupported:false};
}
