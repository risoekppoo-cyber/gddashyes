import {GuestDebugger} from './windows-debugger.mjs';
export const CONSOLE_NAMES=['GetStdHandle','GetConsoleMode','SetConsoleMode','AttachConsole'];
// Browser-hosted GUI profile: no Win32 console is attached. This reports
// actual absence/failure and never claims console output succeeded.
export class GuestConsole extends GuestDebugger{
 invoke(cpu,address){
  const name=CONSOLE_NAMES.find(n=>this.addresses[n]!==undefined&&BigInt(this.addresses[n])===address);if(!name)return super.invoke(cpu,address);
  const v=new DataView(this.memory.buffer),sp=v.getBigUint64(cpu+32,true);this.range(sp,8);let result=0n,error=0;
  if(name==='GetStdHandle'){if(![0xfffffff6,0xfffffff5,0xfffffff4].includes(v.getUint32(cpu+8,true))){result=0xffffffffffffffffn;error=6;}}
  else{if(name==='AttachConsole'&&v.getUint32(cpu+8,true)!==0xffffffff)throw Error('Unsupported guest console attach target');error=6;}
  if(error)v.setUint32(this.tib+0x68,error,true);
  v.setBigUint64(cpu,result,true);this.calls.push(name);v.setBigUint64(cpu+192,v.getBigUint64(Number(sp),true),true);v.setBigUint64(cpu+32,sp+8n,true);
 }
}
