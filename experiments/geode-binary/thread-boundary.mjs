import {GuestIocp} from './windows-iocp.mjs';
export const THREAD_BOUNDARY_NAMES=['_beginthreadex'];
// Addressable diagnostic trap, not a thread implementation. The lift stops at
// this entry before invoking it; no handle or thread ID is fabricated.
export class GuestThreadBoundary extends GuestIocp{
 resolve(item){if(item.name==='_beginthreadex'&&/^(api-ms-win-crt-runtime|ucrtbase)/i.test(item.dll)){const p=this.addresses[item.name];return p===undefined?undefined:BigInt(p);}return super.resolve(item);}
 invoke(cpu,address){if(this.addresses._beginthreadex!==undefined&&BigInt(this.addresses._beginthreadex)===address)throw Error('Guest worker creation requires a real scheduler');return super.invoke(cpu,address);}
 readThreadRequest(cpu,imageBase){const v=new DataView(this.memory.buffer),sp=v.getBigUint64(cpu+32,true);this.range(sp,56);const start=v.getBigUint64(cpu+64,true),arg=v.getBigUint64(cpu+72,true),idOut=v.getBigUint64(Number(sp)+48,true);return {security:'0x'+v.getBigUint64(cpu+8,true).toString(16),stackSize:v.getUint32(cpu+16,true),entryAddress:'0x'+start.toString(16),entryRva:start>=BigInt(imageBase)&&start<BigInt(imageBase+17035264)?Number(start-BigInt(imageBase)):null,argument:'0x'+arg.toString(16),argumentIsNull:arg===0n,initFlags:v.getUint32(Number(sp)+40,true),threadIdOutput:'0x'+idOut.toString(16),threadIdOutputIsNull:idOut===0n,threadCreationImplemented:false};}
}
