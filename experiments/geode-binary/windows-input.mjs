import {GuestLifecycle} from './windows-lifecycle.mjs';
export const INPUT_NAMES=['GetAsyncKeyState','ceilf'];
// Input belongs to this browser document, not the host Windows desktop.
export class BrowserModifiers{
 constructor(target){
  this.down=new Set();this.pressed=new Set();this.controller=new AbortController();
  const update=e=>{
   const keys={Shift:16,Control:17,Alt:18};
   for(const [key,vk] of Object.entries(keys))this.set(vk,e.type==='blur'?false:e.getModifierState(key));
  };
  if(target){for(const type of ['keydown','keyup','blur'])target.addEventListener(type,update,{capture:true,signal:this.controller.signal});}
 }
 set(vk,down){if(down){if(!this.down.has(vk))this.pressed.add(vk);this.down.add(vk);}else this.down.delete(vk);}
 read(vk){if(![16,17,18].includes(vk))throw Error('Unsupported guest async key '+vk);const value=(this.down.has(vk)?0x8000:0)|(this.pressed.delete(vk)?1:0);return value;}
 release(){this.controller.abort();this.down.clear();this.pressed.clear();}
}
export class GuestInput extends GuestLifecycle{
 constructor(memory,addresses,options={}){super(memory,addresses,options);this.input=options.input||new BrowserModifiers();}
 resolve(item){if((item.dll.toLowerCase()==='user32.dll'&&item.name==='GetAsyncKeyState')||(/^api-ms-win-crt-math/i.test(item.dll)&&item.name==='ceilf')){const p=this.addresses[item.name];return p===undefined?undefined:BigInt(p);}return super.resolve(item);}
 invoke(cpu,address){
  if(this.addresses.ceilf!==undefined&&BigInt(this.addresses.ceilf)===address){const v=new DataView(this.memory.buffer),sp=v.getBigUint64(cpu+32,true);this.range(sp,8);v.setFloat32(cpu+512,Math.ceil(v.getFloat32(cpu+512,true)),true);this.calls.push('ceilf');v.setBigUint64(cpu+192,v.getBigUint64(Number(sp),true),true);v.setBigUint64(cpu+32,sp+8n,true);return;}
  if(this.addresses.GetAsyncKeyState===undefined||BigInt(this.addresses.GetAsyncKeyState)!==address)return super.invoke(cpu,address);
  const v=new DataView(this.memory.buffer),vk=Number(v.getBigUint64(cpu+8,true)&0xffffffffn),sp=v.getBigUint64(cpu+32,true);this.range(sp,8);
  v.setBigUint64(cpu,BigInt(this.input.read(vk)),true);this.calls.push('GetAsyncKeyState');v.setBigUint64(cpu+192,v.getBigUint64(Number(sp),true),true);v.setBigUint64(cpu+32,sp+8n,true);
 }
 releaseHeap(){this.input.release?.();super.releaseHeap();}
}
