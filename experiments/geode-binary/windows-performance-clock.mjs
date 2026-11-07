import {GuestExceptionPtr} from './windows-exception-ptr.mjs';
export const PERFORMANCE_CLOCK_NAMES=['QueryPerformanceFrequency','QueryPerformanceCounter'];
export class BrowserPerformanceClock{
 constructor(now=()=>globalThis.performance.now()){
  if(typeof now!=='function')throw Error('Monotonic browser clock unavailable');
  this.now=now;Object.defineProperty(this,'frequency',{value:10000000n});
 }
 counter(){
  const ms=this.now(),whole=Math.floor(ms);
  if(!Number.isFinite(ms)||ms<0||!Number.isSafeInteger(whole))throw Error('Invalid monotonic clock sample');
  // Split before conversion so the integer counter is not rounded as a double.
  return BigInt(whole)*10000n+BigInt(Math.floor((ms-whole)*10000));
 }
}
// One process-wide domain, selected independently of the active guest thread.
// 10 MHz is our virtual frequency; browser precision may be coarser than a tick.
export class GuestPerformanceClock extends GuestExceptionPtr{
 constructor(memory,addresses,options={}){
  super(memory,addresses,options);this.performanceClock=options.performanceClock??new BrowserPerformanceClock();
  this.clockFrequency=this.performanceClock.frequency;this.clockLast=null;this.clockReads=0;
  if(typeof this.clockFrequency!=='bigint'||this.clockFrequency<=0n||this.clockFrequency>0x7fffffffffffffffn||typeof this.performanceClock.counter!=='function')throw Error('Invalid guest performance clock');
 }
 resolve(item){if(item.dll.toLowerCase()==='kernel32.dll'&&PERFORMANCE_CLOCK_NAMES.includes(item.name)){const p=this.addresses[item.name];return p===undefined?undefined:BigInt(p);}return super.resolve(item);}
 clockSnapshot(){return {frequency:String(this.clockFrequency),counterReads:this.clockReads,lastCounter:this.clockLast===null?null:String(this.clockLast)};}
 invoke(cpu,address){
  const name=PERFORMANCE_CLOCK_NAMES.find(n=>this.addresses[n]!==undefined&&BigInt(this.addresses[n])===address);if(!name)return super.invoke(cpu,address);
  let v=new DataView(this.memory.buffer);const output=v.getBigUint64(cpu+8,true),sp=v.getBigUint64(cpu+32,true);this.range(output,8);this.range(sp,8);
  const counter=name==='QueryPerformanceCounter',value=counter?this.performanceClock.counter():this.clockFrequency;
  if(typeof value!=='bigint'||value<0n||value>0x7fffffffffffffffn||counter&&this.clockLast!==null&&value<this.clockLast)throw Error('Invalid/non-monotonic guest performance counter');
  v=new DataView(this.memory.buffer);v.setBigInt64(Number(output),value,true);v.setBigUint64(cpu,1n,true);
  if(counter){this.clockReads++;this.clockLast=value;}
  this.calls.push(name);v.setBigUint64(cpu+192,v.getBigUint64(Number(sp),true),true);v.setBigUint64(cpu+32,sp+8n,true);
 }
}
