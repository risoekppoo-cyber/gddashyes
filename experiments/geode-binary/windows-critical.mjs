import {GuestPipes} from './windows-pipes.mjs';
export const CRITICAL_NAMES=['InitializeCriticalSection','EnterCriticalSection','LeaveCriticalSection','TryEnterCriticalSection','DeleteCriticalSection','InitializeConditionVariable','WakeConditionVariable'];
// Native-checked uncontended profile for the current single logical thread.
// This does not implement blocking or a general kernel critical-section ABI.
export class GuestCritical extends GuestPipes{
 constructor(memory,addresses,options={}){super(memory,addresses,options);this.critical=new Map();}
 criticalSnapshot(){return [...this.critical].map(([p,c])=>[p,c.owner,c.recursion]);}
 invoke(cpu,address){
  const name=CRITICAL_NAMES.find(n=>this.addresses[n]!==undefined&&BigInt(this.addresses[n])===address);if(!name)return super.invoke(cpu,address);
  const v=new DataView(this.memory.buffer),a=v.getBigUint64(cpu+8,true),sp=v.getBigUint64(cpu+32,true),condition=name.includes('ConditionVariable'),p=this.range(a,condition?8:40);this.range(sp,8);if(a%8n)throw Error('Unaligned guest critical section');let entry=this.critical.get(p),result;
  if(condition){if(name==='InitializeConditionVariable')v.setBigUint64(p,0n,true);else{if(v.getBigUint64(p,true)!==0n)throw Error('Condition-variable waiter dispatch requires a scheduler');this.wakes.set(p,(this.wakes.get(p)||0)+1);}}
  else if(name==='InitializeCriticalSection'){if(entry)throw Error('Guest critical section already initialized');entry={owner:0,recursion:0};this.critical.set(p,entry);}
  else{
   if(!entry)throw Error('Uninitialized guest critical section');
   if(name==='DeleteCriticalSection'){if(entry.recursion)throw Error('Cannot delete owned guest critical section');this.critical.delete(p);new Uint8Array(this.memory.buffer,p,40).fill(0);}
   else if(name==='LeaveCriticalSection'){if(entry.owner!==1||!entry.recursion)throw Error('Unowned guest critical-section leave');if(--entry.recursion===0)entry.owner=0;}
   else if(entry.owner&&entry.owner!==1){if(name==='TryEnterCriticalSection')result=0n;else throw Error('Contended guest critical section needs a scheduler');}
   else{if(entry.recursion===0x7fffffff)throw Error('Guest critical-section recursion limit');entry.owner=1;entry.recursion++;if(name==='TryEnterCriticalSection')result=1n;}
  }
  if(!condition&&name!=='DeleteCriticalSection'){v.setBigUint64(p,0xffffffffffffffffn,true);v.setInt32(p+8,entry.recursion?-2:-1,true);v.setUint32(p+12,entry.recursion,true);v.setBigUint64(p+16,BigInt(entry.owner),true);v.setBigUint64(p+24,0n,true);v.setBigUint64(p+32,0x20007d0n,true);}
  if(result!==undefined)v.setBigUint64(cpu,result,true);this.calls.push(name);v.setBigUint64(cpu+192,v.getBigUint64(Number(sp),true),true);v.setBigUint64(cpu+32,sp+8n,true);
 }
}
