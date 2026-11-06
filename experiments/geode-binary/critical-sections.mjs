// Recursive guest critical sections. Contention requires a real scheduler.
export class CriticalSections {
 constructor(){this.states=new Map();this.acquisitions=0;}
 invoke(name,memory,cpu,thread=1){
  const v=new DataView(memory.buffer),p=v.getBigUint64(cpu+8,true),sp=v.getBigUint64(cpu+32,true),key=name.split('!').at(-1).toLowerCase();
  if(p<=0n||p>0xffffffffn||p%8n||Number(p)+40>memory.buffer.byteLength||sp<=0n||sp>0xffffffffn||Number(sp)+8>memory.buffer.byteLength)throw Error('Critical section guest bounds/alignment');
  const at=Number(p);let state=this.states.get(at),result;
  if(key.startsWith('initializecriticalsection')){
   if(state)throw Error('Critical section already initialized');
   const spin=key==='initializecriticalsection'?0:Number(v.getBigUint64(cpu+16,true)&0xffffffffn),flags=key==='initializecriticalsectionex'?Number(v.getBigUint64(cpu+64,true)&0xffffffffn):0;
   if(flags)throw Error('UNMODELED_CRITICAL_SECTION_FLAGS');state={owner:null,depth:0,spin};this.states.set(at,state);new Uint8Array(memory.buffer,at,40).fill(0);v.setInt32(at+8,-1,true);v.setBigUint64(at+32,BigInt(spin),true);
   if(key!=='initializecriticalsection')result=1n;
  }else{
   if(!state)throw Error('Critical section not initialized');
   if(key==='deletecriticalsection'){
    if(state.owner!==null)throw Error('Cannot delete owned critical section');this.states.delete(at);new Uint8Array(memory.buffer,at,40).fill(0);
   }else if(key==='leavecriticalsection'){
    if(state.owner!==thread||state.depth===0)throw Error('Critical section non-owner release');
    if(--state.depth===0)state.owner=null;
   }else if(key==='entercriticalsection'||key==='tryentercriticalsection'){
    if(state.owner!==null&&state.owner!==thread){if(key==='entercriticalsection')throw Error('Critical section contention requires scheduler');result=0n;}
    else {if(state.depth===0x7fffffff)throw Error('Critical section recursion overflow');state.owner=thread;state.depth++;this.acquisitions++;if(key==='tryentercriticalsection')result=1n;}
   }else throw Error('Unknown critical-section API');
   if(this.states.has(at)){v.setInt32(at+8,state.depth-1,true);v.setInt32(at+12,state.depth,true);v.setBigUint64(at+16,BigInt(state.owner??0),true);}
  }
  if(result!==undefined)v.setBigUint64(cpu,result,true);v.setBigUint64(cpu+192,v.getBigUint64(Number(sp),true),true);v.setBigUint64(cpu+32,sp+8n,true);return result;
 }
}
