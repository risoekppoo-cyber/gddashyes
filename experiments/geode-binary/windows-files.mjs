import {GuestPaths,fullWindowsPath,CRT_NAMES,ENCODING_NAMES,PATH_NAMES} from './windows-paths.mjs';
export {CRT_NAMES,ENCODING_NAMES,PATH_NAMES};
export const FILE_NAMES=['CreateFileW','GetFinalPathNameByHandleW','CloseHandle','SetCurrentDirectoryW','GetCurrentDirectoryW'];
export function gameFilesystem(fs){
 if(!fs||typeof fs.stat!=='function')throw Error('Game filesystem unavailable');
 return {stat(path){
  const root='C:\\GeometryDash';if(path.toLowerCase()!==root.toLowerCase()&&!path.toLowerCase().startsWith(root.toLowerCase()+'\\'))return null;
  let actual='/';
  try{
   for(const component of path.slice(root.length).split('\\').filter(Boolean)){
    const name=fs.readdir(actual).find(n=>n.toLowerCase()===component.toLowerCase());if(!name)return null;
    actual=(actual==='/'?'':actual)+'/'+name;
   }
   const s=fs.stat(actual);return {directory:fs.isDir(s.mode),path};
  }catch{return null;}
 }};
}
export class GuestFiles extends GuestPaths{
 constructor(memory,addresses,options={}){super(memory,addresses,options);this.filesystem=options.filesystem;this.handles=new Map();this.nextHandle=0x60000000n;}
 wide(pointer){let s='';for(let i=0;;i++){const p=this.range(pointer+BigInt(i*2),2),c=new DataView(this.memory.buffer).getUint16(p,true);if(!c)return s;s+=String.fromCharCode(c);}}
 invoke(cpu,address){
  const name=FILE_NAMES.find(n=>this.addresses[n]!==undefined&&BigInt(this.addresses[n])===address);
  if(!name)return super.invoke(cpu,address);
  const v=new DataView(this.memory.buffer),sp=v.getBigUint64(cpu+32,true),a=v.getBigUint64(cpu+8,true),b=v.getBigUint64(cpu+16,true),c=v.getBigUint64(cpu+64,true),d=v.getBigUint64(cpu+72,true);
  this.range(sp,name==='CreateFileW'?64:8);let result=0n,error=0;
  if(name==='SetCurrentDirectoryW'){
   if(!this.filesystem)throw Error('Guest filesystem is not configured');
   const path=fullWindowsPath(this.wide(a),this.cwd),item=path&&this.filesystem.stat(path);
   if(!item)error=3;else if(!item.directory)error=267;else{this.cwd=path;result=1n;}
  }else if(name==='GetCurrentDirectoryW'){
   const capacity=Number(a&0xffffffffn),text=this.cwd;
   if(capacity<=text.length)result=BigInt(text.length+1);
   else{const p=this.range(b,BigInt(capacity)*2n);for(let i=0;i<text.length;i++)v.setUint16(p+i*2,text.charCodeAt(i),true);v.setUint16(p+text.length*2,0,true);result=BigInt(text.length);}
  }else if(name==='CreateFileW'){
   const path=fullWindowsPath(this.wide(a),this.cwd),disposition=v.getUint32(Number(sp)+40,true),flags=v.getUint32(Number(sp)+48,true);
   if(b!==0n||disposition!==3||d!==0n)throw Error('Only existing metadata-only guest handles are implemented');
   if(!this.filesystem)throw Error('Guest filesystem is not configured');
   const item=path&&this.filesystem.stat(path);
   if(!item){result=0xffffffffffffffffn;error=3;}
   else if(item.directory&&!(flags&0x2000000)){result=0xffffffffffffffffn;error=5;}
   else{result=this.nextHandle++;this.handles.set(result,{...item,path});}
  }else if(name==='CloseHandle'){
   if(!this.handles.delete(a))error=6;else result=1n;
  }else{
   const item=this.handles.get(a),capacity=Number(c&0xffffffffn);
   if(!item)error=6;
   else{
    if(d!==0n&&d!==8n)throw Error('Unsupported guest final-path volume flags');
    const text='\\\\?\\'+item.path;
    if(capacity<=text.length)result=BigInt(text.length+1);
    else{const p=this.range(b,BigInt(capacity)*2n);for(let i=0;i<text.length;i++)v.setUint16(p+i*2,text.charCodeAt(i),true);v.setUint16(p+text.length*2,0,true);result=BigInt(text.length);}
   }
  }
  if(error)v.setUint32(this.tib+0x68,error,true);
  v.setBigUint64(cpu,result,true);this.calls.push(name);v.setBigUint64(cpu+192,v.getBigUint64(Number(sp),true),true);v.setBigUint64(cpu+32,sp+8n,true);
 }
}
