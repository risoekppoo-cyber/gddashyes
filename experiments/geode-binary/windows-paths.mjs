import {GuestEncoding,CRT_NAMES,ENCODING_NAMES} from './windows-encoding.mjs';
export {CRT_NAMES,ENCODING_NAMES};
export const PATH_NAMES=['GetFullPathNameW'];
export function fullWindowsPath(input,cwd='C:\\GeometryDash'){
 if(!input)return null;
 let value=input.replaceAll('/','\\');
 if(value.startsWith('\\\\'))throw Error('UNC/device paths are not configured in this virtual process');
 const trailing=value.endsWith('\\');let drive=cwd.slice(0,2),tail;
 if(/^[A-Za-z]:/.test(value)){
  drive=value.slice(0,2);tail=value.slice(2);
  if(!tail.startsWith('\\')){if(drive.toLowerCase()!==cwd.slice(0,2).toLowerCase())throw Error('Unknown drive-relative current directory');tail=cwd.slice(2)+'\\'+tail;}
 }else tail=value.startsWith('\\')?value:cwd.slice(2)+'\\'+value;
 const parts=[];
 for(const part of tail.split('\\')){if(!part||part==='.')continue;if(part==='..')parts.pop();else parts.push(part);}
 let result=drive+'\\'+parts.join('\\');
 if(trailing&&parts.length)result+='\\';
 else if(parts.length)result=result.replace(/[ .]+$/,'');
 return result;
}
export class GuestPaths extends GuestEncoding{
 invoke(cpu,address){
  if(this.addresses.GetFullPathNameW===undefined||address!==BigInt(this.addresses.GetFullPathNameW))return super.invoke(cpu,address);
  const v=new DataView(this.memory.buffer),sp=v.getBigUint64(cpu+32,true),input=v.getBigUint64(cpu+8,true),capacity=Number(v.getBigUint64(cpu+16,true)&0xffffffffn),output=v.getBigUint64(cpu+64,true),part=v.getBigUint64(cpu+72,true);
  this.range(sp,8);let text='';
  for(let n=0;;n++){const p=this.range(input+BigInt(n*2),2),c=v.getUint16(p,true);if(!c)break;text+=String.fromCharCode(c);}
  const full=fullWindowsPath(text);let result=0;
  if(full===null)v.setUint32(this.tib+0x68,123,true);
  else if(capacity<=full.length)result=full.length+1;
  else{
   const p=this.range(output,BigInt(capacity)*2n);
   if(part)this.range(part,8);
   for(let i=0;i<full.length;i++)v.setUint16(p+i*2,full.charCodeAt(i),true);v.setUint16(p+full.length*2,0,true);
   if(part)v.setBigUint64(Number(part),full.endsWith('\\')?0n:output+BigInt((full.lastIndexOf('\\')+1)*2),true);
   result=full.length;
  }
  v.setBigUint64(cpu,BigInt(result),true);this.calls.push('GetFullPathNameW');v.setBigUint64(cpu+192,v.getBigUint64(Number(sp),true),true);v.setBigUint64(cpu+32,sp+8n,true);
 }
}
