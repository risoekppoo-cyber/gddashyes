import {GuestPerformanceClock} from './windows-performance-clock.mjs';
export const MSVC_MUTEX_NAMES=['_Mtx_init_in_situ','_Mtx_destroy_in_situ','_Mtx_lock','_Mtx_trylock','_Mtx_unlock','_Mtx_current_owns'];
// Pinned MSVC x64 ABI profile verified on a real Windows runner. Not a generic
// pthread mutex or a claim that every CRT version uses these private fields.
export class GuestMsvcMutex extends GuestPerformanceClock{
 constructor(memory,addresses,options={}){super(memory,addresses,options);this.msvcMutexes=new Map();this.disposingMutexes=false;}
 resolve(item){if(item.dll.toLowerCase()==='msvcp140.dll'&&MSVC_MUTEX_NAMES.includes(item.name)){const p=this.addresses[item.name];return p===undefined?undefined:BigInt(p);}return super.resolve(item);}
 mutexSnapshot(){return [...this.msvcMutexes].map(([p,m])=>[p,m.type,m.owner,m.count]);}
 mutexAddress(a){const p=this.range(a,80);if(p%8)throw Error('Unaligned MSVC mutex');return p;}
 mutexRecord(p){
  const v=new DataView(this.memory.buffer);let m=this.msvcMutexes.get(p);
  if(!m){
   const type=v.getInt32(p,true);
   if(![2,0x102].includes(type)||v.getBigUint64(p+8,true)!==0n||v.getBigUint64(p+16,true)!==0n||v.getInt32(p+72,true)!==-1||v.getInt32(p+76,true)!==0||this.held.has(p+16))throw Error('Unverified MSVC mutex initializer');
   m={type,owner:-1,count:0};this.msvcMutexes.set(p,m);
  }
  if(v.getInt32(p,true)!==m.type||v.getBigUint64(p+8,true)!==0n||v.getInt32(p+72,true)!==m.owner||v.getInt32(p+76,true)!==m.count||v.getBigUint64(p+16,true)!==(m.count?1n:0n)||this.held.has(p+16)!==(m.count!==0)||m.count&&this.srwOwners.get(p+16)!==m.owner)throw Error('MSVC mutex state mismatch');
  return m;
 }
 invoke(cpu,address){
  const name=MSVC_MUTEX_NAMES.find(n=>this.addresses[n]!==undefined&&BigInt(this.addresses[n])===address);if(!name)return super.invoke(cpu,address);
  const v=new DataView(this.memory.buffer),sp=v.getBigUint64(cpu+32,true),p=this.mutexAddress(v.getBigUint64(cpu+8,true));this.range(sp,8);if(this.currentThreadId>0x7fffffff)throw Error('Unsupported MSVC thread identity');let result;
  if(name==='_Mtx_init_in_situ'){
   const type=v.getInt32(cpu+16,true);if(![2,0x102].includes(type))throw Error('Unsupported MSVC mutex type');
   if(this.msvcMutexes.has(p)||this.held.has(p+16))throw Error('MSVC mutex already initialized');
   v.setInt32(p,type,true);v.setBigUint64(p+8,0n,true);v.setBigUint64(p+16,0n,true);v.setInt32(p+72,-1,true);v.setInt32(p+76,0,true);this.msvcMutexes.set(p,{type,owner:-1,count:0});
  }else{
   const m=this.mutexRecord(p);
   if(name==='_Mtx_destroy_in_situ'){if(m.count)throw Error('Cannot destroy owned MSVC mutex');this.msvcMutexes.delete(p);}
   else if(name==='_Mtx_current_owns')result=m.count&&m.owner===this.currentThreadId?1n:0n;
   else if(name==='_Mtx_unlock'){
    if(m.owner!==this.currentThreadId||!m.count)throw Error('Unowned MSVC mutex unlock');
    if(--m.count===0){m.owner=-1;this.held.delete(p+16);this.srwOwners.delete(p+16);v.setBigUint64(p+16,0n,true);}result=0n;
   }else if(m.count&&m.owner!==this.currentThreadId){
    if(name==='_Mtx_trylock')result=3n;else throw Error('Contended MSVC mutex requires scheduler blocking');
   }else if(m.count&&m.type===2)result=3n;
   else{
    if(m.count===0x7fffffff)throw Error('MSVC mutex recursion limit');
    if(!m.count){m.owner=this.currentThreadId;this.held.add(p+16);this.srwOwners.set(p+16,m.owner);v.setBigUint64(p+16,1n,true);}m.count++;result=0n;
   }
   if(name!=='_Mtx_destroy_in_situ'){v.setInt32(p+72,m.owner,true);v.setInt32(p+76,m.count,true);}
  }
  if(result!==undefined)v.setBigUint64(cpu,result,true);this.calls.push(name);v.setBigUint64(cpu+192,v.getBigUint64(Number(sp),true),true);v.setBigUint64(cpu+32,sp+8n,true);
 }
 free(pointer){
  const allocation=this.heap.get(Number(pointer)),inside=allocation?[...this.msvcMutexes.keys()].filter(p=>p>=Number(pointer)&&p<Number(pointer)+allocation.size):[];
  if(!this.disposingMutexes&&inside.some(p=>this.msvcMutexes.get(p).count))throw Error('Cannot free owned MSVC mutex');
  super.free(pointer);for(const p of inside){this.msvcMutexes.delete(p);this.held.delete(p+16);this.srwOwners.delete(p+16);}
 }
 releaseHeap(){
  this.disposingMutexes=true;let first;try{super.releaseHeap();}catch(error){first=error;}
  for(const p of this.msvcMutexes.keys()){this.held.delete(p+16);this.srwOwners.delete(p+16);}this.msvcMutexes.clear();this.disposingMutexes=false;if(first)throw first;
 }
}
