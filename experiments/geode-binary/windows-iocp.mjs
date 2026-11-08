import {GuestCritical} from './windows-critical.mjs';
export const IOCP_NAMES=['CreateIoCompletionPort','PostQueuedCompletionStatus','GetQueuedCompletionStatus'];
export class GuestIocp extends GuestCritical{
 constructor(memory,addresses,options={}){super(memory,addresses,options);this.ports=new Map();this.associations=new Map();this.nextPort=0x63000000n;}
 createPort(file,existing,key,concurrency){
  if(file===0xffffffffffffffffn&&existing)return {value:0n,error:87};
  if(existing&&!this.ports.has(existing))return {value:0n,error:6};
  if(file!==0xffffffffffffffffn){const end=this.pipeEnds.get(file);if(!end||end.side!=='server')throw Error('Guest completion ports require an owned overlapped pipe');if(this.associations.has(file))return {value:0n,error:87};}
  let port=existing;if(!port){port=this.nextPort++;this.ports.set(port,{concurrency,queue:[]});}
  if(file!==0xffffffffffffffffn)this.associations.set(file,{port,key});return {value:port,error:0};
 }
 complete(request,data,error=0){super.complete(request,data,error);const a=this.associations.get(request.handle),port=a&&this.ports.get(a.port);if(port)port.queue.push({bytes:data.length,key:a.key,ov:request.ov,error,status:BigInt(this.ioResults.get(request.ov).status)});}
 closePipe(handle){const result=super.closePipe(handle);this.associations.delete(handle);return result;}
 iocpSnapshot(){return {ports:[...this.ports].map(([h,p])=>({handle:String(h),concurrency:p.concurrency,queue:p.queue.map(q=>({bytes:q.bytes,key:String(q.key),ov:String(q.ov),error:q.error}))})),associations:[...this.associations].map(([h,a])=>[String(h),String(a.port),String(a.key)])};}
 invoke(cpu,address){
  const names=[...IOCP_NAMES,'CloseHandle'],name=names.find(n=>this.addresses[n]!==undefined&&BigInt(this.addresses[n])===address);if(!name)return super.invoke(cpu,address);
  const v=new DataView(this.memory.buffer),a=v.getBigUint64(cpu+8,true),b=v.getBigUint64(cpu+16,true),c=v.getBigUint64(cpu+64,true),d=v.getBigUint64(cpu+72,true),sp=v.getBigUint64(cpu+32,true);this.range(sp,8);let result=0n,error=0;
  if(name==='CloseHandle'){if(!this.ports.has(a))return super.invoke(cpu,address);this.ports.delete(a);result=1n;}
  else if(name==='CreateIoCompletionPort')({value:result,error}=this.createPort(a,b,c,Number(d&0xffffffffn)));
  else if(name==='PostQueuedCompletionStatus'){const port=this.ports.get(a);if(!port)error=6;else{port.queue.push({bytes:Number(b&0xffffffffn),key:c,ov:d,error:0});result=1n;}}
  else{
   this.range(sp,48);this.range(b,4);this.range(c,8);this.range(d,8);const port=this.ports.get(a),timeout=v.getUint32(Number(sp)+40,true);
   if(!port){v.setBigUint64(Number(d),0n,true);error=6;}
   else if(!port.queue.length){if(timeout)throw Error('Blocking completion-port wait requires a guest scheduler');v.setBigUint64(Number(d),0n,true);error=258;}
   else{const packet=port.queue.shift();v.setUint32(Number(b),packet.bytes,true);v.setBigUint64(Number(c),packet.key,true);v.setBigUint64(Number(d),packet.ov,true);error=packet.error;result=error?0n:1n;}
  }
  if(error)v.setUint32(this.tib+0x68,error,true);v.setBigUint64(cpu,result,true);this.calls.push(name);v.setBigUint64(cpu+192,v.getBigUint64(Number(sp),true),true);v.setBigUint64(cpu+32,sp+8n,true);
 }
 releaseHeap(){this.ports.clear();super.releaseHeap();this.associations.clear();}
}
