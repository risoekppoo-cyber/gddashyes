// A bounded guest arena for CRT on-exit callback arrays. Not a general heap.
export class OnExitTables {
 constructor(base=0x500000,size=0x100000){this.base=base;this.end=base+size;this.next=base;this.registrations=0;}
 register(memory,cpu){
  const v=new DataView(memory.buffer),p=v.getBigUint64(cpu+8,true),fn=v.getBigUint64(cpu+16,true),sp=v.getBigUint64(cpu+32,true);
  const linear=(p,n)=>{if(p<0n||p>0xffffffffn||Number(p)+n>v.byteLength)throw Error('CRT table outside memory');return Number(p);};
  const ret=v.getBigUint64(linear(sp,8),true);let result=0n;
  if(!p)result=0xffffffffn;
  else {
   const table=linear(p,24);let first=v.getBigUint64(table,true),last=v.getBigUint64(table+8,true),end=v.getBigUint64(table+16,true);
   if(first>last||last>end||(last-first)%8n)throw Error('Invalid CRT callback table');
   if(last===end){
    const count=Number((last-first)/8n),capacity=Math.max(8,count*2+1),bytes=capacity*8,at=this.next;
    if(capacity>10000||at+bytes>this.end)result=0xffffffffn;
    else {
     linear(BigInt(at),bytes);const old=first?new Uint8Array(memory.buffer,linear(first,count*8),count*8).slice():new Uint8Array();
     new Uint8Array(memory.buffer,at,bytes).fill(0);new Uint8Array(memory.buffer,at,old.length).set(old);
     this.next+=bytes;first=BigInt(at);last=first+BigInt(count*8);end=first+BigInt(bytes);
    }
   }
   if(!result){v.setBigUint64(linear(last,8),fn,true);last+=8n;
    v.setBigUint64(table,first,true);v.setBigUint64(table+8,last,true);v.setBigUint64(table+16,end,true);this.registrations++;}
  }
  v.setBigUint64(cpu,result,true);v.setBigUint64(cpu+32,sp+8n,true);v.setBigUint64(cpu+192,ret,true);
 }
}
