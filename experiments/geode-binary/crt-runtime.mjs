// Guest-owned CRT process state and opaque standard streams. No host FILE* leaks.
export class CrtRuntime {
 constructor(memory,{base=0xf00000,size=65536}={}){
  this.memory=memory;this.base=base;this.size=size;this.callbacks=[];this.fileLocks=new Map();this.newHandler=0n;this.localeLock={owner:null,depth:0};this.localeQueries=0;this.localeConvQueries=0;
  if(base<=0||base+size>memory.buffer.byteLength)throw Error('CRT region bounds');
  const v=new DataView(memory.buffer);new Uint8Array(memory.buffer,base,size).fill(0);
  new Uint8Array(memory.buffer,base+0x100,2).set([67,0]);
  new Uint8Array(memory.buffer,base+0x110,2).set([46,0]);v.setUint16(base+0x120,46,true);
  for(let i=0;i<10;i++)v.setBigUint64(base+0x400+i*8,BigInt(base+(i===0?0x110:0x113)),true);
  new Uint8Array(memory.buffer,base+0x450,8).fill(127);
  for(let i=0;i<8;i++)v.setBigUint64(base+0x458+i*8,BigInt(base+(i===0?0x120:0x124)),true);
  for(let ch=-128;ch<256;ch++){
   let flags=0;if((ch>=0&&ch<32)||ch===127)flags|=32;if((ch>=9&&ch<=13)||ch===32)flags|=8;if(ch===32)flags|=64;
   if(ch>=48&&ch<=57)flags|=4|128;
   else if(ch>=65&&ch<=90)flags|=1|(ch<=70?128:0);
   else if(ch>=97&&ch<=122)flags|=2|(ch<=102?128:0);
   else if(ch>=33&&ch<=126)flags|=16;
   v.setUint16(base+0x800+(ch+128)*2,flags,true);
  }
  this.files=[0,1,2].map(index=>{const p=base+0x1000+index*64;v.setUint32(p+32,index,true);return p;});
 }
 invoke(name,cpu,thread=1){
  const v=new DataView(this.memory.buffer),key=name.split('!').at(-1).toLowerCase(),arg=v.getBigUint64(cpu+8,true),sp=v.getBigUint64(cpu+32,true);
  const address=(p,n)=>{if(p<=0n||p>0xffffffffn||Number(p)+n>v.byteLength)throw Error('CRT access bounds');return Number(p);};
  const stack=address(sp,8),ret=v.getBigUint64(stack,true);let result;
  if(key==='tolower'){const ch=Number(arg&0xffffffffn);if(ch!==0xffffffff&&ch>255)throw Error('UNMODELED_CRT_CTYPE_ARGUMENT');result=BigInt(ch>=65&&ch<=90?ch+32:ch);}
  else if(key==='isspace'){const ch=Number(arg&0xffffffffn);if(ch!==0xffffffff&&ch>255)throw Error('UNMODELED_CRT_CTYPE_ARGUMENT');result=ch===0xffffffff?0n:BigInt(v.getUint16(this.base+0x900+ch*2,true)&8);}
  else if(key==='localeconv'){this.localeConvQueries++;result=BigInt(this.base+0x400);}
  else if(key==='__pctype_func')result=BigInt(this.base+0x900);
  else if(key==='___lc_codepage_func'||key==='___lc_collate_cp_func')result=0n;
  else if(key==='___mb_cur_max_func')result=1n;
  else if(key==='___lc_locale_name_func')result=BigInt(this.base+0x300);
  else if(key==='_lock_locales'||key==='_unlock_locales'){
   const lock=this.localeLock;
   if(key==='_lock_locales'){if(lock.owner!==null&&lock.owner!==thread)throw Error('CRT locale contention requires scheduler');lock.owner=thread;lock.depth++;}
   else {if(lock.owner!==thread||lock.depth===0)throw Error('CRT locale non-owner release');if(--lock.depth===0)lock.owner=null;}
  }else if(key==='setlocale'){
   if(arg>5n)throw Error('UNMODELED_CRT_LOCALE_CATEGORY');const p=v.getBigUint64(cpu+16,true);
   if(p){let name='';for(let i=0;i<256;i++){const c=v.getUint8(address(p+BigInt(i),1));if(!c)break;name+=String.fromCharCode(c);}if(name!=='C')throw Error('UNMODELED_CRT_LOCALE');}
   this.localeQueries++;result=BigInt(this.base+0x100);
  }else if(key==='__acrt_iob_func'){const index=Number(arg&0xffffffffn);if(index>2)throw Error('UNMODELED_CRT_STREAM_INDEX');result=BigInt(this.files[index]);}
  else if(key==='_get_stream_buffer_pointers'){
   const file=Number(arg);if(arg>0xffffffffn||!this.files.includes(file))throw Error('UNMODELED_CRT_STREAM');
   for(const [offset,slot] of [[16,file+8],[64,file+16],[72,file+24]]){const p=v.getBigUint64(cpu+offset,true);if(p)v.setBigUint64(address(p,8),BigInt(slot),true);}result=0n;
  }else if(key==='_lock_file'||key==='_unlock_file'){
   const file=Number(arg);if(!this.files.includes(file))throw Error('UNMODELED_CRT_STREAM');const lock=this.fileLocks.get(file)??{owner:null,depth:0};
   if(key==='_lock_file'){if(lock.owner!==null&&lock.owner!==thread)throw Error('CRT stream contention requires scheduler');lock.owner=thread;lock.depth++;}
   else {if(lock.owner!==thread||lock.depth===0)throw Error('CRT stream non-owner release');if(--lock.depth===0)lock.owner=null;}
   this.fileLocks.set(file,lock);
  }else if(key==='_crt_atexit'){
   if(arg<=0n||arg>0xffffffffn)throw Error('UNMODELED_CRT_EXIT_CALLBACK');if(this.callbacks.length===1024)result=0xffffffffn;
   else {v.setBigUint64(this.base+0x2000+this.callbacks.length*8,arg,true);this.callbacks.push(arg);result=0n;}
  }else if(key==='_set_new_handler'){if(arg>0xffffffffn)throw Error('UNMODELED_CRT_NEW_HANDLER');result=this.newHandler;this.newHandler=arg;}
  else throw Error('Unimplemented CRT process API '+name);
  if(result!==undefined)v.setBigUint64(cpu,result,true);v.setBigUint64(cpu+32,sp+8n,true);v.setBigUint64(cpu+192,ret,true);return result;
 }
 snapshot(){return {base:this.base,size:this.size,callbacks:this.callbacks.map(String),fileLocks:Object.fromEntries(this.fileLocks),newHandler:String(this.newHandler),localeLock:this.localeLock,localeQueries:this.localeQueries,localeConvQueries:this.localeConvQueries};}
}
