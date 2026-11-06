// Narrow bridge for one owned entry and one registered hook. No arbitrary x64 patches.
export class OwnedEntryRouter {
 constructor({entry,hook,originalBytes,table,slot,original,wrapped,handle}){
  this.entry=BigInt(entry);this.hook=BigInt(hook);this.bytes=Uint8Array.from(originalBytes);this.table=table;this.slot=slot;this.original=original;this.wrapped=wrapped;this.handle=handle;this.transitions=0;
 }
 apply(bytes){
  bytes=Uint8Array.from(bytes);if(bytes.length!==this.bytes.length)throw Error('Unsupported native patch size');
  const equal=(from)=>bytes.slice(from).every((b,i)=>b===this.bytes[from+i]);let mode;
  if(equal(0))mode='original';
  else if(bytes[0]===0xe9&&equal(5)){
   const target=this.entry+5n+BigInt(new DataView(bytes.buffer).getInt32(1,true));if(target!==this.hook)throw Error('Unregistered native hook target');mode='hooked';
  }else throw Error('Unsupported native patch encoding');
  // Validation completes before either table routing or enable state changes.
  if(mode==='hooked'){this.handle.enable();this.table.set(this.slot,this.wrapped);}
  else {this.handle.disable();this.table.set(this.slot,this.original);}
  this.transitions++;return mode;
 }
}
