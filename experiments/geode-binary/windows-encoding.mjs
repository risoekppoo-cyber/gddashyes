import {GuestCrt,CRT_NAMES} from './windows-crt.mjs';
export {CRT_NAMES};
export const ENCODING_NAMES=['WideCharToMultiByte','MultiByteToWideChar'];
export class GuestEncoding extends GuestCrt{
 invoke(cpu,address){
  const name=Object.keys(this.addresses).find(k=>BigInt(this.addresses[k])===address);
  if(!ENCODING_NAMES.includes(name))return super.invoke(cpu,address);
  const v=new DataView(this.memory.buffer),sp=v.getBigUint64(cpu+32,true);this.range(sp,72);
  const wide=name==='WideCharToMultiByte',page=Number(v.getBigUint64(cpu+8,true)&0xffffffffn),flags=Number(v.getBigUint64(cpu+16,true)&0xffffffffn);
  if(page!==65001)throw Error('Unsupported guest code page '+page);
  const input=v.getBigUint64(cpu+64,true),count=Number(BigInt.asIntN(32,v.getBigUint64(cpu+72,true)));
  const output=v.getBigUint64(Number(sp)+40,true),capacity=Number(BigInt.asIntN(32,v.getBigUint64(Number(sp)+48,true)));
  let result=0,error=0;
  if(flags!==0&&flags!==(wide?0x80:8))error=1004;
  else if(!input||count===0||count< -1||capacity<0||capacity>0&&!output||input===output||wide&&(v.getBigUint64(Number(sp)+56,true)!==0n||v.getBigUint64(Number(sp)+64,true)!==0n))error=87;
  else{
   const stride=wide?2:1;let n=count;
   if(n===-1){n=0;while(true){const p=this.range(input+BigInt(n*stride),stride);n++;if((wide?v.getUint16(p,true):v.getUint8(p))===0)break;}}
   const p=this.range(input,BigInt(n)*BigInt(stride)),bytes=new Uint8Array(this.memory.buffer,p,n*stride);
   let encoded;
   try{
    const text=new TextDecoder(wide?'utf-16le':'utf-8',{fatal:flags!==0,ignoreBOM:true}).decode(bytes);
    if(wide)encoded=new TextEncoder().encode(text);
    else{encoded=new Uint8Array(text.length*2);const d=new DataView(encoded.buffer);for(let i=0;i<text.length;i++)d.setUint16(i*2,text.charCodeAt(i),true);}
   }catch{error=1113;}
   if(encoded){
    const units=encoded.length/(wide?1:2);
    if(capacity===0)result=units;
    else if(capacity<units)error=122;
    else{const destination=this.range(output,BigInt(capacity)*BigInt(wide?1:2));new Uint8Array(this.memory.buffer,destination,encoded.length).set(encoded);result=units;}
   }
  }
  if(error)v.setUint32(this.tib+0x68,error,true);
  v.setBigUint64(cpu,BigInt(result),true);this.calls.push(name);
  v.setBigUint64(cpu+192,v.getBigUint64(Number(sp),true),true);v.setBigUint64(cpu+32,sp+8n,true);
 }
}
