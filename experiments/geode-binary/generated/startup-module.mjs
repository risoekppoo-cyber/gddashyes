// Standalone startup test only: reserve an isolated compiler stack. The
// existing shared-game auxiliary-module validator remains unchanged.
export async function instantiateStartupLift(bytes,memory,{stackTop=0x900000,stackSize=0x100000,codeWrite}={}) {
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
 const seen=new Set();
 for(const i of imports){
  const kind=i.name==='memory'?'memory':i.name==='lift_fault'||i.name==='code_write'?'function':undefined;
  if(i.module!=='env'||i.kind!==kind||seen.has(i.name))throw Error('Unexpected startup module imports');
  seen.add(i.name);
 }
 if(!seen.has('memory')||!seen.has('lift_fault')||seen.has('code_write')&&typeof codeWrite!=='function')
  throw Error('Unexpected startup module imports');
 if(globals&&(!Number.isSafeInteger(stackTop)||!Number.isSafeInteger(stackSize)||stackSize<=0||stackTop<stackSize||stackTop>memory.buffer.byteLength||stackTop%16))
  throw Error('Missing compiler stack export or invalid reservation');
 const instance=await WebAssembly.instantiate(module,{env:{memory,code_write:codeWrite,lift_fault(code,address,pc){throw Error(`Startup lift fault ${code} at 0x${address.toString(16)}, PC 0x${pc.toString(16)}`);}}});
 if(globals){
  const pointer=instance.exports.__stack_pointer;
  if(!(pointer instanceof WebAssembly.Global))throw Error('Missing compiler stack export or invalid reservation');
  pointer.value=stackTop;
 }
 return instance;
}

