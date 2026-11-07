import {GuestStdio} from './windows-stdio.mjs';
export const PIPE_NAMES=['CreateNamedPipeW','ReadFile','WriteFile','GetOverlappedResult'];
export const PIPE_CRT_NAMES=['freopen_s','_write'];
const pipeHex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
export class GuestPipes extends GuestStdio{
 constructor(memory,addresses,options={}){super(memory,addresses,options);this.pipes=new Map();this.pipeEnds=new Map();this.pipeHistory=[];this.nextPipeHandle=0x62000000n;this.pendingReads=new Map();this.ioResults=new Map();this.ioCompletions=[];this.outputRecords=[];this.outputSink=options.outputSink;}
 resolve(item){if(PIPE_CRT_NAMES.includes(item.name)&&/^(api-ms-win-crt-|ucrtbase|msvcr)/i.test(item.dll)){const p=this.addresses[item.name];return p===undefined?undefined:BigInt(p);}return super.resolve(item);}
 asciiZ(pointer,max=32768){let text='';for(let i=0;i<max;i++){const c=new DataView(this.memory.buffer).getUint8(this.range(pointer+BigInt(i),1));if(!c)return text;if(c>=128)throw Error('Unsupported pipe CRT filename code page');text+=String.fromCharCode(c);}throw Error('Unterminated pipe CRT string');}
 createPipe(path,openMode,pipeMode,instances,outBytes,inBytes,timeout,security){
  if(!path.toLowerCase().startsWith('\\\\.\\pipe\\')||path.length>256||path.length<=9)throw Error('Unsupported guest pipe namespace');
  if(openMode!==0x40000001||pipeMode!==8||instances!==1||outBytes!==0||inBytes!==1024||timeout!==0||security!==0n)throw Error('Unsupported guest named-pipe mode');
  const key=path.toLowerCase();if(this.pipes.has(key))return {value:0xffffffffffffffffn,error:231};
  const server=this.nextPipeHandle++,pipe={name:path,key,server,clients:new Set(),chunks:[],bytes:0,everConnected:false,closed:false};
  this.pipes.set(key,pipe);this.pipeHistory.push(pipe);this.pipeEnds.set(server,{pipe,side:'server'});return {value:server,error:0};
 }
 reopen(out,path,mode,file){
  this.range(out,8);if(!this.streams.has(file))throw Error('Unowned guest reopen FILE');if(!['w','wb','wt'].includes(mode))throw Error('Unsupported pipe reopen mode');
  const fd=this.streams.get(file),previous=this.fds.get(fd),pipe=this.pipes.get(path.toLowerCase());
  if(pipe&&(pipe.everConnected||pipe.closed))throw Error('Guest pipe reconnection requires explicit disconnect support');
  if(previous){this.closeDescriptorHandle(previous.handle);this.fds.delete(fd);}
  let result=2,pointer=0n;
  if(pipe){const handle=this.nextPipeHandle++;pipe.clients.add(handle);pipe.everConnected=true;this.pipeEnds.set(handle,{pipe,side:'client'});this.fds.set(fd,{channel:fd===2?2:1,handle,pipe:pipe.key,text:!mode.includes('b')});pointer=file;result=0;}
  else{this.streams.delete(file);this.errno=2;}
  new DataView(this.memory.buffer).setBigUint64(Number(out),pointer,true);return result;
 }
 closeDescriptorHandle(handle){if(this.pipeEnds.has(handle))this.closePipe(handle);else if(!this.stdioHandles.delete(handle))throw Error('Unowned guest descriptor handle');}
 complete(request,data,error=0){
  const v=new DataView(this.memory.buffer);this.range(request.ov,32);if(data.length)new Uint8Array(this.memory.buffer,this.range(request.buffer,data.length),data.length).set(data);
  const status=error===109?0xc000014bn:error===995?0xc0000120n:0n;
  v.setBigUint64(Number(request.ov),status,true);v.setBigUint64(Number(request.ov)+8,BigInt(data.length),true);if(request.count)v.setUint32(this.range(request.count,4),data.length,true);
  this.pendingReads.delete(request.ov);const result={ov:String(request.ov),handle:String(request.handle),bytes:data.length,error,status:String(status)};this.ioResults.set(request.ov,result);this.ioCompletions.push(result);
 }
 take(pipe,n){const result=new Uint8Array(Math.min(n,pipe.bytes));let at=0;while(at<result.length){const first=pipe.chunks[0],count=Math.min(first.length,result.length-at);result.set(first.subarray(0,count),at);at+=count;pipe.bytes-=count;if(count===first.length)pipe.chunks.shift();else pipe.chunks[0]=first.subarray(count);}return result;}
 drain(pipe){for(const request of [...this.pendingReads.values()]){if(request.pipe!==pipe)continue;if(pipe.bytes)this.complete(request,this.take(pipe,request.size));else if(pipe.everConnected&&!pipe.clients.size)this.complete(request,new Uint8Array(),109);}}
 closePipe(handle){
  const end=this.pipeEnds.get(handle);if(!end)return false;this.pipeEnds.delete(handle);const p=end.pipe;
  if(end.side==='client'){p.clients.delete(handle);this.drain(p);}
  else{p.closed=true;this.pipes.delete(p.key);for(const r of [...this.pendingReads.values()])if(r.pipe===p)this.complete(r,new Uint8Array(),995);p.chunks=[];p.bytes=0;}
  return true;
 }
 write(handle,bytes){
  const end=this.pipeEnds.get(handle);
  if(!end){const channel=this.stdioHandles.get(handle);if(channel===undefined)throw Error('Unsupported guest WriteFile target');if(!channel)return {value:0n,error:5};const data=bytes.slice();this.outputRecords.push({channel,hex:pipeHex(data)});this.outputSink?.(channel,data);return {value:1n,error:0};}
  if(end.side!=='client')return {value:0n,error:5};const p=end.pipe;if(p.closed)return {value:0n,error:109};
  if(p.bytes+bytes.length>1048576)throw Error('Guest pipe write requires backpressure scheduling');if(bytes.length){p.chunks.push(bytes.slice());p.bytes+=bytes.length;}this.drain(p);return {value:1n,error:0};
 }
 read(handle,buffer,size,count,ov){
  let v=new DataView(this.memory.buffer);if(count)v.setUint32(this.range(count,4),0,true);
  const end=this.pipeEnds.get(handle);if(!end)return {value:0n,error:6};if(end.side!=='server')return {value:0n,error:5};
  if(!ov||!size)throw Error('Guest pipe reads require nonzero buffers and OVERLAPPED');this.range(buffer,size);this.range(ov,32);
  if(v.getBigUint64(Number(ov)+24,true)!==0n)throw Error('Guest pipe event handles require event dispatch');if(this.pendingReads.has(ov))throw Error('Active OVERLAPPED reuse');
  this.ioResults.delete(ov);v.setBigUint64(Number(ov),0x103n,true);v.setBigUint64(Number(ov)+8,0n,true);
  const p=end.pipe,request={pipe:p,handle,buffer,size,count,ov};if(!p.everConnected)throw Error('Guest pipe read requires a connected client');
  if(p.bytes){this.complete(request,this.take(p,size));return {value:1n,error:0};}
  if(p.everConnected&&!p.clients.size)return {value:0n,error:109};
  this.pendingReads.set(ov,request);return {value:0n,error:997};
 }
 pipeSnapshot(){return {pipes:this.pipeHistory.map(p=>({name:p.name,server:String(p.server),clients:[...p.clients].map(String),queuedHex:pipeHex(Uint8Array.from(p.chunks.flatMap(b=>Array.from(b)))),closed:p.closed,everConnected:p.everConnected})),completions:[...this.ioCompletions],outputs:[...this.outputRecords]};}
 invoke(cpu,address){
  const extra=['CloseHandle','_dup','_close'];const name=[...PIPE_NAMES,...PIPE_CRT_NAMES,...extra].find(n=>this.addresses[n]!==undefined&&BigInt(this.addresses[n])===address);if(!name)return super.invoke(cpu,address);
  let v=new DataView(this.memory.buffer);const a=v.getBigUint64(cpu+8,true),b=v.getBigUint64(cpu+16,true),c=v.getBigUint64(cpu+64,true),d=v.getBigUint64(cpu+72,true),sp=v.getBigUint64(cpu+32,true);this.range(sp,8);
  let result=0n,error=0;
  if(name==='CloseHandle'){if(this.pipeEnds.has(a))result=this.closePipe(a)?1n:0n;else if(this.stdioHandles.has(a)){this.stdioHandles.delete(a);result=1n;}else return super.invoke(cpu,address);}
  else if(name==='_dup'||name==='_close'){
   const fd=Number(BigInt.asIntN(32,a)),entry=this.fds.get(fd);
   if(entry&&!this.pipeEnds.has(entry.handle)&&!this.stdioHandles.has(entry.handle)){if(name==='_close')this.fds.delete(fd);this.errno=9;result=0xffffffffn;}
   else if(!entry?.pipe)return super.invoke(cpu,address);
   else if(name==='_close'){this.closeDescriptorHandle(entry.handle);this.fds.delete(fd);result=0n;}
   else{const end=this.pipeEnds.get(entry.handle);if(!end||end.pipe.closed){this.errno=9;result=0xffffffffn;}else{let next=3;while(this.fds.has(next))next++;const handle=this.nextPipeHandle++;end.pipe.clients.add(handle);this.pipeEnds.set(handle,{...end});this.fds.set(next,{...entry,handle});result=BigInt(next);}}
  }else if(name==='CreateNamedPipeW'){this.range(sp,72);const p=Number(sp);({value:result,error}=this.createPipe(this.wide(a),Number(b&0xffffffffn),Number(c&0xffffffffn),Number(d&0xffffffffn),v.getUint32(p+40,true),v.getUint32(p+48,true),v.getUint32(p+56,true),v.getBigUint64(p+64,true)));}
  else if(name==='freopen_s')result=BigInt(this.reopen(a,this.asciiZ(b),this.asciiZ(c,4),d));
  else if(name==='_write'){
   const fd=Number(BigInt.asIntN(32,a)),entry=this.fds.get(fd),n=Number(c&0xffffffffn);if(!entry){this.errno=9;result=0xffffffffn;}else{let bytes=new Uint8Array(this.memory.buffer,this.range(b,n),n).slice();if(entry.text){const out=[];for(const x of bytes){if(x===10)out.push(13);out.push(x);}bytes=Uint8Array.from(out);}const r=this.write(entry.handle,bytes);if(!r.value){this.errno=r.error===5?13:32;result=0xffffffffn;}else result=BigInt(n);}
  }else if(name==='WriteFile'){this.range(sp,48);const ov=v.getBigUint64(Number(sp)+40,true),n=Number(c&0xffffffffn);if(ov)throw Error('Guest synchronous pipe clients do not accept OVERLAPPED writes');if(!d)throw Error('Guest WriteFile needs a byte-count output');this.range(d,4);v.setUint32(Number(d),0,true);({value:result,error}=this.write(a,new Uint8Array(this.memory.buffer,this.range(b,n),n)));if(result)new DataView(this.memory.buffer).setUint32(Number(d),n,true);}
  else if(name==='ReadFile'){this.range(sp,48);({value:result,error}=this.read(a,b,Number(c&0xffffffffn),d,v.getBigUint64(Number(sp)+40,true)));}
  else{
   this.range(c,4);const pending=this.pendingReads.get(b),done=this.ioResults.get(b);if(pending?.handle!==a&&done?.handle!==String(a))throw Error('Mismatched pipe completion handle');if(pending){if(d&0xffffffffn)throw Error('Blocking pipe wait requires a guest scheduler');error=996;}else{if(!done)throw Error('Unowned pipe completion');if(!this.pipeEnds.has(a))error=6;else{v.setUint32(Number(c),done.bytes,true);error=done.error;result=error?0n:1n;}}
  }
  v=new DataView(this.memory.buffer);if(error)v.setUint32(this.tib+0x68,error,true);v.setBigUint64(cpu,result,true);this.calls.push(name);v.setBigUint64(cpu+192,v.getBigUint64(Number(sp),true),true);v.setBigUint64(cpu+32,sp+8n,true);
 }
 releaseHeap(){this.pendingReads.clear();for(const h of [...this.pipeEnds.keys()])this.closePipe(h);super.releaseHeap();}
}
