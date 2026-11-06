// UTF-8 code page only, with explicit Win32 lengths, flags and sizing semantics.
export function convertUtf8(name,memory,cpu,setLastError=()=>{}){
 const v=new DataView(memory.buffer),bytes=new Uint8Array(memory.buffer),arg=o=>v.getBigUint64(cpu+o,true),sp=arg(32);
 const at=(p,n)=>{if(p<=0n||p>0xffffffffn||n<0||Number(p)+n>v.byteLength)throw Error('NLS memory bounds');return Number(p);};
 const stack=at(sp,72),wide=name.toLowerCase().endsWith('widechartomultibyte'),cp=Number(arg(8)&0xffffffffn),flags=Number(arg(16)&0xffffffffn),source=arg(64),count=Number(BigInt.asIntN(32,arg(72))),out=v.getBigUint64(stack+40,true),capacity=Number(BigInt.asIntN(32,v.getBigUint64(stack+48,true)));
 if(cp!==65001)throw Error('UNMODELED_NLS_CODE_PAGE');let result=0,error;
 const defaults=wide&&(v.getBigUint64(stack+56,true)!==0n||v.getBigUint64(stack+64,true)!==0n);
 if(![0,wide?128:8].includes(flags))error=1004;
 else if(!source||!count||count< -1||capacity<0||defaults||(capacity&&!out))error=87;
 else{
  const width=wide?2:1;let length=count;
  if(count===-1){length=0;let terminated=false;for(;length<0x100000;length++){const p=at(source+BigInt(length*width),width);if((wide?v.getUint16(p,true):v.getUint8(p))===0){length++;terminated=true;break;}}if(!terminated)throw Error('UNMODELED_NLS_INPUT_SIZE');}
  if(length>0x100000)throw Error('UNMODELED_NLS_INPUT_SIZE');const start=at(source,length*width);let text;
  try{text=new TextDecoder(wide?'utf-16le':'utf-8',{fatal:flags!==0,ignoreBOM:true}).decode(bytes.subarray(start,start+length*width));}catch{error=1113;}
  if(!error){let encoded;
   if(wide)encoded=new TextEncoder().encode(text);else{encoded=new Uint8Array(text.length*2);const words=new DataView(encoded.buffer);for(let i=0;i<text.length;i++)words.setUint16(i*2,text.charCodeAt(i),true);}
   const units=encoded.length/(wide?1:2);
   if(!capacity)result=units;
   else if(capacity<units)error=122;
   else if(out<source+BigInt(length*width)&&source<out+BigInt(encoded.length))error=87;
   else{if(encoded.length)bytes.set(encoded,at(out,encoded.length));result=units;}
  }
 }
 if(error)setLastError(error);v.setBigUint64(cpu,BigInt(result),true);v.setBigUint64(cpu+192,v.getBigUint64(stack,true),true);v.setBigUint64(cpu+32,sp+8n,true);return result;
}
