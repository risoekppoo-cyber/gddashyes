// Win64 float argument/result in XMM0; integer bit rounding avoids host FP state.
export function ceilf(memory,cpu){
 const v=new DataView(memory.buffer),bits=v.getUint32(cpu+256,true),exponent=(bits>>>23)&255,negative=bits>>>31;
 if(exponent===255)throw Error('UNMODELED_CRT_NONFINITE');
 let result=bits,shift=150-exponent;
 if(shift>23){if(bits&0x7fffffff)result=negative?0x80000000:0x3f800000;}
 else if(shift>0){const mask=2**shift-1;if(bits&mask){result=(bits&~mask)>>>0;if(!negative)result=(result+2**shift)>>>0;}}
 const sp=v.getBigUint64(cpu+32,true);if(sp<=0n||sp>0xffffffffn||Number(sp)+8>memory.buffer.byteLength)throw Error('CRT math return bounds');
 v.setUint32(cpu+256,result,true);v.setBigUint64(cpu+192,v.getBigUint64(Number(sp),true),true);v.setBigUint64(cpu+32,sp+8n,true);return result;
}
