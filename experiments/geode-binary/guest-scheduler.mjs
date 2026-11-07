// Cooperative, synchronous scheduling foundation. No _beginthreadex shim is
// installed here: the real worker closure and CRT trampoline remain unverified.
export class GuestScheduler {
 constructor(services,{quantum=1000}={}){
  if(typeof SharedArrayBuffer!=='undefined'&&services.memory.buffer instanceof SharedArrayBuffer)throw Error('Guest scheduler requires non-shared memory');
  if(!Number.isInteger(quantum)||quantum<1||quantum>20000)throw Error('Invalid scheduler quantum');
  this.services=services;this.quantum=quantum;this.threads=new Map();this.nextId=1;this.running=false;this.disposed=false;
 }
 createContext({entry,argument=0n,returnAddress,tlsTemplate=new Uint8Array(),tlsZeroFill=0,stackSize=65536}={}){
  if(this.disposed||this.running)throw Error('Cannot create context in this scheduler state');
  const s=this.services,limit=BigInt(s.memory.buffer.byteLength);
  for(const p of [entry,returnAddress])if(typeof p!=='bigint'||p<=0n||p>=limit)throw Error('Invalid guest entry/return address');
  if(typeof argument!=='bigint'||argument<0n||argument>0xffffffffffffffffn)throw Error('Invalid guest argument');
  if(!(tlsTemplate instanceof Uint8Array)||!Number.isInteger(tlsZeroFill)||tlsZeroFill<0||tlsTemplate.length+tlsZeroFill>4096)throw Error('Invalid thread TLS template');
  if(!Number.isInteger(stackSize)||stackSize<4096||stackSize>1048576)throw Error('Invalid thread stack size');
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
