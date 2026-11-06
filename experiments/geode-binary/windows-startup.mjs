// Small services used during CRT startup. No unknown API returns success.
export class StartupServices {
 constructor({processId=1,counter=()=>BigInt(Math.floor(performance.now()*1e6)),environment={},tibBase=0,version={major:10,minor:0,build:19045,platform:2,productType:1}}={}) {
  if(!Number.isInteger(processId)||processId<=0||processId>0xffffffff)throw Error('Invalid guest process ID');
  this.processId=processId;this.counter=counter;this.frequency=1000000000n;this.lastCounter=-1n;
  this.environment=new Map(Object.entries(environment).map(([k,v])=>[k.toUpperCase(),String(v)]));this.lastError=0;this.tibBase=tibBase;
  this.version=Object.freeze({...version});
 }
 invoke(name,memory,cpu,guestBase=0) {
  const key=name.toLowerCase(),v=new DataView(memory.buffer);
  const linear=(p,n)=>{const at=Number(p)+guestBase;
   if(p<=0n||p>0xffffffffn||!Number.isSafeInteger(at)||at<0||at+n>memory.buffer.byteLength)throw Error('Guest access outside memory');return at;};
  const sp=v.getBigUint64(cpu+32,true),stack=linear(sp,8),ret=v.getBigUint64(stack,true);
  let result;
  const setError=value=>{this.lastError=value;if(this.tibBase)v.setUint32(this.tibBase+0x68,value,true);};
  if(key==='kernel32.dll!getcurrentprocess')result=0xffffffffffffffffn;
  else if(key==='kernel32.dll!getcurrentprocessid')result=BigInt(this.processId);
  else if(key==='kernel32.dll!getsysteminfo'||key==='kernel32.dll!getnativesysteminfo') {
   const at=linear(v.getBigUint64(cpu+8,true),48);new Uint8Array(memory.buffer,at,48).fill(0);
   v.setUint16(at,9,true);v.setUint32(at+4,4096,true);
   v.setBigUint64(at+8,65536n,true);v.setBigUint64(at+16,0xffffffffn,true);v.setBigUint64(at+24,1n,true);
   v.setUint32(at+32,1,true);v.setUint32(at+36,8664,true);v.setUint32(at+40,65536,true);v.setUint16(at+44,6,true);
  }
  else if(key==='ntdll.dll!rtlgetversion') {
   const at=linear(v.getBigUint64(cpu+8,true),4),size=v.getUint32(at,true);
   if(size!==276&&size!==284)result=0xc000000dn;
   else {
    linear(BigInt(at-guestBase),size);new Uint8Array(memory.buffer,at+4,size-4).fill(0);
    for(const [offset,field] of [[4,'major'],[8,'minor'],[12,'build'],[16,'platform']])v.setUint32(at+offset,this.version[field],true);
    if(size===284)v.setUint8(at+282,this.version.productType);
    result=0n;
   }
  }
  else if(key==='kernel32.dll!getlasterror')result=BigInt(this.lastError);
  else if(key==='kernel32.dll!setlasterror')setError(Number(v.getBigUint64(cpu+8,true)&0xffffffffn));
  else if(key==='kernel32.dll!getenvironmentvariablew') {
   const p=v.getBigUint64(cpu+8,true);let name='',ended=false;
   for(let i=0;i<32768;i++){const c=v.getUint16(linear(p+BigInt(i*2),2),true);if(!c){ended=true;break;}name+=String.fromCharCode(c);}
   if(!ended)throw Error('Unterminated environment name');
   const value=this.environment.get(name.toUpperCase());
   if(value===undefined){setError(203);result=0n;}
   else {
    const capacity=Number(v.getBigUint64(cpu+64,true)&0xffffffffn);
    if(capacity<value.length+1)result=BigInt(value.length+1);
    else {
     const out=linear(v.getBigUint64(cpu+16,true),(value.length+1)*2);
     for(let i=0;i<value.length;i++)v.setUint16(out+i*2,value.charCodeAt(i),true);
     v.setUint16(out+value.length*2,0,true);result=BigInt(value.length);
    }
   }
  }
  else if(key==='kernel32.dll!queryperformancecounter'||key==='kernel32.dll!queryperformancefrequency') {
   const out=linear(v.getBigUint64(cpu+8,true),8);
   let value=this.frequency;
   if(key.endsWith('queryperformancecounter')) {
    value=this.counter();
    if(typeof value!=='bigint'||value<0n||value>0x7fffffffffffffffn||value<this.lastCounter)throw Error('Invalid monotonic counter');
    this.lastCounter=value;
   }
   v.setBigUint64(out,value,true);result=1n;
  }else if(key==='kernel32.dll!initializeslisthead') {
   const p=v.getBigUint64(cpu+8,true),out=linear(p,16);
   if(p%16n)throw Error('SList head must be 16-byte aligned');
   new Uint8Array(memory.buffer,out,16).fill(0);
  }else if(key==='api-ms-win-crt-runtime-l1-1-0.dll!_initialize_onexit_table') {
   const p=v.getBigUint64(cpu+8,true);
   if(p===0n)result=0xffffffffn;
   else {
    const table=linear(p,24);
    if(v.getBigUint64(table,true)===v.getBigUint64(table+16,true))
     new Uint8Array(memory.buffer,table,24).fill(0);
    result=0n;
   }
  }else throw Error('Unimplemented startup API '+name);
  if(result!==undefined)v.setBigUint64(cpu,result,true);
  v.setBigUint64(cpu+32,sp+8n,true);v.setBigUint64(cpu+192,ret,true);
  return result;
 }
}
