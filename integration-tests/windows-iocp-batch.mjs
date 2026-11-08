import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GuestIocpBatch} from '../experiments/geode-binary/windows-iocp-batch.mjs';
const native=JSON.parse(await readFile(new URL('./iocp-batch-native-result.json',import.meta.url)));
assert.equal(native.status,'IOCP_BATCH_NATIVE_PASS');assert.equal(native.entryBytes,32);assert.deepEqual(native.offsets,{key:0,ov:8,internal:16,bytes:24});
const memory=new WebAssembly.Memory({initial:4}),v=new DataView(memory.buffer),cpu=4096,sp=9000,tib=12000,entries=20000,removed=24000;
let heap=40000;const allocator={malloc(n){const p=heap;heap=Math.ceil((p+n)/16)*16;return p;},free(){}};
const names=['GetQueuedCompletionStatusEx','CreateIoCompletionPort','PostQueuedCompletionStatus'],addresses=Object.fromEntries(names.map((n,i)=>[n,100+i*16])),s=new GuestIocpBatch(memory,addresses,{tib,allocator});
function call(name,args){for(const [i,o] of [8,16,64,72].entries())v.setBigUint64(cpu+o,BigInt(args[i]??0),true);v.setBigUint64(cpu+32,BigInt(sp),true);v.setBigUint64(sp,1234n,true);s.invoke(cpu,BigInt(addresses[name]));assert.equal(v.getBigUint64(cpu+192,true),1234n);assert.equal(v.getBigUint64(cpu+32,true),BigInt(sp+8));return v.getBigUint64(cpu,true);}
const port=call('CreateIoCompletionPort',[0xffffffffffffffffn,0n,0n,0n]);
function batch(capacity=64,handle=port,timeout=0,alertable=0,pointer=entries){
 new Uint8Array(memory.buffer,entries-16,64*32+32).fill(0xa5);v.setUint32(removed,123,true);v.setUint32(tib+0x68,0x4321,true);v.setUint32(sp+40,timeout,true);v.setUint32(sp+48,alertable,true);
 const ok=call('GetQueuedCompletionStatusEx',[handle,BigInt(pointer),BigInt(capacity),BigInt(removed)])!==0n,error=v.getUint32(tib+0x68,true),count=v.getUint32(removed,true),written=ok?count:0,records=[];
 for(let i=0;i<written;i++){const p=entries+i*32;records.push({key:Number(v.getBigUint64(p,true)),ov:Number(v.getBigUint64(p+8,true)),internal:Number(v.getBigUint64(p+16,true)),bytes:v.getUint32(p+24,true),hex:Buffer.from(memory.buffer,p,32).toString('hex')});}
 for(const p of [entries-16,entries+64*32])assert.deepEqual([...new Uint8Array(memory.buffer,p,16)],Array(16).fill(0xa5));
 assert.ok(new Uint8Array(memory.buffer,entries+written*32,(64-written)*32).every(b=>b===0xa5));
 return {ok,error,removed:count,entries:records,unusedEntriesPreserved:true};
}
assert.deepEqual(batch(),native.empty);assert.deepEqual(batch(64,0n),native.invalid);assert.deepEqual(batch(0),native.zeroCapacity);
for(const record of [...native.firstBatch.entries,...native.secondBatch.entries])assert.equal(call('PostQueuedCompletionStatus',[port,BigInt(record.bytes),BigInt(record.key),BigInt(record.ov)]),1n);
assert.deepEqual(batch(2),native.firstBatch);assert.deepEqual(batch(),native.secondBatch);assert.deepEqual(batch(),native.afterDrain);
call('PostQueuedCompletionStatus',[port,1n,2n,3n]);const queue=s.ports.get(port).queue;
assert.throws(()=>batch(64,port,1),/scheduler/);assert.throws(()=>batch(64,port,0,1),/scheduler/);assert.throws(()=>batch(65),/capacity/);assert.throws(()=>batch(64,port,0,0,memory.buffer.byteLength-8),/bounds/);assert.equal(queue.length,1);
batch();assert.equal(queue.length,0);
// The exact same FIFO handles real overlapped read completions.
const path='\\\\.\\pipe\\batch-test',server=s.createPipe(path,0x40000001,8,1,0,1024,0,0n).value;
assert.equal(s.createPort(server,port,0x1234n,0).value,port);s.initializeStdio();s.reopen(66500n,path,'wb',s.stdioBase+88n);
const client=s.fds.get(1).handle,ov=65536n,buffer=66000n;new Uint8Array(memory.buffer,Number(ov),32).fill(0);
assert.equal(s.read(server,buffer,16,0n,ov).error,997);s.write(client,Uint8Array.from([108,111,103]));assert.deepEqual(batch(),native.pipeSuccess);assert.equal(Buffer.from(memory.buffer,Number(buffer),3).toString('hex'),native.dataHex);
new Uint8Array(memory.buffer,Number(ov),32).fill(0);assert.equal(s.read(server,buffer,16,0n,ov).error,997);s.closePipe(client);assert.deepEqual(batch(),native.pipeFailure);
assert.deepEqual(s.batchSnapshot().at(-1).packetStatuses,['3221225803']);assert.equal(s.batchSnapshot().at(-1).error,0,'failed I/O packet is a successful dequeue');
s.releaseHeap();
console.log('PASS: Windows-checked IOCP batch layout/FIFO/counts, timeout and invalid outputs, real pipe success/failure status, padding/guards and explicit wait/APC rejection');
