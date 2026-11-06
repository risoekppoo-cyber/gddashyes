// Opaque SList header for serialized guest execution, including public low-16 depth.
export class SLists {
 constructor(){this.heads=new Map();this.pushes=0;}
 invoke(name,memory,cpu){
  const v=new DataView(memory.buffer),p=v.getBigUint64(cpu+8,true),entry=v.getBigUint64(cpu+16,true),key=name.split('!').at(-1).toLowerCase();
  const range=(p,n)=>{if(p<=0n||p>0xffffffffn||p%16n||Number(p)+n>v.byteLength)throw Error('SLIST_ALIGNMENT_OR_BOUNDS');return Number(p);};
  const head=range(p,16),sp=v.getBigUint64(cpu+32,true);if(sp<=0n||sp>0xffffffffn||Number(sp)+8>v.byteLength)throw Error('SList native stack bounds');let result;
  if(key==='initializeslisthead'){
   if(this.heads.get(head)?.depth)throw Error('SLIST_REINIT_REQUIRES_CLEANUP');new Uint8Array(memory.buffer,head,16).fill(0);this.heads.set(head,{head:0,depth:0,sequence:0});
  }else if(key==='interlockedpushentryslist'){
   const state=this.heads.get(head);if(!state)throw Error('SLIST_INITIALIZATION_REQUIRED');const at=range(entry,8);
   if(v.getBigUint64(head,true)!==(BigInt(state.sequence)<<16n|BigInt(state.depth))||v.getBigUint64(head+8,true)!==BigInt(state.head))throw Error('UNMODELED_SLIST_NATIVE_HEADER_WRITE');
   if(state.depth===65535)throw Error('SLIST_PROVIDER_CAPACITY');result=BigInt(state.head);v.setBigUint64(at,result,true);state.head=at;state.depth++;state.sequence=(state.sequence+1)%2**48;
   v.setBigUint64(head,BigInt(state.sequence)<<16n|BigInt(state.depth),true);v.setBigUint64(head+8,entry,true);this.pushes++;
  }else throw Error('UNMODELED_SLIST_API');
  if(result!==undefined)v.setBigUint64(cpu,result,true);v.setBigUint64(cpu+192,v.getBigUint64(Number(sp),true),true);v.setBigUint64(cpu+32,sp+8n,true);return result;
 }
 snapshot(){return {heads:Object.fromEntries(this.heads),pushes:this.pushes};}
}
