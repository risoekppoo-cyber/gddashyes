export const COCOS_DLL='libcocos2d.dll';
export const COCOS_NODE_SPACE='?convertToNodeSpace@CCNode@cocos2d@@QEAA?AVCCPoint@2@AEBV32@@Z';
// Read-only inspection of the actual game address space, not a new DLL map.
export function inspectCocos(memory,fs){
 const bytes=new Uint8Array(memory.buffer),v=new DataView(memory.buffer);
 const check=(ok,why)=>{if(!ok)throw Error('Game import: '+why);};
 const range=(p,n,limit=v.byteLength)=>{check(Number.isSafeInteger(p)&&p>=0&&Number.isSafeInteger(n)&&n>=0&&p<=limit-n,'bounds');return p;};
 const string=(p,end)=>{range(p,1,end);let text='';for(let i=0;i<4096&&p+i<end;i++){const b=bytes[p+i];if(!b)return text;text+=String.fromCharCode(b);}throw Error('Game import: unterminated string');};
 const file=fs.readFile('/Resources/bin/'+COCOS_DLL+'.img'),source=new DataView(file.buffer,file.byteOffset,file.byteLength);
 check(file.length>=4096&&source.getUint16(0,true)===0x5a4d,'Cocos file MZ');const sp=source.getUint32(0x3c,true);
 check(sp<=3500&&source.getUint32(sp,true)===0x4550&&source.getUint16(sp+24,true)===0x20b,'Cocos file PE');
 const size=source.getUint32(sp+80,true),stamp=source.getUint32(sp+8,true),candidates=[];
 // Cross-check candidate mappings against the live primary image's Cocos IAT.
 const primary=0x400000,pp=v.getUint32(primary+0x3c,true),primarySize=v.getUint32(primary+pp+80,true),primaryEnd=range(primary,primarySize)+primarySize;
 check(v.getUint16(primary,true)===0x5a4d&&pp<=3500&&v.getUint32(primary+pp,true)===0x4550,'primary PE');
 const idir=v.getUint32(primary+pp+144,true),ibytes=v.getUint32(primary+pp+148,true),iat=[];
 if(idir){range(primary+idir,ibytes,primaryEnd);for(let d=primary+idir;d+20<=primary+idir+ibytes;d+=20){
  const lookup=v.getUint32(d,true),name=v.getUint32(d+12,true),first=v.getUint32(d+16,true);if(!lookup&&!name&&!first)break;
  if(string(primary+name,primaryEnd).toLowerCase()!==COCOS_DLL)continue;
  for(let i=0;i<65536;i++){const p=range(primary+first+i*8,8,primaryEnd),address=v.getBigUint64(p,true);if(!address)break;iat.push('0x'+address.toString(16));}
 }}
 for(let base=0;base+4096<=bytes.length;base+=4096){
  if(v.getUint16(base,true)!==0x5a4d)continue;const p=v.getUint32(base+0x3c,true);
  if(p>3500||v.getUint32(base+p,true)!==0x4550||v.getUint16(base+p+4,true)!==0x8664||v.getUint16(base+p+24,true)!==0x20b)continue;
  if(v.getUint32(base+p+80,true)!==size||v.getUint32(base+p+8,true)!==stamp||base+size>bytes.length)continue;
  const refs=iat.filter(a=>BigInt(a)>=BigInt(base)&&BigInt(a)<BigInt(base+size)).length;
  candidates.push({base,pe:p,imageSize:size,timestamp:stamp,primaryIatReferences:refs});
 }
 const matches=candidates.filter(c=>c.primaryIatReferences>0);
 check(matches.length===1,'expected one referenced Cocos mapping; candidates='+JSON.stringify(candidates)+'; IAT sample='+JSON.stringify(iat.slice(0,12)));
 const image=matches[0],base=image.base,end=base+size,pe=base+image.pe;
 const exp=v.getUint32(pe+136,true),expSize=v.getUint32(pe+140,true);range(base+exp,expSize,end);check(expSize>=40,'Cocos export directory');
 const dir=base+exp,count=v.getUint32(dir+24,true),nfunc=v.getUint32(dir+20,true),names=v.getUint32(dir+32,true),ord=v.getUint32(dir+36,true),func=v.getUint32(dir+28,true);
 check(count<=65536&&nfunc<=65536,'export counts');range(base+names,count*4,end);range(base+ord,count*2,end);range(base+func,nfunc*4,end);
 let target;
 for(let i=0;i<count;i++){if(string(base+v.getUint32(base+names+i*4,true),end)!==COCOS_NODE_SPACE)continue;
  const index=v.getUint16(base+ord+i*2,true);check(index<nfunc,'export ordinal');const rva=v.getUint32(base+func+index*4,true);range(base+rva,1,end);check(!(rva>=exp&&rva<exp+expSize),'forwarded Cocos export');target={rva,address:base+rva};break;
 }
 check(target,'missing Cocos export');const pageBase=Math.floor(target.address/4096)*4096;range(pageBase,4096,end);check(pageBase>=base,'target page precedes image');
 return {...image,dll:COCOS_DLL,name:COCOS_NODE_SPACE,...target,pageBase,pageHex:Array.from(bytes.subarray(pageBase,pageBase+4096),b=>b.toString(16).padStart(2,'0')).join(''),candidates,primaryIatCount:iat.length};
}
