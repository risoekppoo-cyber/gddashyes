// Guest execution-context identities, not host OS thread IDs.
// This registry does not create threads, implement TLS, or schedule workers.
export class GuestThreads {
 #ids=new Map();#next=1;
 register(context){
  if(this.#ids.has(context))return this.#ids.get(context);
  if(this.#next>0xffffffff)throw Error('Guest thread IDs exhausted');
  const id=this.#next++;this.#ids.set(context,id);return id;
 }
 id(context){
  if(!this.#ids.has(context))throw Error('Unregistered guest thread');
  return this.#ids.get(context);
 }
 retire(context){
  if(!this.#ids.delete(context))throw Error('Unregistered guest thread');
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
