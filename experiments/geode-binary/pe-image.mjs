// PE32+ image mapping only. Does not provide a Windows runtime or execute startup.
// All returned addresses are guest virtual addresses, never JS/table pointers.
const ensure=(ok,text)=>{if(!ok)throw Error('PE mapping: '+text);};
export function mapPe64(input,memory,imageBase,{guestBase=0,resolveImport=()=>undefined}={}) {
  const bytes=new Uint8Array(input),file=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const range=(at,n,max)=>ensure(Number.isSafeInteger(at)&&at>=0&&Number.isSafeInteger(n)&&n>=0&&at+n<=max,'out-of-range image data');
  const u16=at=>{range(at,2,bytes.length);return file.getUint16(at,true);};
  const u32=at=>{range(at,4,bytes.length);return file.getUint32(at,true);};
  const u64=at=>{range(at,8,bytes.length);return file.getBigUint64(at,true);};
  ensure(u16(0)===0x5a4d,'missing MZ');const pe=u32(0x3c);
  ensure(u32(pe)===0x4550&&u16(pe+4)===0x8664,'expected x64 PE');
  const opt=pe+24,sectionCount=u16(pe+6),optionalSize=u16(pe+20);
  ensure(optionalSize>=240&&u16(opt)===0x20b,'expected PE32+ optional header');
  const preferred=u64(opt+24),size=u32(opt+56),headers=u32(opt+60),entryRva=u32(opt+16);
  ensure(Number.isInteger(imageBase)&&imageBase>=0&&imageBase%65536===0,'unaligned image base');
  ensure(Number.isInteger(guestBase)&&guestBase>=0&&imageBase+size<=0x100000000,'image exceeds supported guest address space');
  range(imageBase+guestBase,size,memory.buffer.byteLength);range(0,headers,bytes.length);range(0,headers,size);
  // Validate all source ranges before modifying the destination.
  const sections=[];
  for(let i=0;i<sectionCount;i++) {
    const at=opt+optionalSize+i*40;range(at,40,bytes.length);
    const virtualSize=u32(at+8),rva=u32(at+12),rawSize=u32(at+16),raw=u32(at+20);
    range(rva,Math.max(virtualSize,rawSize),size);range(raw,rawSize,bytes.length);
    sections.push({rva,rawSize,raw});
  }
  const linear=imageBase+guestBase,view=new DataView(memory.buffer),mapped=new Uint8Array(memory.buffer,linear,size);
  mapped.fill(0);mapped.set(bytes.subarray(0,headers));
  for(const s of sections)mapped.set(bytes.subarray(s.raw,s.raw+s.rawSize),s.rva);
  const read32=rva=>{range(rva,4,size);return view.getUint32(linear+rva,true);};
  const read64=rva=>{range(rva,8,size);return view.getBigUint64(linear+rva,true);};
  const write64=(rva,value)=>{range(rva,8,size);view.setBigUint64(linear+rva,BigInt.asUintN(64,value),true);};
  const string=rva=>{range(rva,1,size);let end=rva;
    while(end<size&&end-rva<65536&&mapped[end])end++;
    ensure(end<size&&mapped[end]===0,'unterminated string');return new TextDecoder().decode(mapped.subarray(rva,end));};
  const dirs=u32(opt+108),directory=n=>n<dirs?{rva:u32(opt+112+n*8),size:u32(opt+116+n*8)}:{rva:0,size:0};
  const delta=BigInt(imageBase)-preferred,relocations=directory(5);let relocationCount=0;
  ensure(!delta||relocations.size>0,'image cannot be rebased without relocations');
  range(relocations.rva,relocations.size,size);
  for(let at=relocations.rva;at<relocations.rva+relocations.size;) {
    const page=read32(at),blockSize=read32(at+4);
    ensure(blockSize>=8&&blockSize%2===0&&at+blockSize<=relocations.rva+relocations.size,'invalid relocation block');
    for(let e=at+8;e<at+blockSize;e+=2) {
      const value=view.getUint16(linear+e,true),type=value>>>12,rva=page+(value&4095);
      if(!type)continue;ensure(type===10,'unsupported relocation type '+type);
      write64(rva,read64(rva)+delta);relocationCount++;
    }at+=blockSize;
  }
  const imports=[],unresolvedImports=[];
  function thunks(dll,lookup,iat,delay) {
    for(let n=0;;n++) {
      const thunk=read64(lookup+n*8);if(thunk===0n)break;
      let name,ordinal;
      if(thunk>>63n)ordinal=Number(thunk&65535n);
      else {ensure(thunk<=0xffffffffn,'non-RVA import lookup');name=string(Number(thunk)+2);}
      const item={dll,name,ordinal,delay,iatRva:iat+n*8};imports.push(item);
      const resolved=resolveImport(item);
      if(resolved===undefined||resolved===null){write64(item.iatRva,0n);unresolvedImports.push(item);}
      else {ensure(typeof resolved==='bigint'&&resolved>0n&&resolved<=0xffffffffffffffffn,'import must resolve to a guest VA');write64(item.iatRva,resolved);}
    }
  }
  const normal=directory(1);range(normal.rva,normal.size,size);
  if(normal.rva)for(let at=normal.rva;;at+=20) {
    range(at,20,normal.rva+normal.size);const lookup=read32(at),name=read32(at+12),iat=read32(at+16);
    if(!lookup&&!name&&!iat)break;ensure(name&&iat,'invalid import descriptor');thunks(string(name),lookup||iat,iat,false);
  }
  const delayed=directory(13);range(delayed.rva,delayed.size,size);
  if(delayed.rva)for(let at=delayed.rva;;at+=32) {
    range(at,32,delayed.rva+delayed.size);const attributes=read32(at),name=read32(at+4);
    if(!attributes&&!name)break;ensure(attributes===1,'unsupported legacy delay import format');
    thunks(string(name),read32(at+16),read32(at+12),true);
  }
  const exports=new Map(),exp=directory(0);range(exp.rva,exp.size,size);
  if(exp.rva){const count=read32(exp.rva+24),funcCount=read32(exp.rva+20),names=read32(exp.rva+32),ordinals=read32(exp.rva+36),functions=read32(exp.rva+28);
    for(let n=0;n<count;n++){range(ordinals+n*2,2,size);const index=view.getUint16(linear+ordinals+n*2,true);ensure(index<funcCount,'invalid export ordinal');
      const rva=read32(functions+index*4),name=string(read32(names+n*4));range(rva,1,size);
      exports.set(name,rva>=exp.rva&&rva<exp.rva+exp.size?{forwarder:string(rva)}:{address:BigInt(imageBase+rva),rva});}
  }
  const tls=directory(9),tlsCallbacks=[];range(tls.rva,tls.size,size);
  if(tls.rva) {const callbacks=read64(tls.rva+24);
    if(callbacks){ensure(callbacks>=BigInt(imageBase)&&callbacks<BigInt(imageBase+size),'TLS table outside image');
      for(let n=0;;n++){const callback=read64(Number(callbacks-BigInt(imageBase))+n*8);if(!callback)break;tlsCallbacks.push(callback);}}}
  const unwind=directory(3);range(unwind.rva,unwind.size,size);ensure(unwind.size%12===0,'invalid x64 unwind directory');
  return {imageBase,preferredBase:preferred,size,entry:BigInt(imageBase+entryRva),exports,imports,unresolvedImports,tlsCallbacks,
    relocationCount,unwindEntries:unwind.size/12,initializationExecuted:false};
}
