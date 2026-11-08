// Cooperative thread ownership/lifecycle. The service-entry adapter and UCRT
// DLL notifications must be verified before enabling this in live startup.
export class GuestThreadLifecycle {
 constructor(scheduler,{entry,returnAddress,tlsTemplate=new Uint8Array(),tlsZeroFill=0}={}){
  if(typeof entry!=='bigint'||typeof returnAddress!=='bigint')throw Error('Missing verified callback profile');
  this.scheduler=scheduler;this.services=scheduler.services;this.profile={entry,returnAddress,tlsTemplate:tlsTemplate.slice(),tlsZeroFill};this.handles=new Map();this.nextHandle=0x64000000n;
 }
 start({entry,argument,security=0n,stackSize=0,flags=0,idOutput=0n}={}){
  if(this.scheduler.disposed||this.scheduler.running)throw Error('Thread creation requires an idle scheduler boundary');
  if(entry!==this.profile.entry||security!==0n||stackSize!==0||flags!==0)throw Error('Unverified thread creation profile');
  if(typeof idOutput!=='bigint'||idOutput<0n)throw Error('Invalid thread ID output');
  if(idOutput)this.services.range(idOutput,4);
  const context=this.scheduler.createContext({...this.profile,argument});
  const handle=this.nextHandle++;this.handles.set(handle,context);
  if(idOutput)new DataView(this.services.memory.buffer).setUint32(Number(idOutput),context.id,true);
  return {handle,id:context.id,context};
 }
 poll(handle){const t=this.handles.get(handle);return !t?{result:0xffffffff,error:6}:t.status==='exited'?{result:0,error:0}:{result:258,error:0};}
 exitCode(handle){const t=this.handles.get(handle);return !t?{ok:false,error:6}:{ok:true,code:t.status==='exited'?t.exitCode:259,error:0};}
 close(handle){return this.handles.delete(handle)?{ok:true,error:0}:{ok:false,error:6};}
 finish(id,code){
  if(this.scheduler.running||this.scheduler.disposed)throw Error('Exit requires an idle dispatch boundary');
  const t=this.scheduler.threads.get(id);if(!t||t.status==='exited'||t.status==='disposed'||t.status==='failed')throw Error('Invalid thread exit');
  const value=Number(BigInt.asUintN(32,BigInt(code)));t.exitCode=value;t.status='exited';t.waitKey=null;
  return this.scheduler.wake('thread:'+id);
 }
}
