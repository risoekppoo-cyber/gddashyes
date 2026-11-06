// Opaque per-guest-process pointer encoding, not an instruction/address mapping.
export class PointerEncoding {
 constructor(key){this.key=BigInt(key);if(this.key<=0n||this.key>0xffffffffffffffffn)throw Error('Invalid guest pointer key');this.encodes=0;this.decodes=0;}
 invoke(name,memory,cpu){
  const v=new DataView(memory.buffer),input=v.getBigUint64(cpu+8,true),sp=v.getBigUint64(cpu+32,true),mask=0xffffffffffffffffn;
  if(sp<=0n||sp>0xffffffffn||Number(sp)+8>v.byteLength)throw Error('Encoded-pointer return bounds');
  let result;
  if(name.toLowerCase().endsWith('!encodepointer')){const bits=input^this.key;result=((bits<<17n)|(bits>>47n))&mask;this.encodes++;}
  else if(name.toLowerCase().endsWith('!decodepointer')){result=((input>>17n)|(input<<47n))&mask;result^=this.key;this.decodes++;}
  else throw Error('Unknown pointer-encoding API');
  v.setBigUint64(cpu,result,true);v.setBigUint64(cpu+192,v.getBigUint64(Number(sp),true),true);v.setBigUint64(cpu+32,sp+8n,true);return result;
 }
}
