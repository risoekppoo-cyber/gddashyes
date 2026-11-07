import {GuestSrw} from './windows-srw.mjs';
// Virtual Windows process module catalogue; these are paths of the supplied
// game/DLL images, not paths on the browser user's host operating system.
export class GuestModules extends GuestSrw {
 constructor(memory,addresses,{imageBase,tib,processPath='C:\\GeometryDash\\GeometryDash.exe',dllPath='C:\\GeometryDash\\Geode.dll'}={}){
  super(memory,addresses);this.threadState={id:1,tib,errno:0};this.modules=new Map([[0n,processPath],[0x400000n,processPath]]);
  if(imageBase!==undefined)this.modules.set(BigInt(imageBase),dllPath);
 }
 get tib(){return this.threadState.tib;}
 get currentThreadId(){return this.threadState.id;}
 get errno(){return this.threadState.errno;}
 set errno(value){this.threadState.errno=value;}
 selectThread(state){
  if(!state||!Number.isInteger(state.id)||state.id<=0||state.id>0xffffffff||!Number.isSafeInteger(state.tib)||state.tib<=0||state.tib+0x6c>this.memory.buffer.byteLength||!Number.isInteger(state.errno))throw Error('Invalid guest thread state');
  this.threadState=state;
 }
 invoke(cpu,address){
  const name=Object.keys(this.addresses).find(k=>BigInt(this.addresses[k])===address);
  if(name==='AcquireSRWLockExclusive'||name==='ReleaseSRWLockExclusive')return super.invoke(cpu,address);
  if(!['GetModuleFileNameW','GetLastError','SetLastError'].includes(name))throw Error('Unimplemented module service');
  const v=new DataView(this.memory.buffer),sp=v.getBigUint64(cpu+32,true);
  if(sp>BigInt(v.byteLength-8))throw Error('Guest service return stack bounds');
  const error=this.tib+0x68;
  if(!Number.isSafeInteger(error)||error<0||error+4>v.byteLength)throw Error('Guest last-error storage bounds');
  if(name==='GetLastError')v.setBigUint64(cpu,BigInt(v.getUint32(error,true)),true);
  else if(name==='SetLastError')v.setUint32(error,Number(v.getBigUint64(cpu+8,true)&0xffffffffn),true);
  else{
   const path=this.modules.get(v.getBigUint64(cpu+8,true)),destination=v.getBigUint64(cpu+16,true),capacity=Number(v.getBigUint64(cpu+64,true)&0xffffffffn);
   let result=0;
   if(path===undefined)v.setUint32(error,126,true);
   else if(capacity===0)v.setUint32(error,122,true);
   else{
    if(destination>BigInt(v.byteLength)||BigInt(capacity)*2n>BigInt(v.byteLength)-destination)throw Error('Guest module filename buffer bounds');
    const count=Math.min(path.length,capacity-1),p=Number(destination);
    for(let i=0;i<count;i++)v.setUint16(p+i*2,path.charCodeAt(i),true);
    v.setUint16(p+count*2,0,true);
    result=path.length>=capacity?capacity:path.length;v.setUint32(error,path.length>=capacity?122:0,true);
   }
   v.setBigUint64(cpu,BigInt(result),true);
  }
  this.calls.push(name);v.setBigUint64(cpu+192,v.getBigUint64(Number(sp),true),true);v.setBigUint64(cpu+32,sp+8n,true);
 }
}
