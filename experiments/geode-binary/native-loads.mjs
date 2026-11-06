// Bounded dynamic dependency initialization, never return a handle before attach.
export class NativeLoads {
 constructor(tibBase){this.tibBase=tibBase;this.frame=null;this.completedTls=0;this.completedEntries=0;this.completedLoads=0;}
 handles(pc){return !!this.frame&&pc===0x73000000n;}
 begin(module,memory,cpu){
  if(this.frame)throw Error('NESTED_DEPENDENCY_LOAD_UNSUPPORTED');
  if(module.initialized!==false)throw Error('Dependency state is not awaiting initialization');
  const v=new DataView(memory.buffer),sp=v.getBigUint64(cpu+32,true),tls=module.tls;
  if(sp<48n||sp>0xffffffffn||Number(sp)+8>memory.buffer.byteLength||sp%16n!==8n)throw Error('Dependency call stack bounds/alignment');
  v.setUint32(tls.indexAddress,tls.index,true);v.setBigUint64(this.tibBase+0x2000+tls.index*8,BigInt(tls.base),true);
  new Uint8Array(memory.buffer,tls.base,tls.size).fill(0);
  new Uint8Array(memory.buffer,tls.base,tls.templateHex.length/2).set(Uint8Array.from(tls.templateHex.match(/../g)??[],x=>parseInt(x,16)));
  this.frame={module,sp,ret:v.getBigUint64(Number(sp),true),next:0,targets:[...tls.callbacks,module.entry]};this.advance(memory,cpu);
 }
 advance(memory,cpu){
  const f=this.frame,v=new DataView(memory.buffer);
  if(f.next===f.targets.length){
   f.module.initialized=true;v.setBigUint64(cpu,BigInt(f.module.base),true);v.setBigUint64(cpu+32,f.sp+8n,true);v.setBigUint64(cpu+192,f.ret,true);this.frame=null;this.completedLoads++;return;
  }
  const target=f.targets[f.next++],sp=f.sp-48n;f.callbackSp=sp;
  v.setBigUint64(Number(sp),0x73000000n,true);v.setBigUint64(cpu+32,sp,true);v.setBigUint64(cpu+192,BigInt(target),true);
  v.setBigUint64(cpu+8,BigInt(f.module.base),true);v.setBigUint64(cpu+16,1n,true);v.setBigUint64(cpu+64,0n,true);
 }
 resume(memory,cpu){
  const f=this.frame,v=new DataView(memory.buffer);
  if(!f||v.getBigUint64(cpu+192,true)!==0x73000000n||v.getBigUint64(cpu+32,true)!==f.callbackSp+8n)throw Error('Invalid dependency callback return');
  if(f.next===f.targets.length){if((v.getBigUint64(cpu,true)&0xffffffffn)===0n)throw Error('MODULE_ATTACH_FAILED_DETACH_REQUIRED');this.completedEntries++;}
  else this.completedTls++;
  this.advance(memory,cpu);
 }
}
