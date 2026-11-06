// Guest execution-context identities, not host OS thread IDs.
// This registry does not create threads, implement TLS, or schedule workers.
export class GuestThreads {
 #ids=new Map();#next=1;descriptions=new Map();localAllocations=new Map();localNext=0xa00000;
 register(context){
  if(this.#ids.has(context))return this.#ids.get(context);
  if(this.#next>0xffffffff)throw Error('Guest thread IDs exhausted');
  const id=this.#next++;this.#ids.set(context,id);return id;
 }
 id(context){
  if(!this.#ids.has(context))throw Error('Unregistered guest thread');
  return this.#ids.get(context);
 }
 invoke(name,memory,cpu,context){
  this.id(context);const v=new DataView(memory.buffer),key=name.toLowerCase();let result;
  const sp=v.getBigUint64(cpu+32,true);if(sp<=0n||sp>0xffffffffn||Number(sp)+8>memory.buffer.byteLength)throw Error('Guest stack bounds');
  if(key.endsWith('!getcurrentthread'))result=0xfffffffffffffffen;
  else if(key.endsWith('!setthreaddescription')){
   if(v.getBigUint64(cpu+8,true)!==0xfffffffffffffffen)throw Error('UNMODELED_THREAD_HANDLE');
   const p=v.getBigUint64(cpu+16,true);let text='',terminated=false;
   for(let i=0;i<32768;i++){const at=Number(p)+i*2;if(p<=0n||p>0xffffffffn||at+2>memory.buffer.byteLength)throw Error('Thread name bounds');const c=v.getUint16(at,true);if(!c){terminated=true;break;}text+=String.fromCharCode(c);}
   if(!terminated)throw Error('Unterminated thread name');this.descriptions.set(context,text);result=0n;
  }else if(key.endsWith('!getthreaddescription')){
   if(v.getBigUint64(cpu+8,true)!==0xfffffffffffffffen)throw Error('UNMODELED_THREAD_HANDLE');
   const out=v.getBigUint64(cpu+16,true);if(out<=0n||out>0xffffffffn||Number(out)+8>memory.buffer.byteLength)throw Error('Thread output bounds');
   const text=this.descriptions.get(context)??'',size=(text.length+1)*2,p=this.localNext;
   if(p+size>0xb00000||p+size>memory.buffer.byteLength)throw Error('Local heap exhausted');
   this.localNext+=(size+15)&~15;this.localAllocations.set(p,size);
   for(let i=0;i<text.length;i++)v.setUint16(p+i*2,text.charCodeAt(i),true);v.setUint16(p+text.length*2,0,true);
   v.setBigUint64(Number(out),BigInt(p),true);result=0n;
  }else if(key.endsWith('!localfree')){
   const p=v.getBigUint64(cpu+8,true);if(p!==0n&&!this.localAllocations.delete(Number(p)))throw Error('UNMODELED_LOCAL_HANDLE');result=0n;
  }else throw Error('Unknown thread API');
  v.setBigUint64(cpu,result,true);v.setBigUint64(cpu+192,v.getBigUint64(Number(sp),true),true);v.setBigUint64(cpu+32,sp+8n,true);return result;
 }
 retire(context){
  if(!this.#ids.delete(context))throw Error('Unregistered guest thread');
  this.descriptions.delete(context);
 }
}
export function getCurrentThreadId(memory,cpu,threads,context,guestBase=0){
 const id=threads.id(context),v=new DataView(memory.buffer),sp=v.getBigUint64(cpu+32,true);
 const stack=Number(sp)+guestBase;
 if(sp>0xffffffffn||!Number.isSafeInteger(stack)||stack<0||stack+8>memory.buffer.byteLength)
  throw Error('Native return stack outside memory');
 const ret=v.getBigUint64(stack,true);
 v.setBigUint64(cpu,BigInt(id),true); // DWORD result zero-extended in RAX.
 v.setBigUint64(cpu+32,sp+8n,true);v.setBigUint64(cpu+192,ret,true);
 return id;
}
