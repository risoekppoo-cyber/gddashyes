// Bounded one-context SRW profile. Contention/blocking is rejected explicitly.
// Opaque values 0/1 match the local Windows native fixture, not a general ABI
// promise about undocumented kernel internals. All accesses use guest memory.
export class GuestSrw {
 constructor(memory,addresses){this.memory=memory;this.addresses=addresses;this.held=new Set();this.srwOwners=new Map();this.calls=[];}
 resolve(item){if(item.dll.toLowerCase()!=='kernel32.dll')return undefined;const n=this.addresses[item.name];return n===undefined?undefined:BigInt(n);}
 invoke(cpu,address){
  const name=Object.keys(this.addresses).find(k=>BigInt(this.addresses[k])===address);
  if(!name)throw Error('Unimplemented guest service at '+address.toString(16));
  const v=new DataView(this.memory.buffer),pointer=v.getBigUint64(cpu+8,true),sp=v.getBigUint64(cpu+32,true);
  if(pointer>BigInt(v.byteLength-8)||sp>BigInt(v.byteLength-8)||pointer%8n)throw Error('Invalid guest SRW pointer/stack');
  const p=Number(pointer),value=v.getBigUint64(p,true);
  if(name==='AcquireSRWLockExclusive'){
   if(this.held.has(p)||value!==0n)throw Error('Contended/recursive guest SRW acquisition is unsupported');
   this.held.add(p);this.srwOwners.set(p,this.currentThreadId??1);v.setBigUint64(p,1n,true);
  }else if(name==='ReleaseSRWLockExclusive'){
   if(!this.held.has(p)||this.srwOwners.get(p)!==(this.currentThreadId??1)||value!==1n)throw Error('Unowned guest SRW release');
   this.held.delete(p);this.srwOwners.delete(p);v.setBigUint64(p,0n,true);
  }else throw Error('Unsupported SRW operation');
  this.calls.push(name);v.setBigUint64(cpu+192,v.getBigUint64(Number(sp),true),true);v.setBigUint64(cpu+32,sp+8n,true);
 }
}
