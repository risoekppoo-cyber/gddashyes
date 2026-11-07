import {GuestInput} from './windows-input.mjs';
export const DEBUGGER_NAMES=['RaiseException'];
// The guest debugger consumes only the documented continuable MSVC naming
// notification. Other exceptions require actual guest exception dispatch.
export class GuestDebugger extends GuestInput{
 constructor(memory,addresses,options={}){super(memory,addresses,options);this.threadNames=new Map();}
 invoke(cpu,address){
  if(this.addresses.RaiseException===undefined||BigInt(this.addresses.RaiseException)!==address)return super.invoke(cpu,address);
  const v=new DataView(this.memory.buffer),code=v.getUint32(cpu+8,true),flags=v.getUint32(cpu+16,true),count=v.getUint32(cpu+64,true),args=v.getBigUint64(cpu+72,true),sp=v.getBigUint64(cpu+32,true);
  if(code!==0x406d1388||flags!==0||count!==3)throw Error('Unsupported guest exception 0x'+code.toString(16));
  const p=this.range(args,24);this.range(sp,8);const id=v.getUint32(p+16,true);
  if(v.getUint32(p,true)!==0x1000||v.getUint32(p+20,true)!==0||![this.currentThreadId,0xffffffff].includes(id))throw Error('Unsupported guest thread-name event');
  const namePointer=v.getBigUint64(p+8,true);let name='',terminated=false;
  for(let i=0;i<4096;i++){const c=v.getUint8(this.range(namePointer+BigInt(i),1));if(!c){terminated=true;break;}if(c>=128)throw Error('Unsupported thread-name code page');name+=String.fromCharCode(c);}
  if(!terminated)throw Error('Unterminated guest thread name');
  this.threadNames.set(this.currentThreadId,name);this.calls.push('RaiseException');
  v.setBigUint64(cpu+192,v.getBigUint64(Number(sp),true),true);v.setBigUint64(cpu+32,sp+8n,true);
 }
}
