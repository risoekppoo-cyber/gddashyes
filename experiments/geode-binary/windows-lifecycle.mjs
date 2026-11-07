import {GuestFiles,CRT_NAMES,ENCODING_NAMES,PATH_NAMES} from './windows-files.mjs';
export {CRT_NAMES,ENCODING_NAMES,PATH_NAMES};
export const LIFECYCLE_NAMES=['_initialize_onexit_table','_register_onexit_function','_execute_onexit_table','WakeAllConditionVariable'];
export class GuestLifecycle extends GuestFiles{
 constructor(memory,addresses,options={}){super(memory,addresses,options);this.onexit=new Map();this.wakes=new Map();this.dispatchExit=options.dispatchExit;}
 resolve(item){if(LIFECYCLE_NAMES.includes(item.name)&&/^(api-ms-win-crt-runtime|ucrtbase)/i.test(item.dll)){const p=this.addresses[item.name];return p===undefined?undefined:BigInt(p);}return super.resolve(item);}
 initializeOnexit(table){
  const p=this.range(table,24),old=this.onexit.get(p);if(old?.callbacks.length)throw Error('Cannot reinitialize active guest onexit table');
  if(old?.buffer)this.free(old.buffer);
  new Uint8Array(this.memory.buffer,p,24).fill(0);this.onexit.set(p,{callbacks:[],buffer:0n,capacity:0});
 }
 registerOnexit(table,callback){
  const p=this.range(table,24),entry=this.onexit.get(p);if(!entry)throw Error('Guest CRT onexit table was not initialized');
  if(entry.callbacks.length===entry.capacity){
   const capacity=Math.max(4,entry.capacity*2),buffer=this.allocate(BigInt(capacity*8));if(!buffer)return -1;
   if(entry.buffer){new Uint8Array(this.memory.buffer).copyWithin(Number(buffer),Number(entry.buffer),Number(entry.buffer)+entry.callbacks.length*8);this.free(entry.buffer);}
   entry.buffer=buffer;entry.capacity=capacity;
  }
  const v=new DataView(this.memory.buffer);v.setBigUint64(Number(entry.buffer)+entry.callbacks.length*8,callback,true);entry.callbacks.push(callback);
  v.setBigUint64(p,entry.buffer,true);v.setBigUint64(p+8,entry.buffer+BigInt(entry.callbacks.length*8),true);v.setBigUint64(p+16,entry.buffer+BigInt(entry.capacity*8),true);return 0;
 }
 executeOnexit(table){
  const p=this.range(table,24),entry=this.onexit.get(p);if(!entry)throw Error('Uninitialized guest onexit execution');
  if(entry.callbacks.length&&typeof this.dispatchExit!=='function')throw Error('Guest exit callbacks require translated callback dispatch');
  while(entry.callbacks.length)this.dispatchExit(entry.callbacks.pop());
  if(entry.buffer)this.free(entry.buffer);new Uint8Array(this.memory.buffer,p,24).fill(0);this.onexit.delete(p);return 0;
 }
 invoke(cpu,address){
  const name=LIFECYCLE_NAMES.find(n=>this.addresses[n]!==undefined&&BigInt(this.addresses[n])===address);if(!name)return super.invoke(cpu,address);
  let v=new DataView(this.memory.buffer);const a=v.getBigUint64(cpu+8,true),b=v.getBigUint64(cpu+16,true),sp=v.getBigUint64(cpu+32,true);this.range(sp,8);let result;
  if(name==='_initialize_onexit_table'){this.initializeOnexit(a);result=0;}
  else if(name==='_register_onexit_function')result=this.registerOnexit(a,b);
  else if(name==='_execute_onexit_table')result=this.executeOnexit(a);
  else{const p=this.range(a,8);if(v.getBigUint64(p,true)!==0n)throw Error('Nonempty guest condition-variable wait state is unsupported');this.wakes.set(p,(this.wakes.get(p)||0)+1);}
  v=new DataView(this.memory.buffer);if(result!==undefined)v.setBigUint64(cpu,BigInt.asUintN(32,BigInt(result)),true);
  this.calls.push(name);v.setBigUint64(cpu+192,v.getBigUint64(Number(sp),true),true);v.setBigUint64(cpu+32,sp+8n,true);
 }
}
