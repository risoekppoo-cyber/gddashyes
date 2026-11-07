import assert from 'node:assert/strict';
import {GuestIocp,IOCP_NAMES} from '../experiments/geode-binary/windows-iocp.mjs';
const memory=new WebAssembly.Memory({initial:2}),v=new DataView(memory.buffer),cpu=4096,sp=9000,tib=16000,out=20000,key=21000,ovOut=22000,ov=23000,buffer=24000;
const names=[...IOCP_NAMES,'CloseHandle'],addresses=Object.fromEntries(names.map((n,i)=>[n,100+i*16])),s=new GuestIocp(memory,addresses,{tib});
function call(name,a=0,b=0,c=0,d=0,timeout=0){for(const [o,n] of [[8,a],[16,b],[64,c],[72,d]])v.setBigUint64(cpu+o,BigInt(n),true);v.setBigUint64(cpu+32,BigInt(sp),true);v.setBigUint64(sp,321n,true);v.setBigUint64(sp+40,BigInt(timeout),true);s.invoke(cpu,BigInt(addresses[name]));return v.getBigUint64(cpu,true);}
const port=call('CreateIoCompletionPort',0xffffffffffffffffn);v.setUint32(out,123,true);v.setBigUint64(key,456n,true);v.setBigUint64(ovOut,789n,true);
assert.equal(call('GetQueuedCompletionStatus',port,out,key,ovOut),0n);assert.equal(v.getUint32(tib+0x68,true),258);assert.equal(v.getBigUint64(ovOut,true),0n);assert.equal(v.getUint32(out,true),123);assert.equal(v.getBigUint64(key,true),456n);
assert.equal(call('PostQueuedCompletionStatus',port,7,0x1234,0x5678),1n);assert.equal(call('GetQueuedCompletionStatus',port,out,key,ovOut),1n);assert.equal(v.getUint32(out,true),7);assert.equal(v.getBigUint64(key,true),0x1234n);assert.equal(v.getBigUint64(ovOut,true),0x5678n);
const {value:server}=s.createPipe('\\\\.\\pipe\\geode-test',0x40000001,8,1,0,1024,0,0n);assert.equal(s.createPort(server,port,99n,0).value,port);assert.equal(s.createPort(server,port,99n,0).error,87);
const pipe=s.pipeEnds.get(server).pipe,client=s.nextPipeHandle++;pipe.everConnected=true;pipe.clients.add(client);s.pipeEnds.set(client,{pipe,side:'client'});
assert.equal(s.read(server,BigInt(buffer),32,BigInt(out),BigInt(ov)).error,997);assert.equal(s.write(client,new TextEncoder().encode('log')).value,1n);
assert.equal(call('GetQueuedCompletionStatus',port,out,key,ovOut),1n);assert.equal(v.getUint32(out,true),3);assert.equal(v.getBigUint64(key,true),99n);assert.equal(v.getBigUint64(ovOut,true),BigInt(ov));assert.equal(Buffer.from(memory.buffer,buffer,3).toString(),'log');
s.read(server,BigInt(buffer),32,BigInt(out),BigInt(ov));s.closePipe(client);assert.equal(call('GetQueuedCompletionStatus',port,out,key,ovOut),0n);assert.equal(v.getUint32(tib+0x68,true),109);assert.equal(v.getBigUint64(ovOut,true),BigInt(ov));
assert.throws(()=>call('GetQueuedCompletionStatus',port,out,key,ovOut,0xffffffff),/scheduler/);assert.equal(call('CloseHandle',port),1n);assert.equal(s.ports.size,0);
console.log('PASS: IOCP post/dequeue, timeout outputs, real pipe completion delivery, failed packets and explicit blocking boundary');
