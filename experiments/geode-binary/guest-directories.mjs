import {fullPath} from './windows-paths.mjs';
export class GuestDirectories {
 constructor(modules){this.dirs=new Map();this.images=new Set();this.handles=new Map();this.next=0x50000000;
  for(const m of modules){this.images.add(m.path.toLowerCase());let p=m.path.slice(0,m.path.lastIndexOf('\\'));while(p){if(p.length===2)p+='\\';if(!this.dirs.has(p.toLowerCase()))this.dirs.set(p.toLowerCase(),p);if(p.length===3)break;p=p.slice(0,p.lastIndexOf('\\'));}}
 }
 canonical(path){if(path.startsWith('\\\\?\\')){path=path.slice(4);if(path.split('\\').some(p=>p==='.'||p==='..'))throw Error('UNMODELED_EXTENDED_PATH');}let p=fullPath(path);if(p.length>3)p=p.replace(/\\+$/,'');return p;}
 open(path,access,share,security,disposition,flags,template){
  if(access||share&~7||security||disposition!==3||flags&~0x2000080||template)throw Error('FILE_CONTENT_OR_OPEN_MODE_REQUIRED');
  path=this.canonical(path);const key=path.toLowerCase();if(this.images.has(key))throw Error('IMAGE_FILE_METADATA_REQUIRED');
  if(!this.dirs.has(key)){let parent=path.slice(0,path.lastIndexOf('\\'));if(parent.length===2)parent+='\\';return [0xffffffffffffffffn,this.dirs.has(parent.toLowerCase())?2:3];}
  if(!(flags&0x2000000))return [0xffffffffffffffffn,5];const h=this.next;this.next+=4;this.handles.set(h,this.dirs.get(key));return [BigInt(h),null];
 }
 invoke(name,memory,cpu,setLastError){
  const v=new DataView(memory.buffer),arg=o=>v.getBigUint64(cpu+o,true),sp=arg(32),at=(p,n)=>{if(p<=0n||p>0xffffffffn||Number(p)+n>v.byteLength)throw Error('Directory memory bounds');return Number(p);};const stack=at(sp,64);let result,error;
  if(name.toLowerCase().endsWith('!createfilew')){let path='',terminated=false;for(let i=0;i<32768;i++){const ch=v.getUint16(at(arg(8)+BigInt(i*2),2),true);if(!ch){terminated=true;break;}path+=String.fromCharCode(ch);}if(!terminated)throw Error('UNMODELED_WINDOWS_PATH_SIZE');[result,error]=this.open(path,Number(arg(16)&0xffffffffn),Number(arg(64)&0xffffffffn),arg(72),Number(v.getBigUint64(stack+40,true)&0xffffffffn),Number(v.getBigUint64(stack+48,true)&0xffffffffn),v.getBigUint64(stack+56,true));}
  else if(name.toLowerCase().endsWith('!closehandle')){if(!this.handles.delete(Number(arg(8)))){result=0n;error=6;}else result=1n;}
  else if(name.toLowerCase().endsWith('!getfinalpathnamebyhandlew')){
   const path=this.handles.get(Number(arg(8))),flags=Number(arg(72)&0xffffffffn),capacity=Number(arg(64)&0xffffffffn);
   if(!path){result=0n;error=6;}else{if(flags!==0)throw Error('UNMODELED_FINAL_PATH_FLAGS');const text='\\\\?\\'+path;result=BigInt(text.length+1);if(capacity>text.length){const out=at(arg(16),(text.length+1)*2);for(let i=0;i<text.length;i++)v.setUint16(out+i*2,text.charCodeAt(i),true);v.setUint16(out+text.length*2,0,true);result=BigInt(text.length);}}
  }else throw Error('UNMODELED_DIRECTORY_API');
  if(error!==null&&error!==undefined)setLastError(error);v.setBigUint64(cpu,result,true);v.setBigUint64(cpu+192,v.getBigUint64(stack,true),true);v.setBigUint64(cpu+32,sp+8n,true);return result;
 }
 snapshot(){return {directories:Object.fromEntries(this.dirs),images:[...this.images].sort(),handles:Object.fromEntries(this.handles),next:this.next};}
}
