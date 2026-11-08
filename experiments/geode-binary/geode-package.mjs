// Real .geode archive reader. Does not execute DLL code or create replacement UI.
import {decompress as unzstd} from './vendor/fzstd/index.mjs';
const DEFAULTS={maxArchiveBytes:64*1024*1024,maxEntryBytes:64*1024*1024,maxTotalBytes:256*1024*1024,maxEntries:8192};
const utf8=new TextDecoder('utf-8',{fatal:true});
const crcTable=Uint32Array.from({length:256},(_,i)=>{let c=i;for(let n=0;n<8;n++)c=(c>>>1)^((c&1)?0xedb88320:0);return c>>>0;});
export function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=(c>>>8)^crcTable[(c^b)&255];return (c^0xffffffff)>>>0;}
function check(ok,message){if(!ok)throw Error('Geode package: '+message);}
function zstdFrame(bytes,size,max){
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 check(bytes.length>=6&&v.getUint32(0,true)===0xfd2fb528,'unsupported Zstandard frame');
 const flags=bytes[4],single=!!(flags&32),flag=flags>>>6;check(!(flags&24),'reserved Zstandard flags');
 let p=single?5:6,dictSize=[0,1,2,4][flags&3];check(p+dictSize<=bytes.length,'truncated Zstandard dictionary');
 let dictionary=0;for(let i=0;i<dictSize;i++)dictionary+=bytes[p+i]*2**(8*i);check(dictionary===0,'external Zstandard dictionary required');p+=dictSize;
 const sizeBytes=flag?2**flag:(single?1:0);check(p+sizeBytes<=bytes.length,'truncated Zstandard size');
 let content=0n;for(let i=0;i<sizeBytes;i++)content|=BigInt(bytes[p+i])<<BigInt(8*i);if(flag===1)content+=256n;p+=sizeBytes;
 if(sizeBytes)check(content===BigInt(size),'Zstandard size disagrees with ZIP');
 const window=single?Number(content):2**(10+(bytes[5]>>>3))*(1+(bytes[5]&7)/8);check(window<=max,'Zstandard window exceeds bound');
 let last=false;while(!last){check(p+3<=bytes.length,'truncated Zstandard block');const h=bytes[p]|bytes[p+1]<<8|bytes[p+2]<<16;p+=3;last=!!(h&1);const type=(h>>>1)&3,n=h>>>3;check(type!==3&&n<=131072,'invalid Zstandard block');p+=type===1?1:n;check(p<=bytes.length,'truncated Zstandard payload');}
 if(flags&4)p+=4;check(p===bytes.length,'expected one complete Zstandard frame');
}
export class GeodePackage{
 constructor(input,options={}){
  this.limits={...DEFAULTS,...options};for(const n of Object.values(this.limits))check(Number.isSafeInteger(n)&&n>0,'invalid archive bounds');
  const source=input instanceof Uint8Array?input:new Uint8Array(input);check(source.length<=this.limits.maxArchiveBytes,'archive exceeds bound');
  this.bytes=source.slice();this.v=new DataView(this.bytes.buffer);this.entries=new Map();const b=this.bytes,v=this.v;
  check(b.length>=22,'missing ZIP directory');let eocd=-1;
  for(let p=b.length-22;p>=Math.max(0,b.length-65557);p--)if(v.getUint32(p,true)===0x06054b50&&p+22+v.getUint16(p+20,true)===b.length){eocd=p;break;}
  check(eocd>=0,'missing ZIP end record');check(v.getUint16(eocd+4,true)===0&&v.getUint16(eocd+6,true)===0,'split archives unsupported');
  const count=v.getUint16(eocd+10,true),length=v.getUint32(eocd+12,true),directory=v.getUint32(eocd+16,true);
  check(count!==65535&&length!==0xffffffff&&directory!==0xffffffff,'ZIP64 unsupported');check(count===v.getUint16(eocd+8,true)&&count<=this.limits.maxEntries,'invalid entry count');check(directory+length===eocd,'invalid central directory extent');
  let p=directory,total=0;const extents=[];
  for(let i=0;i<count;i++){
   check(p+46<=eocd&&v.getUint32(p,true)===0x02014b50,'invalid central directory entry');
   const flags=v.getUint16(p+8,true),method=v.getUint16(p+10,true),crc=v.getUint32(p+16,true),compressed=v.getUint32(p+20,true),size=v.getUint32(p+24,true),nameSize=v.getUint16(p+28,true),extra=v.getUint16(p+30,true),comment=v.getUint16(p+32,true),offset=v.getUint32(p+42,true);
   check(!(flags&1)&&[0,8,20,93].includes(method),'encrypted or unsupported compression');check(v.getUint16(p+34,true)===0,'split member unsupported');
   check(p+46+nameSize+extra+comment<=eocd,'truncated directory entry');check(size!==0xffffffff&&compressed!==0xffffffff&&offset!==0xffffffff,'ZIP64 member unsupported');
   const nameBytes=b.subarray(p+46,p+46+nameSize);if(!(flags&2048))check(nameBytes.every(c=>c<128),'non-UTF8 non-ASCII filename unsupported');const name=utf8.decode(nameBytes),parts=name.replace(/\/$/,'').split('/');
   check(name.length>0&&!name.startsWith('/')&&!name.includes('\\')&&!name.includes(':')&&!name.includes('\0')&&parts.every(x=>x&&x!=='.'&&x!=='..'),'unsafe filename');check(!this.entries.has(name),'duplicate filename');
   check(size<=this.limits.maxEntryBytes&&(total+=size)<=this.limits.maxTotalBytes,'expanded package exceeds bound');
   check(offset+30<=directory&&v.getUint32(offset,true)===0x04034b50,'invalid local header');
   const localName=v.getUint16(offset+26,true),localExtra=v.getUint16(offset+28,true),start=offset+30+localName+localExtra,end=start+compressed;
   check(v.getUint16(offset+6,true)===flags&&v.getUint16(offset+8,true)===method,'conflicting local header');check(localName===nameSize&&offset+30+localName<=directory,'conflicting local filename');
   check(nameBytes.every((c,j)=>b[offset+30+j]===c),'conflicting filenames');check(end<=directory,'member extends into ZIP directory');
   if(!(flags&8))check(v.getUint32(offset+14,true)===crc&&v.getUint32(offset+18,true)===compressed&&v.getUint32(offset+22,true)===size,'conflicting local sizes/CRC');
   this.entries.set(name,Object.freeze({name,method,crc,compressed,size,start,end,offset}));extents.push([offset,end]);p+=46+nameSize+extra+comment;
  }
  check(p===eocd,'directory size mismatch');extents.sort((a,b)=>a[0]-b[0]);for(let i=1;i<extents.length;i++)check(extents[i][0]>=extents[i-1][1],'overlapping members');
 }
 names(){return [...this.entries.keys()];}
 async read(name){
  const e=this.entries.get(name);check(!!e,'missing member '+name);const data=this.bytes.subarray(e.start,e.end);let out;
  if(e.method===0){check(e.compressed===e.size,'stored size mismatch');out=data.slice();}
  else if(e.method===20||e.method===93){zstdFrame(data,e.size,this.limits.maxEntryBytes);out=unzstd(data,new Uint8Array(e.size));}
  else{
   const stream=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')),reader=stream.getReader();out=new Uint8Array(e.size);let at=0;
   try{while(true){const {done,value}=await reader.read();if(done)break;check(at+value.length<=out.length,'deflate exceeds declared size');out.set(value,at);at+=value.length;}check(at===out.length,'deflate size mismatch');}finally{await reader.cancel().catch(()=>{});}
  }
  check(out.length===e.size&&crc32(out)===e.crc,'member size/CRC mismatch: '+name);return out;
 }
 async manifest(){return JSON.parse(utf8.decode(await this.read('mod.json')));}
 async windowsDll(){const names=this.names().filter(n=>n.endsWith('.dll'));check(names.length===1,'expected exactly one Windows DLL');return {name:names[0],bytes:await this.read(names[0])};}
}
