// Bounded CRT byte/string operations on guest memory; memcpy overlap is rejected.
export function crtString(name,memory,cpu){
 const v=new DataView(memory.buffer),bytes=new Uint8Array(memory.buffer),a=v.getBigUint64(cpu+8,true),b=v.getBigUint64(cpu+16,true),n=v.getBigUint64(cpu+64,true),symbol=name.split('!').at(-1);
 const range=(p,size)=>{if(p<=0n||p>0xffffffffn||size<0n||size>0x800000n||p+size>BigInt(bytes.length))throw Error('CRT string access bounds');return Number(p);};
 const length=(p,wide=false)=>{for(let i=0;i<0x800000/(wide?2:1);i++){const at=range(p+BigInt(i*(wide?2:1)),BigInt(wide?2:1));if((wide?v.getUint16(at,true):bytes[at])===0)return i;}throw Error('CRT unterminated string');};
 let result;
 if(symbol==='strlen'||symbol==='wcslen')result=BigInt(length(a,symbol==='wcslen'));
 else if(symbol==='memcpy'||symbol==='memmove'){
  if(n){const to=range(a,n),from=range(b,n);if(symbol==='memcpy'&&to<from+Number(n)&&from<to+Number(n))throw Error('CRT memcpy overlap');bytes.copyWithin(to,from,from+Number(n));}result=a;
 }else if(symbol==='memset'){if(n)bytes.fill(Number(b&255n),range(a,n),Number(a+n));result=a;}
 else if(symbol==='memchr'){
  result=0n;if(n){const from=range(a,n),found=bytes.subarray(from,from+Number(n)).indexOf(Number(b&255n));if(found>=0)result=a+BigInt(found);}
 }else if(symbol==='memcmp'){
  result=0n;if(n){const x=range(a,n),y=range(b,n);for(let i=0;i<Number(n);i++)if(bytes[x+i]!==bytes[y+i]){result=BigInt(bytes[x+i]-bytes[y+i]);break;}}
  result=BigInt.asUintN(32,result);
 }else throw Error('Unknown CRT string API');
 const sp=v.getBigUint64(cpu+32,true),stack=range(sp,8n);v.setBigUint64(cpu,result,true);v.setBigUint64(cpu+192,v.getBigUint64(stack,true),true);v.setBigUint64(cpu+32,sp+8n,true);return result;
}
