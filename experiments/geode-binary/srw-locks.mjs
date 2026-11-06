// Serialized, single-thread guest SRW locks. Contended blocking calls stop;
// they are never reported as successful acquisitions.
export class SrwLocks {
 constructor(){this.states=new Map();this.acquisitions=0;}
 invoke(name,memory,cpu,thread=1){
  const v=new DataView(memory.buffer),p=v.getBigUint64(cpu+8,true),sp=v.getBigUint64(cpu+32,true);
  if(!p||p>0xffffffffn||Number(p)+8>v.byteLength||!sp||sp>0xffffffffn||Number(sp)+8>v.byteLength)throw Error('SRW pointer outside memory');
  const at=Number(p),ret=v.getBigUint64(Number(sp),true),key=name.split('!').at(-1).toLowerCase();
  let state=this.states.get(at),result;
  if(!state){if(v.getBigUint64(at,true)!==0n)throw Error('Unrecognized SRW state');state={writer:null,readers:new Set()};this.states.set(at,state);}
  const shared=key.endsWith('shared'),tryOnly=key.startsWith('tryacquire');
  if(key==='initializesrwlock'){
   if(state.writer!==null||state.readers.size)throw Error('Cannot initialize an owned SRW lock');
  }else if(key.startsWith('release')){
   if(shared){if(!state.readers.delete(thread))throw Error('SRW release by non-owner');}
   else {if(state.writer!==thread)throw Error('SRW release by non-owner');state.writer=null;}
  }else if(key.startsWith('acquire')||tryOnly){
   const unavailable=state.writer!==null||(!shared&&state.readers.size>0);
   if(unavailable){if(!tryOnly)throw Error('Blocking SRW contention requires a scheduler');result=0n;}
   else {
    if(shared){if(state.readers.has(thread))throw Error('Recursive shared SRW acquisition');state.readers.add(thread);}
    else state.writer=thread;
    this.acquisitions++;if(tryOnly)result=1n;
   }
  }else throw Error('Unimplemented SRW operation '+name);
  v.setBigUint64(at,state.writer!==null?1n:state.readers.size?BigInt(state.readers.size)*16n+1n:0n,true);
  if(result!==undefined)v.setBigUint64(cpu,result,true);
  v.setBigUint64(cpu+32,sp+8n,true);v.setBigUint64(cpu+192,ret,true);
 }
}
