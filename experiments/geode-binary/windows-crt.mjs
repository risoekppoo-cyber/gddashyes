import {GuestModules} from './windows-modules.mjs';
export const CRT_NAMES=['wcslen','strlen','memcpy','memmove','memset','memcmp','malloc','calloc','realloc','free'];
export class GuestCrt extends GuestModules {
 constructor(memory,addresses,options={}){super(memory,addresses,options);this.allocator=options.allocator;this.heap=new Map();this.errno=0;}
 resolve(item){
  if(CRT_NAMES.includes(item.name)&&/^(api-ms-win-crt-|ucrtbase|msvcr|vcruntime)/i.test(item.dll)){
   const address=this.addresses[item.name];return address===undefined?undefined:BigInt(address);
  }
  return super.resolve(item);
 }
 range(pointer,size){const n=BigInt(size),p=BigInt(pointer),limit=BigInt(this.memory.buffer.byteLength);if(p>limit||n<0n||n>limit-p)throw Error('Guest CRT memory bounds');return Number(p);}
 allocate(size,zero=false){
  const n=BigInt(size);
  if(n>0x7ffffff0n){this.errno=12;return 0n;}
  if(!this.allocator)throw Error('Guest CRT allocator unavailable');
  const length=Math.max(1,Number(n)),raw=this.allocator.malloc(length+15);
  if(!raw){this.errno=12;return 0n;}
  const p=Math.ceil(raw/16)*16;
  this.range(raw,length+15);this.range(p,length);
  if(this.heap.has(p))throw Error('Duplicate guest CRT allocation');
  this.heap.set(p,{raw,size:Number(n)});
  if(zero)new Uint8Array(this.memory.buffer,p,Number(n)).fill(0);
  return BigInt(p);
 }
 free(pointer){if(pointer===0n)return;const p=Number(pointer),entry=this.heap.get(p);if(!entry)throw Error('Unowned guest CRT free');this.allocator.free(entry.raw);this.heap.delete(p);}
 releaseHeap(){let first;for(const p of [...this.heap.keys()]){try{this.free(BigInt(p));}catch(error){first??=error;}}if(first)throw first;}
 invoke(cpu,address){
  const name=Object.keys(this.addresses).find(k=>BigInt(this.addresses[k])===address);
  if(!CRT_NAMES.includes(name))return super.invoke(cpu,address);
  let v=new DataView(this.memory.buffer);const a=v.getBigUint64(cpu+8,true),b=v.getBigUint64(cpu+16,true),c=v.getBigUint64(cpu+64,true),sp=v.getBigUint64(cpu+32,true);
  this.range(sp,8);let result;
  if(name==='malloc')result=this.allocate(a);
  else if(name==='calloc')result=this.allocate(a*b,true);
  else if(name==='free')this.free(a);
  else if(name==='realloc'){
   if(a===0n)result=this.allocate(b);
   else if(b===0n){this.free(a);result=0n;}
   else{
    const old=this.heap.get(Number(a));if(!old)throw Error('Unowned guest CRT realloc');
    result=this.allocate(b);
    if(result){const n=Math.min(old.size,Number(b));new Uint8Array(this.memory.buffer).copyWithin(Number(result),Number(a),Number(a)+n);this.free(a);}
   }
  }else if(name==='strlen'||name==='wcslen'){
   const stride=name==='wcslen'?2:1,p=this.range(a,0);let n=0;
   v=new DataView(this.memory.buffer);
   while(true){this.range(BigInt(p+n*stride),stride);const value=stride===2?v.getUint16(p+n*stride,true):v.getUint8(p+n);if(!value)break;n++;}
   result=BigInt(n);
  }else{
   const n=Number(c),p=this.range(a,c),bytes=new Uint8Array(this.memory.buffer);
   if(name==='memset')bytes.fill(Number(b&255n),p,p+n);
   else{
    const q=this.range(b,c);
    if(name==='memcmp'){let difference=0;for(let i=0;i<n;i++)if(bytes[p+i]!==bytes[q+i]){difference=bytes[p+i]<bytes[q+i]?-1:1;break;}result=BigInt.asUintN(32,BigInt(difference));}
    else{if(name==='memcpy'&&p<q+n&&q<p+n&&p!==q)throw Error('Overlapping guest memcpy');bytes.copyWithin(p,q,q+n);}
   }
   result??=a;
  }
  v=new DataView(this.memory.buffer);
  if(result!==undefined)v.setBigUint64(cpu,BigInt.asUintN(64,result),true);
  this.calls.push(name);v.setBigUint64(cpu+192,v.getBigUint64(Number(sp),true),true);v.setBigUint64(cpu+32,sp+8n,true);
 }
}
