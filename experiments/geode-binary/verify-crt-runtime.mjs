import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {CrtRuntime} from './crt-runtime.mjs';
import {CriticalSections} from './critical-sections.mjs';
import {PointerEncoding} from './pointer-encoding.mjs';
import {StartupServices} from './windows-startup.mjs';
const memory=new WebAssembly.Memory({initial:256}),v=new DataView(memory.buffer),cpu=4096,crt=new CrtRuntime(memory),critical=new CriticalSections();
function prepare(a=0n,b=0n,c=0n,d=0n){v.setBigUint64(cpu,55n,true);v.setBigUint64(cpu+8,a,true);v.setBigUint64(cpu+16,b,true);v.setBigUint64(cpu+64,c,true);v.setBigUint64(cpu+72,d,true);v.setBigUint64(cpu+32,8192n,true);v.setBigUint64(8192,0x1234fedcn,true);}
function call(name,a=0n,b=0n,c=0n,d=0n,thread=1){prepare(a,b,c,d);const result=crt.invoke('crt!'+name,cpu,thread);assert.equal(v.getBigUint64(cpu+192,true),0x1234fedcn);assert.equal(v.getBigUint64(cpu+32,true),8200n);return result;}
const stderr=call('__acrt_iob_func',2n);assert.equal(call('__acrt_iob_func',2n),stderr);
call('_get_stream_buffer_pointers',stderr,12288n,12296n,12304n);
const base=v.getBigUint64(12288,true),ptr=v.getBigUint64(12296,true),count=v.getBigUint64(12304,true);
assert.equal(base,stderr+8n);assert.equal(ptr,stderr+16n);assert.equal(count,stderr+24n);
v.setBigUint64(Number(ptr),16384n,true);v.setInt32(Number(count),17,true);call('_get_stream_buffer_pointers',stderr,0n,12312n,0n);assert.equal(v.getBigUint64(Number(v.getBigUint64(12312,true)),true),16384n);
call('_lock_file',stderr);call('_lock_file',stderr);assert.throws(()=>call('_lock_file',stderr,0n,0n,0n,2),/scheduler/);call('_unlock_file',stderr);call('_unlock_file',stderr);assert.throws(()=>call('_unlock_file',stderr),/non-owner/);
call('_lock_locales');call('_lock_locales');call('_unlock_locales');call('_unlock_locales');assert.equal(crt.localeLock.depth,0);
assert.equal(call('setlocale',0n),BigInt(crt.base+0x100));assert.equal(call('___lc_codepage_func'),0n);assert.equal(call('___mb_cur_max_func'),1n);
const reference=JSON.parse(await readFile(new URL('./c-locale-reference.json',import.meta.url)));assert.equal(createHash('sha256').update(new Uint8Array(memory.buffer,crt.base+0x800,768)).digest('hex'),reference.sha256,'C classification table differs from original Microsoft functional data');
const conversion=Number(call('localeconv'));assert.equal(v.getUint8(Number(v.getBigUint64(conversion,true))),46);assert.equal(v.getUint16(Number(v.getBigUint64(conversion+88,true)),true),46);assert.deepEqual([...new Uint8Array(memory.buffer,conversion+80,8)],Array(8).fill(127));
assert.equal(call('__pctype_func'),BigInt(crt.base+0x900));assert.equal(v.getUint16(crt.base+0x900+65*2,true),0x81);assert.equal(v.getUint16(crt.base+0x900-2,true),0);
assert.equal(call('_crt_atexit',0x12001000n),0n);assert.deepEqual(crt.snapshot().callbacks,['301993984']);assert.equal(call('_set_new_handler',0x12002000n),0n);assert.equal(call('_set_new_handler',0n),0x12002000n);
function lock(name,thread=1){prepare(24576n,4000n,0n);return critical.invoke('KERNEL32.dll!'+name,memory,cpu,thread);}
assert.equal(lock('InitializeCriticalSectionEx'),1n);lock('EnterCriticalSection');lock('EnterCriticalSection');assert.equal(v.getInt32(24588,true),2);assert.equal(lock('TryEnterCriticalSection',2),0n);assert.throws(()=>lock('EnterCriticalSection',2),/scheduler/);assert.throws(()=>lock('LeaveCriticalSection',2),/non-owner/);assert.throws(()=>lock('DeleteCriticalSection'),/owned/);lock('LeaveCriticalSection');lock('LeaveCriticalSection');assert.equal(v.getInt32(24584,true),-1);lock('DeleteCriticalSection');assert.throws(()=>lock('EnterCriticalSection'),/not initialized/);
const encoding=new PointerEncoding(0xa7b12c3d4e5f6789n);
for(const pointer of [0n,1n,0x12001000n,0xffffffffffffffffn]){prepare(pointer);const encoded=encoding.invoke('kernel32.dll!EncodePointer',memory,cpu);prepare(encoded);assert.equal(encoding.invoke('kernel32.dll!DecodePointer',memory,cpu),pointer);}
const services=new StartupServices();prepare(0n,0n);assert.equal(services.invoke('KERNEL32.dll!GetTempPath2W',memory,cpu),12n);prepare(12n,32768n);assert.equal(services.invoke('KERNEL32.dll!GetTempPathW',memory,cpu),11n);assert.equal(Buffer.from(memory.buffer,32768,24).toString('utf16le'),'C:\\Windows\\\0');
console.log('PASS: native CRT stream indirection, recursive locks, exact C locale table, callback ownership, pointer round trips and temp-path buffer contract');
