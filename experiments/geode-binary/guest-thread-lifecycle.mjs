// Cooperative thread ownership/lifecycle. The service-entry adapter and UCRT
// DLL notifications must be verified before enabling this in live startup.
export class GuestThreadLifecycle {
 constructor(scheduler,{entry,returnAddress,tlsTemplate=new Uint8Array(),tlsZeroFill=0}={}){
  if(typeof entry!=='bigint'||typeof returnAddress!=='bigint')throw Error('Missing verified callback profile');
  this.scheduler=scheduler;this.services=scheduler.services;this.profile={entry,returnAddress,tlsTemplate:tlsTemplate.slice(),tlsZeroFill};this.handles=new Map();this.created=new Set();this.nextHandle=0x64000000n;
 }
 start({entry,argument=0n,security=0n,stackSize=0,flags=0,idOutput=0n,existingContext}={}){
  if(this.scheduler.disposed||this.scheduler.running)throw Error('Thread creation requires an idle scheduler boundary');
  if(entry!==this.profile.entry||security!==0n||stackSize!==0||flags!==0)throw Error('Unverified thread creation profile');
  if(typeof idOutput!=='bigint'||idOutput<0n)throw Error('Invalid thread ID output');
  if(idOutput)this.services.range(idOutput,4);
  if(existingContext&&(this.scheduler.threads.get(existingContext.id)!==existingContext||existingContext.entry!==entry||existingContext.argument!==argument||!['runnable','blocked','exited'].includes(existingContext.status)))throw Error('Unverified existing callback context');
  if(existingContext&&this.created.has(existingContext.id))throw Error('Callback already has a creation handle');
  const context=existingContext??this.scheduler.createContext({...this.profile,argument});
  const handle=this.nextHandle++;this.handles.set(handle,context);this.created.add(context.id);
  if(idOutput)new DataView(this.services.memory.buffer).setUint32(Number(idOutput),context.id,true);
  return {handle,id:context.id,context};
 }
 completeStart(cpu,imageBase,existingContext){
  const s=this.services,v=new DataView(s.memory.buffer),sp=v.getBigUint64(cpu+32,true);
  s.range(sp,56);if(v.getBigUint64(cpu+192,true)!==BigInt(s.addresses._beginthreadex))throw Error('Not at thread API entry');
  const ret=v.getBigUint64(Number(sp),true),idOutput=v.getBigUint64(Number(sp)+48,true);
  if(ret<BigInt(imageBase)||ret>=BigInt(imageBase+17035264))throw Error('Unverified thread return address');
  const result=this.start({entry:v.getBigUint64(cpu+64,true),argument:v.getBigUint64(cpu+72,true),security:v.getBigUint64(cpu+8,true),stackSize:v.getUint32(cpu+16,true),flags:v.getUint32(Number(sp)+40,true),idOutput,existingContext});
  const after=new DataView(s.memory.buffer);after.setBigUint64(cpu,result.handle,true);after.setBigUint64(cpu+192,ret,true);after.setBigUint64(cpu+32,sp+8n,true);s.calls.push('_beginthreadex');return result;
 }
 closeCall(cpu,address){
  const s=this.services,v=new DataView(s.memory.buffer),handle=v.getBigUint64(cpu+8,true);
  if(address!==BigInt(s.addresses.CloseHandle)||!this.handles.has(handle))return false;
  const sp=v.getBigUint64(cpu+32,true);s.range(sp,8);const ret=v.getBigUint64(Number(sp),true);
  this.close(handle);v.setBigUint64(cpu,1n,true);v.setBigUint64(cpu+192,ret,true);v.setBigUint64(cpu+32,sp+8n,true);s.calls.push('CloseHandle');return true;
 }
 lookup(handle){if(this.scheduler.disposed)throw Error('Disposed thread runtime');const t=this.handles.get(handle);if(t&&['failed','disposed'].includes(t.status))throw Error('Failed thread cannot be polled as live');return t;}
 poll(handle){const t=this.lookup(handle);return !t?{result:0xffffffff,error:6}:t.status==='exited'?{result:0,error:0}:{result:258,error:0};}
 exitCode(handle){const t=this.lookup(handle);return !t?{ok:false,error:6}:{ok:true,code:t.status==='exited'?t.exitCode:259,error:0};}
 close(handle){return this.handles.delete(handle)?{ok:true,error:0}:{ok:false,error:6};}
 finish(id,code){
  if(this.scheduler.running||this.scheduler.disposed)throw Error('Exit requires an idle dispatch boundary');
  const t=this.scheduler.threads.get(id);if(!t||t.status==='exited'||t.status==='disposed'||t.status==='failed')throw Error('Invalid thread exit');
  const value=Number(BigInt.asUintN(32,BigInt(code)));t.exitCode=value;t.status='exited';t.waitKey=null;
  return this.scheduler.wake('thread:'+id);
 }
}

