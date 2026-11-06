import {VersionedCodeRouter} from './router.mjs';
export async function verifyGeneratedCode(load){
 const manifest=await load('manifest.json',true),memory=new WebAssembly.Memory({initial:5500}),cpu=4096,v=new DataView(memory.buffer),router=new VersionedCodeRouter(memory);
 const assert=(ok,message)=>{if(!ok)throw Error(message);};
 for(const variant of manifest.variants)await router.register(variant,await load(variant.name+'.wasm'));
 const bytes=h=>Uint8Array.from(h.match(/../g),x=>parseInt(x,16));let calls=0;
 const flags=[[0,2560],[2,2562],[4,2564],[6,2566],[7,2567],[11,2571]];
 const reset=c=>{new Uint8Array(memory.buffer,cpu,4096).fill(0);for(let i=0;i<16;i++){v.setBigUint64(cpu+i*8,BigInt(c.initial[i]),true);const value=BigInt(c.xmm[i]);v.setBigUint64(cpu+256+i*16,value&0xffffffffffffffffn,true);v.setBigUint64(cpu+264+i*16,value>>64n,true);}for(const [bit,offset] of flags)v.setUint8(cpu+offset,(c.flags>>bit)&1);new Uint8Array(memory.buffer,0x1f000,64).fill(0xa5);};
 for(const c of manifest.cases){const variant=manifest.variants.find(x=>x.name===c.variant);new Uint8Array(memory.buffer,variant.entry,variant.codeHex.length/2).set(bytes(variant.codeHex));reset(c);const result=router.run(variant.entry,cpu);assert(result.variant===c.variant,'Wrong code version');
  assert((result.result&0x7fffffff)===variant.steps,'Instruction count');assert(v.getBigUint64(cpu+192,true)===BigInt(c.pc),'Native transfer target');
  for(let i=0;i<16;i++){assert(v.getBigUint64(cpu+i*8,true)===BigInt(c.expected[i]),'GPR '+i);const xmm=v.getBigUint64(cpu+256+i*16,true)|(v.getBigUint64(cpu+264+i*16,true)<<64n);assert(xmm===BigInt(c.xmm[i]),'XMM '+i);}
  assert(bytes(c.stackHex).every((b,i)=>new Uint8Array(memory.buffer)[0x1f000+i]===b),'Native stack');for(const [bit,offset] of flags)assert(v.getUint8(cpu+offset)===((c.expectedFlags>>bit)&1),'Arithmetic flags');calls++;
 }
 const original=manifest.variants.find(x=>x.name==='original'),patched=manifest.variants.find(x=>x.name==='patched');
 for(const variant of [original,patched,original]){new Uint8Array(memory.buffer,variant.entry,variant.codeHex.length/2).set(bytes(variant.codeHex));assert(router.select(variant.entry).name===variant.name,'Patch/restoration routing');}
 const saved=router.select(original.entry);new Uint8Array(memory.buffer)[original.entry]^=1;let stale=false,unknown=false;
 try{router.select(original.entry);}catch{unknown=true;}
 try{saved.instance.exports.lift_run(cpu,BigInt(original.entry),BigInt(original.imageBase),0,BigInt(original.target),16);}catch(e){stale=/fault 8/.test(String(e));}
 assert(unknown&&stale,'Changed code must reject stale translation');
 return {status:'GEODE_GENERATED_CODE_ROUTING_PASS',dllSha256:manifest.dllSha256,startupInstructions:manifest.startupInstructions,nativeReference:manifest.nativeReference,cases:calls,actualGeodeInstalledPatch:true,actualGeodeGeneratedTrampoline:true,patchedEntryTarget:'0x'+patched.target.toString(16),patchAndRestoreRouting:true,allGeneralRegistersMatch:true,allXmmRegistersMatch:true,arithmeticFlagsMatch:true,nativeStackMatches:true,unknownCodeRejected:unknown,staleTranslationRejected:stale,fullGeodeLoader:false,existingGeodePackagesSupported:false,fullGameBootTested:false};
}
