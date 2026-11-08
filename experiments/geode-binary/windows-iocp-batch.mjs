import {GuestMsvcMutex} from './windows-msvc-mutex.mjs';
export const IOCP_BATCH_NAMES=['GetQueuedCompletionStatusEx'];
// Observed x64 profile: up to 64 entries, timeout zero, non-alertable.
// This consumes real owned packets; it does not implement blocking/APC waits.
export class GuestIocpBatch extends GuestMsvcMutex{
 constructor(memory,addresses,options={}){super(memory,addresses,options);this.batchPolls=[];}
 batchSnapshot(){return this.batchPolls.map(p=>({...p,packetStatuses:[...p.packetStatuses]}));}
 invoke(cpu,address){
  if(this.addresses.GetQueuedCompletionStatusEx===undefined||BigInt(this.addresses.GetQueuedCompletionStatusEx)!==address)return super.invoke(cpu,address);
  const v=new DataView(this.memory.buffer),portHandle=v.getBigUint64(cpu+8,true),entries=v.getBigUint64(cpu+16,true),capacity=v.getUint32(cpu+64,true),removed=v.getBigUint64(cpu+72,true),sp=v.getBigUint64(cpu+32,true);
  this.range(sp,56);const timeout=v.getUint32(Number(sp)+40,true),alertable=v.getUint32(Number(sp)+48,true);
  if(timeout!==0||alertable!==0)throw Error('Batch completion wait/APC dispatch requires scheduler support');
  if(capacity>64)throw Error('Unsupported completion batch capacity');
  this.range(entries,capacity*32);this.range(removed,4);
  if(capacity&&entries<removed+4n&&removed<entries+BigInt(capacity*32))throw Error('Overlapping completion batch outputs');
  const port=this.ports.get(portHandle);let error=0,result=0n,n=0,packets=[];
  if(capacity===0)error=87; // Native invalid-parameter path preserves outputs.
  else if(!port)error=6; // Native invalid-handle path preserves removed count.
  else if(!port.queue.length){v.setUint32(Number(removed),0,true);error=258;}
  else{
   packets=port.queue.slice(0,capacity).map(p=>{
    const status=p.status??(p.error===0?0n:undefined);
    if(!Number.isInteger(p.bytes)||p.bytes<0||p.bytes>0xffffffff||[p.key,p.ov,status].some(x=>typeof x!=='bigint'||x<0n||x>0xffffffffffffffffn))throw Error('Unverified completion packet status or payload');
    return {...p,status};
   });
   n=packets.length;
   packets.forEach((p,i)=>{const at=Number(entries)+32*i;v.setBigUint64(at,p.key,true);v.setBigUint64(at+8,p.ov,true);v.setBigUint64(at+16,p.status,true);v.setBigUint64(at+24,BigInt(p.bytes),true);});
   v.setUint32(Number(removed),n,true);port.queue.splice(0,n);result=1n;
  }
  if(error)v.setUint32(this.tib+0x68,error,true);
  this.batchPolls.push({port:String(portHandle),capacity,removed:n,error,timeoutMs:timeout,alertable,packetStatuses:packets.map(p=>String(p.status))});
  v.setBigUint64(cpu,result,true);this.calls.push('GetQueuedCompletionStatusEx');v.setBigUint64(cpu+192,v.getBigUint64(Number(sp),true),true);v.setBigUint64(cpu+32,sp+8n,true);
 }
}
