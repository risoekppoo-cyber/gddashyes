import {GuestCrt,CRT_NAMES} from './windows-crt.mjs';
export async function loadSetup(e,helper,base){
 const [m,bytes]=await Promise.all([fetch(new URL('setup-manifest.json',base)).then(r=>{if(!r.ok)throw Error('Setup manifest HTTP '+r.status);return r.json();}),fetch(new URL('setup.wasm',base)).then(r=>{if(!r.ok)throw Error('Setup WASM HTTP '+r.status);return r.arrayBuffer();})]);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
 if(hash!==m.wasmSha256||m.dllSha256!=='ccedc2f1c86baf342f6720b9685991ca31fba246453efe2a1daf609dc40b6499')throw Error('Pinned setup module mismatch');
 return new SetupContext(e,m,await helper.instantiateStartupLift(bytes,e.memory));
}
class SetupContext{
 constructor(e,m,aux){this.e=e;this.metadata=m;this.aux=aux;this.allocations=[];}
 allocate(size){const p=this.e.malloc(size);if(!Number.isSafeInteger(p)||p<=0||p+size>this.e.memory.buffer.byteLength)throw Error('Setup reservation failed');this.allocations.push(p);return p;}
 reserve(){
  this.tib=Math.ceil(this.allocate(0x10010)/16)*16;
  this.stack=this.allocate(0x10000);this.stackTop=Math.floor((this.stack+0x10000-128)/16)*16-8;
  this.services=new GuestCrt(this.e.memory,Object.fromEntries(['AcquireSRWLockExclusive','ReleaseSRWLockExclusive','GetModuleFileNameW','GetLastError','SetLastError',...CRT_NAMES].map((n,i)=>[n,this.tib+0xf000+i*16])),{tib:this.tib,allocator:this.e});
 }
 resolveImport(item){return this.services.resolve(item);}
 run(shadow,imageBase,liveSp,compilerTop){
  const {e,metadata:m}=this,t=m.tls;
  this.services.modules.set(BigInt(imageBase),'C:\\GeometryDash\\Geode.dll');
  if(t.templateSize+t.zeroFill>4096||t.templateRva+t.templateSize>17035264||t.indexRva+4>17035264)throw Error('Setup TLS template bounds');
  new Uint8Array(e.memory.buffer,this.tib,0x10000).fill(0);
  new Uint8Array(e.memory.buffer,this.stack,0x10000).fill(0xa5);
  const v=new DataView(e.memory.buffer),array=this.tib+0x1000,data=this.tib+0x2000;
  v.setBigUint64(this.tib+0x58,BigInt(array),true);v.setBigUint64(array,BigInt(data),true);
  new Uint8Array(e.memory.buffer,data,t.templateSize).set(new Uint8Array(e.memory.buffer,imageBase+t.templateRva,t.templateSize));
  v.setUint32(imageBase+t.indexRva,0,true);
  if(liveSp+64>v.byteLength)throw Error('Caller home-frame bounds');
  new Uint8Array(e.memory.buffer,this.stackTop,64).set(new Uint8Array(e.memory.buffer,liveSp,64));
  v.setBigUint64(shadow+32,BigInt(this.stackTop),true);v.setBigUint64(shadow+m.gsOffset,BigInt(this.tib),true);
  this.aux.exports.__stack_pointer.value=compilerTop;
  const stop=BigInt(imageBase+m.stopRva);let pc=BigInt(imageBase+m.entryRva),steps=0;
  for(let transfers=0;transfers<100;transfers++){
   const r=this.aux.exports.lift_run(shadow,pc,BigInt(imageBase),0,stop,20000)>>>0;steps+=r&0x7fffffff;
   const state=new DataView(e.memory.buffer);
   if(!(r&0x80000000)){
    if(state.getBigUint64(shadow+192,true)!==stop||steps!==m.steps||this.services.held.size)throw Error('Unexpected setup stop state');
    return {steps,stop,service:m.nextService,calls:[...this.services.calls],tib:this.tib,isolatedStack:this.stackTop,
     nextArguments:[8,16,64,72].map(o=>'0x'+state.getBigUint64(shadow+o,true).toString(16))};
   }
   this.services.invoke(shadow,state.getBigUint64(shadow+192,true));pc=state.getBigUint64(shadow+192,true);
  }
  throw Error('Setup transfer limit');
 }
 release(){let first;try{this.services?.releaseHeap();}catch(error){first=error;}for(const p of this.allocations.splice(0)){try{this.e.free(p);}catch(error){first??=error;}}if(first)throw first;}
}
