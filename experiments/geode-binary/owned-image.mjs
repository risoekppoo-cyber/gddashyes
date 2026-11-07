// Only the pinned guestBase=0 runtime is supported. Allocator-owned backing
// also owns the identical guest interval; no fixed-address free-space guess.
import {mapPe64} from './pe-image.mjs';
const HASH='ccedc2f1c86baf342f6720b9685991ca31fba246453efe2a1daf609dc40b6499';
export async function prepareGeodeImage(input){
 const bytes=new Uint8Array(input);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
 if(hash!==HASH)throw Error('Expected the pinned Geode 6.0.0-alpha.1 Windows DLL');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),pe=v.getUint32(0x3c,true);
 if(v.getUint16(0,true)!==0x5a4d||v.getUint32(pe,true)!==0x4550||v.getUint16(pe+4,true)!==0x8664)throw Error('Expected PE64 DLL');
 const size=v.getUint32(pe+80,true);
 if(size!==17035264)throw Error('Pinned Geode image size mismatch');
 return {bytes,size,sha256:hash};
}
export function mapOwnedGeodeImage(prepared,e,guestBase,blocked=[],resolveImport){
 if(guestBase!==0)throw Error('Owned DLL mapping requires the pinned identity guest mapping');
 if(typeof e.malloc!=='function'||typeof e.free!=='function')throw Error('Missing game allocator');
 const capacity=prepared.size+65535,raw=e.malloc(capacity);
 let released=false;
 const release=()=>{if(!released){e.free(raw);released=true;}};
 try{
  if(!Number.isSafeInteger(raw)||raw<=0)throw Error('Could not reserve DLL backing');
  const base=Math.ceil(raw/65536)*65536,end=base+prepared.size;
  if(raw+capacity>e.memory.buffer.byteLength||end>raw+capacity||end>0x100000000)throw Error('DLL allocation bounds');
  if(blocked.some(([a,b])=>raw<b&&raw+capacity>a))throw Error('DLL allocation overlaps live CPU or stack');
  const image=mapPe64(prepared.bytes,e.memory,base,{guestBase,resolveImport});
  return {image,release,reservation:{allocator:'game malloc',rawLinear:raw,allocationBytes:capacity,guestBase,guestStart:base,guestEnd:end,linearStart:base,linearEnd:end,active:true}};
 }catch(error){if(raw)release();throw error;}
}
