'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const hooks=require('../hook-prototype.js');
(async()=>{
 const {OwnedEntryRouter}=await import('./owned-entry-router.mjs');
 const dir=process.argv[2],manifest=JSON.parse(fs.readFileSync(dir+'/manifest.json')),bytes=fs.readFileSync(dir+'/fixture.wasm');
 assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),manifest.fixtureSha256);
 const module=new WebAssembly.Module(bytes);let unexpected=0;
 const imports={};for(const i of WebAssembly.Module.imports(module)){assert.equal(i.kind,'function');(imports[i.module]??={})[i.name]=()=>{unexpected++;throw Error('Unexpected fixture host call: '+i.name);};}
 const instance=new WebAssembly.Instance(module,imports),e=instance.exports,v=new DataView(e.memory.buffer),cpu=4096,stack=16392,ret=0x1234fedcn;
 // Explicitly initialized isolated dispatcher context; no game boot/constructors.
 v.setUint32(346225600,0,true);v.setBigUint64(346226168,0x200000n,true);v.setUint32(346176816,64,true);v.setUint32(346291872,0,true);
 const address=e.fmod_register(manifest.table);assert.equal(address,0x200400n);assert.equal(v.getUint32(346291888,true),manifest.table);
 let seen=0,originalReturns=0;
 const install=()=>hooks.install(instance,[{id:'fmod_init',slot:manifest.slot}],{
  before(t,p){assert.equal(p,cpu);seen++;v.setBigUint64(p+16,v.getBigUint64(p+16,true)+1n,true);},
  after(t,p){assert.equal(v.getBigUint64(p,true),0n);originalReturns++;v.setBigUint64(p,600n,true);}
 });
 const entry=Buffer.from(manifest.nativeEntryHex,'hex'),patch=Buffer.from(entry);patch[0]=0xe9;patch.writeInt32LE(0x101000-0x100000-5,1);
 const cases=[];let rejected=0;let seed=0x574d4441;
 const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
 function prepare(regs){new Uint8Array(e.memory.buffer,cpu,4096).fill(0xa5);regs.forEach((r,i)=>v.setBigUint64(cpu+i*8,BigInt(r),true));v.setBigUint64(cpu+192,address,true);v.setBigUint64(stack,ret,true);v.setBigUint64(346225608,0n,true);}
 function check(regs,mode,route){prepare(regs);const before=Buffer.from(new Uint8Array(e.memory.buffer,cpu,4096));
  if(route==='direct')e.fmod_direct_probe(cpu);else if(route==='table')e.__indirect_function_table.get(manifest.table)(cpu);else e.westminster_dispatch(cpu,address);
  const expected=Buffer.from(before);expected.writeBigUInt64LE(mode==='hooked'?600n:0n,0);if(mode==='hooked')expected.writeBigUInt64LE(BigInt(regs[2])+1n,16);
  if(route==='native'){expected.writeBigUInt64LE(BigInt(stack)+8n,32);expected.writeBigUInt64LE(ret,192);}
  assert.deepEqual(Buffer.from(new Uint8Array(e.memory.buffer,cpu,4096)),expected,mode+' '+route);assert.equal(v.getBigUint64(346225608,true),0n);
 }
 for(let n=0;n<64;n++){
  const handle=(await install()).fmod_init,router=new OwnedEntryRouter({entry:0x100000n,hook:0x101000n,originalBytes:entry,table:e.__indirect_function_table,slot:manifest.slot,original:handle.original,wrapped:e.__indirect_function_table.get(manifest.slot),handle});
  const regs=Array.from({length:16},()=>((BigInt(random())<<32n)|BigInt(random())).toString());regs[4]=String(stack);regs[2]=String(random()&0xffff);
  router.apply(entry);for(const route of ['direct','table','native'])check(regs,'original',route);
  router.apply(patch);for(const route of ['direct','table','native'])check(regs,'hooked',route);
  const wrong=Buffer.from(patch);wrong.writeInt32LE(0x102000-0x100000-5,1);assert.throws(()=>router.apply(wrong),/Unregistered/);assert.equal(e.__indirect_function_table.get(manifest.slot),router.wrapped);rejected++;
  const invalid=Buffer.from(patch);invalid[0]=0xcc;assert.throws(()=>router.apply(invalid),/Unsupported/);rejected++;
  router.apply(entry);for(const route of ['direct','table','native'])check(regs,'restored',route);
  cases.push({registers:regs});
 }
 assert.equal(unexpected,0);assert.equal(seen,64*3);assert.equal(originalReturns,seen);
 fs.writeFileSync(dir+'/cases.json',JSON.stringify({nativeEntryHex:manifest.nativeEntryHex,patchHex:patch.toString('hex'),cases},null,2)+'\n');
 const result={status:'FMOD_BROWSER_ADAPTER_HOOK_PASS',module:manifest.moduleSha256,iat:manifest.iat,table:manifest.table,function:manifest.function,cases:64,routes:['direct','table','native dispatcher'],original:0,modified:600,originalCalled:true,toggleAndRestore:true,entireCpuContextCompared:true,unexpectedHostCalls:unexpected,controlledNativeDetourBytesRouteToWasm:true,unknownNativePatchesRejected:rejected,audioPlaybackTested:false,geodeLoaded:false,startupBoundaryCleared:false};
 fs.writeFileSync(dir+'/browser-result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
