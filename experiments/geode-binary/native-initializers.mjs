// Execute actual native C/C++ initializer targets through the guest dispatcher.
export class NativeInitializers {
 constructor(){this.frames=[];this.callbackCount=0;this.completedCallbacks=0;this.completedTables=0;}
 handles(pc){return this.frames.length&&pc===this.frames.at(-1).sentinel;}
 read(v,p,n=8){if(p<0n||p>0xffffffffn||Number(p)+n>v.byteLength)throw Error('Initializer address outside memory');return Number(p);}
 begin(name,memory,cpu){
  const v=new DataView(memory.buffer),first=v.getBigUint64(cpu+8,true),end=v.getBigUint64(cpu+16,true),sp=v.getBigUint64(cpu+32,true);
  if(first>end||first%8n||end%8n||end-first>80000n)throw Error('Invalid initializer table');
  this.read(v,first,Number(end-first));
  const frame={next:first,end,sp,ret:v.getBigUint64(this.read(v,sp),true),error:name.endsWith('_initterm_e'),sentinel:0x71000000n+BigInt(this.frames.length*16)};
  this.frames.push(frame);this.advance(memory,cpu);
 }
 finish(memory,cpu,result){
  const v=new DataView(memory.buffer),f=this.frames.pop();
  if(f.error)v.setBigUint64(cpu,BigInt(result>>>0),true);
  v.setBigUint64(cpu+32,f.sp+8n,true);v.setBigUint64(cpu+192,f.ret,true);this.completedTables++;
 }
 advance(memory,cpu){
  const v=new DataView(memory.buffer),f=this.frames.at(-1);
  while(f.next<f.end){
   const target=v.getBigUint64(this.read(v,f.next),true);f.next+=8n;if(!target)continue;
   if(++this.callbackCount>10000)throw Error('Initializer callback budget exhausted');
   const sp=f.sp-48n;this.read(v,sp,48);f.callbackSp=sp;
   v.setBigUint64(Number(sp),f.sentinel,true);v.setBigUint64(cpu+32,sp,true);v.setBigUint64(cpu+192,target,true);return;
  }
  this.finish(memory,cpu,0);
 }
 resume(memory,cpu){
  const v=new DataView(memory.buffer),f=this.frames.at(-1);
  if(!f||v.getBigUint64(cpu+192,true)!==f.sentinel||v.getBigUint64(cpu+32,true)!==f.callbackSp+8n)throw Error('Invalid initializer callback return');
  this.completedCallbacks++;
  const result=Number(v.getBigUint64(cpu,true)&0xffffffffn);
  if(f.error&&result)this.finish(memory,cpu,result);else this.advance(memory,cpu);
 }
}
