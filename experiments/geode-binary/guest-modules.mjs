// Module lookup and mapped PE exports; incomplete catalogs never imply absence.
export class GuestModules {
 constructor(modules,{setLastError=()=>{}}={}){this.modules=modules;this.setLastError=setLastError;this.lookups=0;this.resolutions=0;}
 handle(name){
  if(name===null){const primary=this.modules.find(m=>m.primary);if(!primary)throw Error('PRIMARY_EXECUTABLE_REQUIRED');this.lookups++;return primary.base;}
  let key=name.replaceAll('\\','/').toLowerCase();
  if(key.includes('/')){if(!key.startsWith('c:/windows/system32/'))throw Error('UNMODELED_MODULE_PATH: '+name);key=key.slice(key.lastIndexOf('/')+1);}
  if(key.endsWith('.'))key=key.slice(0,-1);else if(!key.includes('.'))key+='.dll';
  const m=this.modules.find(m=>m.name.toLowerCase()===key);if(!m)throw Error('UNMODELED_MODULE: '+name);
  if(m.sliceOnly)throw Error('MSVCP_RUNTIME_INITIALIZATION_REQUIRED');
  this.lookups++;return m.base;
 }
 resolve(memory,handle,symbol){
  const m=this.modules.find(m=>m.base===handle);if(!m)throw Error('UNMODELED_MODULE_HANDLE');
  if(typeof symbol==='number'&&m.shim)throw Error('UNMODELED_SHIM_ORDINAL');
  const v=new DataView(memory.buffer),at=(rva,n)=>{if(!Number.isInteger(rva)||rva<0||rva+n>m.size||handle+rva+n>memory.buffer.byteLength)throw Error('Invalid PE export bounds');return handle+rva;};
  const u32=r=>v.getUint32(at(r,4),true),u16=r=>v.getUint16(at(r,2),true);
  if(u16(0)!==0x5a4d)throw Error('Invalid PE DOS header');
  const pe=u32(0x3c),optional=pe+24;if(u32(pe)!==0x4550||u16(optional)!==0x20b||u32(optional+108)<1)throw Error('Invalid PE64 header');
  const dir=u32(optional+112),size=u32(optional+116);if(!dir||!size){if(!m.complete)throw Error('Incomplete PE export catalog');this.setLastError(127);return 0;}at(dir,size);
  const first=u32(dir+16),count=u32(dir+20),names=u32(dir+24),eat=u32(dir+28),nt=u32(dir+32),ot=u32(dir+36);
  at(eat,count*4);at(nt,names*4);at(ot,names*2);
  const string=rva=>{let text='';for(let i=0;i<32768;i++){const b=v.getUint8(at(rva+i,1));if(!b)return text;text+=String.fromCharCode(b);}throw Error('Unterminated PE export name');};
  let index=-1;
  if(typeof symbol==='number'){if(symbol>=first&&symbol-first<count)index=symbol-first;}
  else for(let i=0;i<names;i++)if(string(u32(nt+i*4))===symbol){index=u16(ot+i*2);break;}
  if(index<0){if(!m.complete&&!m.knownAbsent?.includes(symbol))throw Error('UNMODELED_EXPORT: '+m.name+'!'+symbol);this.setLastError(127);return 0;}
  if(index>=count)throw Error('Invalid export ordinal');const rva=u32(eat+index*4);
  if(!rva){this.setLastError(127);return 0;}
  if(rva>=dir&&rva<dir+size)throw Error('UNMODELED_EXPORT_FORWARDER: '+string(rva));
  at(rva,1);this.resolutions++;return handle+rva;
 }
 invoke(name,memory,cpu){
  const v=new DataView(memory.buffer),read=(p,wide)=>{let s='';for(let i=0;i<32768;i++){const at=Number(p)+i*(wide?2:1);if(p<=0n||p>0xffffffffn||at+(wide?2:1)>memory.buffer.byteLength)throw Error('Guest string bounds');const c=wide?v.getUint16(at,true):v.getUint8(at);if(!c)return s;s+=String.fromCharCode(c);}throw Error('Unterminated guest string');};
  const key=name.toLowerCase(),arg=v.getBigUint64(cpu+8,true);let result;
  if(key.endsWith('!disablethreadlibrarycalls')){
   const m=this.modules.find(m=>BigInt(m.base)===arg);if(!m)throw Error('UNMODELED_MODULE_HANDLE');
   if(m.staticTls){this.setLastError(126);result=0;}else{m.threadCalloutsDisabled=true;result=1;}
  }else if(key.endsWith('!getmodulehandlea')||key.endsWith('!getmodulehandlew'))result=this.handle(arg===0n?null:read(arg,key.endsWith('w')));
  else if(key.endsWith('!getprocaddress')){const p=v.getBigUint64(cpu+16,true);result=this.resolve(memory,Number(arg),p<=65535n?Number(p):read(p,false));}
  else throw Error('Unknown module API '+name);
  const sp=v.getBigUint64(cpu+32,true);if(sp<=0n||sp>0xffffffffn||Number(sp)+8>memory.buffer.byteLength)throw Error('Guest stack bounds');
  v.setBigUint64(cpu,BigInt(result),true);v.setBigUint64(cpu+192,v.getBigUint64(Number(sp),true),true);v.setBigUint64(cpu+32,sp+8n,true);return result;
 }
}
