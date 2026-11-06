export class ExecutableMemory {
 constructor(memory){this.memory=memory;this.base=0x15000000;this.size=0x200000;this.cursor=this.base;this.allocations=[];if(this.base+this.size>memory.buffer.byteLength)throw Error('Executable arena bounds');new Uint8Array(memory.buffer,this.base,this.size).fill(0);}
 invoke(memory,cpu,setLastError){const v=new DataView(memory.buffer),address=v.getBigUint64(cpu+8,true),size=v.getBigUint64(cpu+16,true),kind=Number(v.getBigUint64(cpu+64,true)&0xffffffffn),protection=Number(v.getBigUint64(cpu+72,true)&0xffffffffn),sp=v.getBigUint64(cpu+32,true);let result=0n;
  if(address||kind!==0x3000||protection!==0x40)throw Error('UNMODELED_EXECUTABLE_ALLOCATION');
  if(!size)setLastError(87);
  else if(size>BigInt(this.size))setLastError(8);
  else{const requested=Number(size),committed=Math.ceil(requested/4096)*4096,reserved=Math.ceil(requested/65536)*65536;if(this.cursor+reserved>this.base+this.size)setLastError(8);
   else{result=BigInt(this.cursor);this.allocations.push({base:this.cursor,requested,committed,reserved,protection,writeRoutingPending:true});this.cursor+=reserved;}}
  if(sp<=0n||sp>0xffffffffn||Number(sp)+8>v.byteLength)throw Error('Executable allocation stack bounds');v.setBigUint64(cpu,result,true);v.setBigUint64(cpu+192,v.getBigUint64(Number(sp),true),true);v.setBigUint64(cpu+32,sp+8n,true);return result;
 }
 snapshot(){return {base:this.base,size:this.size,cursor:this.cursor,allocations:this.allocations};}
}
