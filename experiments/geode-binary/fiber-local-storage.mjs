// One registered main context. Live cleanup callbacks require native scheduling.
export class FiberLocalStorage {
 constructor({capacity=128,setLastError=()=>{}}={}){this.capacity=capacity;this.slots=new Map();this.calls=0;this.setLastError=setLastError;}
 invoke(name,memory,cpu,context=1){
  if(context!==1)throw Error('FLS context switching requires scheduler');
  const v=new DataView(memory.buffer),key=name.split('!').at(-1).toLowerCase(),arg=v.getBigUint64(cpu+8,true),index=Number(arg&0xffffffffn);let result;
  const sp=v.getBigUint64(cpu+32,true);if(sp<=0n||sp>0xffffffffn||Number(sp)+8>v.byteLength)throw Error('FLS native stack bounds');if(!['flsalloc','flsgetvalue','flssetvalue','flsfree'].includes(key))throw Error('Unknown FLS service '+name);
  if(key==='flsalloc'&&arg>0xffffffffn)throw Error('FLS callback outside guest address space');
  if(key==='flsfree'&&this.slots.has(index)&&BigInt(this.slots.get(index).callback)&&BigInt(this.slots.get(index).value))throw Error('FLS_CLEANUP_CALLBACK_EXECUTION_REQUIRED');this.calls++;
  if(key==='flsalloc'){
   if(arg>0xffffffffn)throw Error('FLS callback outside guest address space');let free=0;while(free<this.capacity&&this.slots.has(free))free++;
   if(free===this.capacity){result=0xffffffffn;this.setLastError(8);}else{this.slots.set(free,{callback:String(arg),value:'0'});result=BigInt(free);}
  }else if(!this.slots.has(index)){result=0n;this.setLastError(87);}
  else{
   const slot=this.slots.get(index);
   if(key==='flsgetvalue')result=BigInt(slot.value);
   else if(key==='flssetvalue'){slot.value=String(v.getBigUint64(cpu+16,true));result=1n;}
   else if(key==='flsfree'){if(BigInt(slot.callback)&&BigInt(slot.value))throw Error('FLS_CLEANUP_CALLBACK_EXECUTION_REQUIRED');this.slots.delete(index);result=1n;}
   else throw Error('Unknown FLS service '+name);
  }
  v.setBigUint64(cpu,result,true);v.setBigUint64(cpu+192,v.getBigUint64(Number(sp),true),true);v.setBigUint64(cpu+32,sp+8n,true);return result;
 }
 snapshot(){return {capacity:this.capacity,slots:Object.fromEntries(this.slots),calls:this.calls};}
}
