// Win32 UTC FILETIME: 100-nanosecond ticks since 1601-01-01.
export function filetimeFromUnixMilliseconds(ms) {
 if(!Number.isSafeInteger(ms))throw Error('Invalid clock value');
 const ticks=(BigInt(ms)+11644473600000n)*10000n;
 if(ticks<0n||ticks>0xffffffffffffffffn)throw Error('FILETIME out of range');
 return ticks;
}
export function getSystemTimeAsFileTime(memory,cpu,clock=Date.now,guestBase=0) {
 const view=new DataView(memory.buffer);
 const linear=(p,n)=>{
  if(p<0n||p>0xffffffffn)throw Error('Guest pointer outside memory32');
  const at=Number(p)+guestBase;
  if(!Number.isSafeInteger(at)||at<0||at+n>memory.buffer.byteLength)throw Error('Guest access outside memory');
  return at;
 };
 const output=linear(view.getBigUint64(cpu+8,true),8);
 const sp=view.getBigUint64(cpu+32,true),stack=linear(sp,8),ret=view.getBigUint64(stack,true);
 const ticks=filetimeFromUnixMilliseconds(clock());
 view.setBigUint64(output,ticks,true);
 // Void return: leave RAX untouched; resume the native Win64 caller.
 view.setBigUint64(cpu+32,sp+8n,true);view.setBigUint64(cpu+192,ret,true);
 return ticks;
}
export function filetimeFromUnixNanoseconds(ns){
 if(typeof ns!=='bigint')throw Error('Precise clock must supply integer nanoseconds');
 const epoch=ns+11644473600000000000n;
 if(epoch<0n||epoch/100n>0xffffffffffffffffn)throw Error('FILETIME out of range');
 return epoch/100n;
}
export function getSystemTimePreciseAsFileTime(memory,cpu,nanoseconds,guestBase=0){
 if(typeof nanoseconds!=='function')throw Error('An explicit high-resolution wall clock is required');
 const v=new DataView(memory.buffer),linear=(p,n)=>{const at=Number(p)+guestBase;if(p<=0n||p>0xffffffffn||!Number.isSafeInteger(at)||at<0||at+n>memory.buffer.byteLength)throw Error('Guest access outside memory');return at;};
 const out=linear(v.getBigUint64(cpu+8,true),8),sp=v.getBigUint64(cpu+32,true),stack=linear(sp,8),ret=v.getBigUint64(stack,true),ticks=filetimeFromUnixNanoseconds(nanoseconds());
 v.setBigUint64(out,ticks,true);v.setBigUint64(cpu+32,sp+8n,true);v.setBigUint64(cpu+192,ret,true);return ticks;
}
// UTC conversion uses Date's independent proleptic-Gregorian implementation.
export function systemTimeToFileTime(memory,cpu,setLastError=()=>{}){
 const v=new DataView(memory.buffer),pointer=(p,n)=>{if(p<=0n||p>0xffffffffn||Number(p)+n>v.byteLength)throw Error('SYSTEMTIME access bounds');return Number(p);};
 const source=pointer(v.getBigUint64(cpu+8,true),16),sp=v.getBigUint64(cpu+32,true),stack=pointer(sp,8);
 const [year,month,weekday,day,hour,minute,second,millis]=Array.from({length:8},(_,i)=>v.getUint16(source+i*2,true));
 const date=new Date(Date.UTC(year,month-1,day,hour,minute,second,millis));
 const valid=year>=1601&&year<=30827&&month>=1&&month<=12&&day>=1&&day<=31&&hour<=23&&minute<=59&&second<=59&&millis<=999&&date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;
 let result=null;if(valid){const output=pointer(v.getBigUint64(cpu+16,true),8);result=filetimeFromUnixMilliseconds(date.valueOf());v.setBigUint64(output,result,true);}else setLastError(87);
 v.setBigUint64(cpu,valid?1n:0n,true);v.setBigUint64(cpu+192,v.getBigUint64(stack,true),true);v.setBigUint64(cpu+32,sp+8n,true);return result;
}
