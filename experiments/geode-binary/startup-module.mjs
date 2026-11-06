// Standalone startup test only: reserve an isolated compiler stack. The
// existing shared-game auxiliary-module validator remains unchanged.
export async function instantiateStartupLift(bytes,memory,{stackTop=0x900000,stackSize=0x100000}={}) {
 const b=new Uint8Array(bytes);let p=8,globals=0;
 const leb=()=>{let n=0,s=0,v;do{v=b[p++];n+=(v&127)*2**s;s+=7;}while(v&128);return n;};
 while(p<b.length){const id=b[p++],size=leb(),end=p+size;
  if(id===8||id===11)throw Error('Startup module may not initialize memory or execute a start function');
  if(id===6){globals=leb();
   if(globals!==1||b[p++]!==0x7f||b[p++]!==1||b[p++]!==0x41)throw Error('Only an i32 compiler stack global is allowed');
   leb();if(b[p++]!==0x0b||p!==end)throw Error('Unexpected compiler global initializer');
  }p=end;
 }
 const module=await WebAssembly.compile(bytes),imports=WebAssembly.Module.imports(module);
 if(imports.length!==2||!imports.every(i=>i.module==='env'&&(i.name==='memory'&&i.kind==='memory'||i.name==='lift_fault'&&i.kind==='function')))
  throw Error('Unexpected startup module imports');
 const instance=await WebAssembly.instantiate(module,{env:{memory,lift_fault(code,address,pc){throw Error(`Startup lift fault ${code} at 0x${address.toString(16)}, PC 0x${pc.toString(16)}`);}}});
 if(globals){
  const pointer=instance.exports.__stack_pointer;
  if(!(pointer instanceof WebAssembly.Global)||!Number.isInteger(stackTop)||stackTop>memory.buffer.byteLength||stackTop-stackSize<0||stackTop%16)throw Error('Missing compiler stack export or invalid reservation');
  pointer.value=stackTop;
 }
 return instance;
}
