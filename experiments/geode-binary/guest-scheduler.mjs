// Cooperative, synchronous scheduling foundation. No _beginthreadex shim is
// installed here: the real worker closure and CRT trampoline remain unverified.
export class GuestScheduler {
 constructor(services,{quantum=1000,firstId=1}={}){
  if(typeof SharedArrayBuffer!=='undefined'&&services.memory.buffer instanceof SharedArrayBuffer)throw Error('Guest scheduler requires non-shared memory');
  if(!Number.isInteger(quantum)||quantum<1||quantum>20000)throw Error('Invalid scheduler quantum');
  if(!Number.isInteger(firstId)||firstId<1||firstId>0xffffffff)throw Error('Invalid first guest thread ID');
  this.services=services;this.quantum=quantum;this.threads=new Map();this.nextId=firstId;this.running=false;this.disposed=false;
 }
 createContext({entry,argument=0n,returnAddress,tlsTemplate=new Uint8Array(),tlsZeroFill=0,stackSize=65536}={}){
  if(this.disposed||this.running)throw Error('Cannot create context in this scheduler state');
  const s=this.services,limit=BigInt(s.memory.buffer.byteLength);
  for(const p of [entry,returnAddress])if(typeof p!=='bigint'||p<=0n||p>=limit)throw Error('Invalid guest entry/return address');
  if(typeof argument!=='bigint'||argument<0n||argument>0xffffffffffffffffn)throw Error('Invalid guest argument');
  if(!(tlsTemplate instanceof Uint8Array)||!Number.isInteger(tlsZeroFill)||tlsZeroFill<0||tlsTemplate.length+tlsZeroFill>4096)throw Error('Invalid thread TLS template');
  if(!Number.isInteger(stackSize)||stackSize<4096||stackSize>1048576)throw Error('Invalid thread stack size');
  while(this.threads.has(this.nextId))this.nextId++;
  if(this.nextId>0xffffffff)throw Error('Guest thread IDs exhausted');
  // Copy before allocation: malloc may grow memory and detach the source view.
  const template=tlsTemplate.slice(),allocations=[];
  const alloc=n=>{const p=s.allocate(BigInt(n),true);if(!p)throw Error('Guest context allocation failed');allocations.push(p);return Number(p);};
  try{
   const cpu=alloc(4096),tib=alloc(0x4000),stack=alloc(stackSize),id=this.nextId++;
   const sp=Math.floor((stack+stackSize-64)/16)*16-8,v=new DataView(s.memory.buffer),tls=tib+0x2000;
   v.setBigUint64(cpu+8,argument,true);v.setBigUint64(cpu+32,BigInt(sp),true);v.setBigUint64(cpu+192,entry,true);v.setBigUint64(cpu+2328,BigInt(tib),true);v.setBigUint64(sp,returnAddress,true);
   v.setBigUint64(tib+8,BigInt(stack+stackSize),true);v.setBigUint64(tib+16,BigInt(stack),true);v.setBigUint64(tib+0x30,BigInt(tib),true);
   v.setBigUint64(tib+0x40,1n,true);v.setBigUint64(tib+0x48,BigInt(id),true);v.setBigUint64(tib+0x58,BigInt(tib+0x1000),true);v.setBigUint64(tib+0x1000,BigInt(tls),true);
   new Uint8Array(s.memory.buffer,tls,template.length).set(template);
   const t={id,cpu,tib,stack,stackSize,tls,errno:0,status:'runnable',waitKey:null,steps:0,allocations};this.threads.set(id,t);return t;
  }catch(error){for(const p of allocations.reverse())try{s.free(p);}catch{}throw error;}
 }
 adoptContext({id,cpu,tib,stack,stackSize=65536,tibSize=0x4000,errno=0}={}){
  if(this.disposed||this.running||!Number.isInteger(id)||id<1||id>0xffffffff||this.threads.has(id))throw Error('Invalid retained context adoption');
  if(tibSize<0x60||stackSize<8||!Number.isInteger(errno)||errno< -2147483648||errno>2147483647)throw Error('Invalid retained context layout');
  const ranges=[[cpu,4096],[tib,tibSize],[stack,stackSize]],s=this.services;
  for(const [p,n] of ranges){if(!Number.isSafeInteger(p)||p<=0||!Number.isSafeInteger(n)||n<=0)throw Error('Invalid retained context range');s.range(BigInt(p),n);}
  const overlaps=(a,b)=>a[0]<b[0]+b[1]&&b[0]<a[0]+a[1];
  for(let i=0;i<ranges.length;i++)for(let j=0;j<i;j++)if(overlaps(ranges[i],ranges[j]))throw Error('Overlapping retained context');
  for(const t of this.threads.values())for(const r of ranges)for(const p of [[t.cpu,4096],[t.tib,t.tibSize??0x4000],[t.stack,t.stackSize]])if(overlaps(r,p))throw Error('Context storage already registered');
  const v=new DataView(s.memory.buffer),sp=v.getBigUint64(cpu+32,true);
  if(v.getBigUint64(cpu+2328,true)!==BigInt(tib)||v.getBigUint64(tib+0x48,true)!==BigInt(id)||sp<BigInt(stack)||sp>BigInt(stack+stackSize-8))throw Error('Retained CPU/TIB identity mismatch');
  const tlsArray=v.getBigUint64(tib+0x58,true);s.range(tlsArray,8);const tls=v.getBigUint64(Number(tlsArray),true);s.range(tls,1);
  const t={id,cpu,tib,tibSize,stack,stackSize,tls:Number(tls),errno,status:'runnable',waitKey:null,steps:0,allocations:[],borrowed:true};
  this.threads.set(id,t);while(this.threads.has(this.nextId))this.nextId++;return t;
 }
 runRound(execute){
  if(this.disposed||this.running||typeof execute!=='function')throw Error('Invalid scheduler dispatch');
  const s=this.services,previous=s.threadState;this.running=true;let steps=0;
  try{
   for(const t of this.threads.values()){
    if(t.status!=='runnable')continue;s.selectThread(t);
    try{
     const r=execute(t,this.quantum);
     if(!r||typeof r.then==='function'||!Number.isInteger(r.steps)||r.steps<1||r.steps>this.quantum||!['runnable','blocked','exited'].includes(r.state))throw Error('Invalid bounded guest slice');
     if(r.state==='blocked'&&(r.waitKey===null||r.waitKey===undefined))throw Error('Blocked guest thread needs a wait key');
     t.steps+=r.steps;steps+=r.steps;t.status=r.state;t.waitKey=r.state==='blocked'?r.waitKey:null;
     if(r.state==='exited')t.exitCode=Number(BigInt.asUintN(32,BigInt(r.exitCode??0)));
    }catch(error){t.status='failed';t.error=String(error);throw error;}
   }
  }finally{s.threadState=previous;this.running=false;}
  return steps;
 }
 wake(key){if(this.disposed)throw Error('Disposed guest scheduler');let count=0;for(const t of this.threads.values())if(t.status==='blocked'&&Object.is(t.waitKey,key)){t.status='runnable';t.waitKey=null;count++;}return count;}
 dispose(){
  if(this.running)throw Error('Cannot dispose a running guest scheduler');if(this.disposed)return;this.disposed=true;let first;
  for(const t of this.threads.values()){for(const p of t.allocations.splice(0))try{this.services.free(p);}catch(error){first??=error;}t.status='disposed';}
  if(first)throw first;
 }
}
