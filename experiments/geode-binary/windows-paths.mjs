// Lexical C-drive paths only; this provider does not test file existence.
export function fullPath(value){
 value=value.replaceAll('/','\\');if(!value||value.startsWith('\\\\')||value.includes('\0'))throw Error('UNMODELED_WINDOWS_PATH');
 let drive='C:',tail=value;if(/^[A-Za-z]:/.test(value)){drive=value.slice(0,2);tail=value.slice(2);if(drive.toLowerCase()!=='c:')throw Error('UNMODELED_WINDOWS_DRIVE');}
 const parts=tail.startsWith('\\')?[]:['WestminsterDash'];
 for(const part of tail.split('\\')){
  if(/[*?"<>|:]/.test(part)||(part!=='.'&&part!=='..'&&/[ .]$/.test(part)))throw Error('UNMODELED_WINDOWS_PATH');
  if(!part||part==='.')continue;if(part==='..'){parts.pop();continue;}parts.push(part);
 }
 let result=drive+'\\'+parts.join('\\');if(value.endsWith('\\')&&!result.endsWith('\\'))result+='\\';return result;
}
export function getFullPathNameW(memory,cpu){
 const v=new DataView(memory.buffer),arg=o=>v.getBigUint64(cpu+o,true),source=arg(8),capacity=Number(arg(16)&0xffffffffn),out=arg(64),part=arg(72),sp=arg(32);
 const at=(p,n)=>{if(p<=0n||p>0xffffffffn||Number(p)+n>v.byteLength)throw Error('Path memory bounds');return Number(p);};
 let text='',terminated=false;for(let i=0;i<32768;i++){const ch=v.getUint16(at(source+BigInt(i*2),2),true);if(!ch){terminated=true;break;}text+=String.fromCharCode(ch);}if(!terminated)throw Error('UNMODELED_WINDOWS_PATH_SIZE');
 const result=fullPath(text);let count=result.length+1;
 if(capacity>result.length){const p=at(out,(result.length+1)*2);for(let i=0;i<result.length;i++)v.setUint16(p+i*2,result.charCodeAt(i),true);v.setUint16(p+result.length*2,0,true);count=result.length;
  if(part)v.setBigUint64(at(part,8),result.endsWith('\\')?0n:out+BigInt((result.lastIndexOf('\\')+1)*2),true);
 }
 const stack=at(sp,8);v.setBigUint64(cpu,BigInt(count),true);v.setBigUint64(cpu+192,v.getBigUint64(stack,true),true);v.setBigUint64(cpu+32,sp+8n,true);return count;
}
