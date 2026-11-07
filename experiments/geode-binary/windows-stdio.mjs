import {GuestConsole} from './windows-console.mjs';
export const STDIO_NAMES=['__acrt_iob_func','_fileno','_dup','_fdopen','_get_osfhandle','_close'];
export const PROCESS_NAMES=['GetCurrentProcessId'];
// Opaque FILE identities and owned descriptors; native UCRT internals are not
// exposed. Win32 standard handles may be null while CRT streams remain open.
export class GuestStdio extends GuestConsole{
 constructor(memory,addresses,options={}){super(memory,addresses,options);this.streams=new Map();this.fds=new Map();this.stdioHandles=new Map();this.nextStdioHandle=0x61000010n;}
 resolve(item){if(STDIO_NAMES.includes(item.name)&&/^(api-ms-win-crt-|ucrtbase|msvcr)/i.test(item.dll)){const p=this.addresses[item.name];return p===undefined?undefined:BigInt(p);}return super.resolve(item);}
 initializeStdio(){
  if(this.stdioBase)return;
  const base=this.allocate(3n*88n,true);if(!base)throw Error('Guest standard-stream allocation failed');this.stdioBase=base;
  for(let fd=0;fd<3;fd++){const handle=0x61000000n+BigInt(fd);this.streams.set(base+BigInt(fd*88),fd);this.fds.set(fd,{channel:fd,handle});this.stdioHandles.set(handle,fd);}
 }
 stdioSnapshot(){return {streams:[...this.streams].map(([p,fd])=>[String(p),fd]),fds:[...this.fds].map(([fd,d])=>[fd,d.channel,String(d.handle)])};}
 invoke(cpu,address){
  const name=[...STDIO_NAMES,...PROCESS_NAMES].find(n=>this.addresses[n]!==undefined&&BigInt(this.addresses[n])===address);if(!name)return super.invoke(cpu,address);
  let v=new DataView(this.memory.buffer);const a=v.getBigUint64(cpu+8,true),b=v.getBigUint64(cpu+16,true),sp=v.getBigUint64(cpu+32,true);this.range(sp,8);let result;
  if(name==='GetCurrentProcessId')result=1n;
  else{
   this.initializeStdio();
   if(name==='__acrt_iob_func'){const i=Number(a&0xffffffffn);if(i>2)throw Error('Unsupported guest standard-stream index');result=this.stdioBase+BigInt(i*88);}
   else if(name==='_fileno'){if(!this.streams.has(a))throw Error('Unowned guest FILE object');result=BigInt(this.streams.get(a));}
   else{
    const fd=Number(BigInt.asIntN(32,a)),entry=this.fds.get(fd);
    if(!entry){this.errno=9;result=name==='_fdopen'?0n:name==='_get_osfhandle'?0xffffffffffffffffn:0xffffffffn;}
    else if(name==='_dup'){let next=3;while(this.fds.has(next))next++;const handle=this.nextStdioHandle++;this.fds.set(next,{channel:entry.channel,handle});this.stdioHandles.set(handle,entry.channel);result=BigInt(next);}
    else if(name==='_get_osfhandle')result=entry.handle;
    else if(name==='_close'){this.fds.delete(fd);this.stdioHandles.delete(entry.handle);result=0n;}
    else{
     let mode='';for(let i=0;i<4;i++){v=new DataView(this.memory.buffer);const c=v.getUint8(this.range(b+BigInt(i),1));if(!c)break;mode+=String.fromCharCode(c);}
     if(!['w','wb','wt'].includes(mode))throw Error('Unsupported guest fdopen mode');
     result=this.allocate(88n,true);if(result)this.streams.set(result,fd);
    }
   }
  }
  v=new DataView(this.memory.buffer);v.setBigUint64(cpu,result,true);this.calls.push(name);v.setBigUint64(cpu+192,v.getBigUint64(Number(sp),true),true);v.setBigUint64(cpu+32,sp+8n,true);
 }
}
