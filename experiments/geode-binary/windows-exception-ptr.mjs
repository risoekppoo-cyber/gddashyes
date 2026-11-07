import {GuestThreadBoundary} from './thread-boundary.mjs';
export const EXCEPTION_PTR_NAMES=['?__ExceptionPtrCreate@@YAXPEAX@Z','?__ExceptionPtrDestroy@@YAXPEAX@Z','?__ExceptionPtrCopy@@YAXPEAXPEBX@Z','?__ExceptionPtrAssign@@YAXPEAXPEBX@Z','?__ExceptionPtrToBool@@YA_NPEBX@Z'];
// Native-checked empty shared_ptr<EXCEPTION_RECORD> profile. This is object
// lifetime support, not exception dispatch, record capture or unwinding.
// Microsoft/STL stl/src/excptptr.cpp, commit e1ed302683e5e822f663fbb0f44cee7e9ddc6af0.
export class GuestExceptionPtr extends GuestThreadBoundary{
 constructor(memory,addresses,options={}){super(memory,addresses,options);this.exceptionPointers=new Set();}
 resolve(item){if(item.dll.toLowerCase()==='msvcp140.dll'&&EXCEPTION_PTR_NAMES.includes(item.name)){const p=this.addresses[item.name];return p===undefined?undefined:BigInt(p);}return super.resolve(item);}
 exceptionSnapshot(){return [...this.exceptionPointers].map(String);}
 exceptionAddress(pointer){const p=this.range(pointer,16);if(p%8)throw Error('Unaligned exception_ptr storage');return p;}
 emptyException(p){if(!this.exceptionPointers.has(p))throw Error('Unowned exception_ptr lifetime');const v=new DataView(this.memory.buffer);if(v.getBigUint64(p,true)||v.getBigUint64(p+8,true))throw Error('Non-empty exception_ptr requires exception record ownership');}
 invoke(cpu,address){
  const name=EXCEPTION_PTR_NAMES.find(n=>this.addresses[n]!==undefined&&BigInt(this.addresses[n])===address);if(!name)return super.invoke(cpu,address);
  const v=new DataView(this.memory.buffer),sp=v.getBigUint64(cpu+32,true),p=this.exceptionAddress(v.getBigUint64(cpu+8,true)),op=EXCEPTION_PTR_NAMES.indexOf(name);this.range(sp,8);
  if(op===0||op===2){
   if(this.exceptionPointers.has(p))throw Error('Exception pointer already constructed');
   if(op===2)this.emptyException(this.exceptionAddress(v.getBigUint64(cpu+16,true)));
   v.setBigUint64(p,0n,true);v.setBigUint64(p+8,0n,true);this.exceptionPointers.add(p);
  }else{
   this.emptyException(p);
   if(op===1)this.exceptionPointers.delete(p);
   else if(op===3)this.emptyException(this.exceptionAddress(v.getBigUint64(cpu+16,true)));
   else v.setBigUint64(cpu,0n,true);
  }
  this.calls.push(name);v.setBigUint64(cpu+192,v.getBigUint64(Number(sp),true),true);v.setBigUint64(cpu+32,sp+8n,true);
 }
 free(pointer){const allocation=this.heap.get(Number(pointer));super.free(pointer);if(allocation)for(const p of this.exceptionPointers)if(p>=Number(pointer)&&p<Number(pointer)+allocation.size)this.exceptionPointers.delete(p);}
 releaseHeap(){let first;try{super.releaseHeap();}catch(error){first=error;}this.exceptionPointers.clear();if(first)throw first;}
}
