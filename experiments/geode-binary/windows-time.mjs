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
