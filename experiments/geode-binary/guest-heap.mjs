// Owned guest offsets, bounded allocation, preserved realloc contents, no host pointers.
export class GuestHeap {
 constructor(memory,{base=0x3400000,size=0x800000,errno=0xc00000}={}){
  if(base%16||size%16||base<=0||size<=0||base+size>memory.buffer.byteLength||errno<=0||errno+4>memory.buffer.byteLength)throw Error('Invalid CRT heap region');
  this.memory=memory;this.base=base;this.size=size;this.errno=errno;this.available=[[base,size]];this.allocations=new Map();this.calls=0;
 }
 fail(){new DataView(this.memory.buffer).setUint32(this.errno,12,true);return 0;}
 allocate(bytes){
  if(typeof bytes!=='bigint'||bytes<0n||bytes>BigInt(this.size))return this.fail();
  const requested=Number(bytes),size=Math.ceil(Math.max(1,requested)/16)*16;
  for(let i=0;i<this.available.length;i++){
   const [p,n]=this.available[i];if(n<size)continue;
   this.available.splice(i,1,...(n===size?[]:[[p+size,n-size]]));this.allocations.set(p,[requested,size]);return p;
  }
  return this.fail();
 }
 free(pointer){
  if(pointer===0n)return;
  const p=Number(pointer),allocation=this.allocations.get(p);if(pointer>0xffffffffn||!allocation)throw Error('INVALID_CRT_FREE');
  this.allocations.delete(p);this.available.push([p,allocation[1]]);this.available.sort((a,b)=>a[0]-b[0]);
  const merged=[];for(const block of this.available){const last=merged.at(-1);if(last&&last[0]+last[1]===block[0])last[1]+=block[1];else merged.push([...block]);}this.available=merged;
 }
 call(symbol,a,b=0n){
  this.calls++;const v=new DataView(this.memory.buffer);let result;
  if(symbol==='malloc')result=this.allocate(a);
  else if(symbol==='free'){this.free(a);return;}
  else if(symbol==='calloc'){
   const n=a*b;result=n>0xffffffffffffffffn?this.fail():this.allocate(n);
   if(result&&n)new Uint8Array(this.memory.buffer,result,Number(n)).fill(0);
  }else if(symbol==='realloc'){
   if(a===0n)result=this.allocate(b);
   else {
    const old=this.allocations.get(Number(a));if(a>0xffffffffn||!old)throw Error('INVALID_CRT_REALLOC');
    if(b===0n){this.free(a);result=0;}
    else if(b<=BigInt(old[1])){this.allocations.set(Number(a),[Number(b),old[1]]);result=Number(a);}
    else {result=this.allocate(b);if(result){new Uint8Array(this.memory.buffer,result,Math.min(old[0],Number(b))).set(new Uint8Array(this.memory.buffer,Number(a),Math.min(old[0],Number(b))));this.free(a);}}
   }
  }else if(symbol==='_msize'){
   const allocation=this.allocations.get(Number(a));if(a>0xffffffffn||!allocation)throw Error('INVALID_CRT_MSIZE');result=allocation[1];
  }else if(symbol==='_errno')result=this.errno;
  else throw Error('UNKNOWN_CRT_HEAP_API');
  return BigInt(result);
 }
 invoke(name,cpu){
  const v=new DataView(this.memory.buffer),sp=v.getBigUint64(cpu+32,true);
  if(sp<=0n||sp>0xffffffffn||Number(sp)+8>this.memory.buffer.byteLength)throw Error('Guest CRT return bounds');
  const result=this.call(name.split('!').at(-1),v.getBigUint64(cpu+8,true),v.getBigUint64(cpu+16,true));
  if(result!==undefined)v.setBigUint64(cpu,result,true);
  v.setBigUint64(cpu+192,v.getBigUint64(Number(sp),true),true);v.setBigUint64(cpu+32,sp+8n,true);return result;
 }
}
