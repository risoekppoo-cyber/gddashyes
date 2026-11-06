import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GuestModules} from './guest-modules.mjs';
import {StartupServices} from './windows-startup.mjs';
import {GuestThreads} from './windows-threads.mjs';
const dir=process.argv[2],expected=JSON.parse(await readFile(dir+'/expected.json')),report=JSON.parse(await readFile(dir+'/report.json'));
const memory=new WebAssembly.Memory({initial:Math.max(1024,...expected.modules.map(m=>Math.ceil((m.base+m.size)/65536)))}),v=new DataView(memory.buffer),cpu=4096;
for(const m of expected.modules)new Uint8Array(memory.buffer,m.base,m.size).set(await readFile(m.name==='Geode.dll'?dir+'/image.bin':dir+'/module-'+m.base.toString(16)+'.bin'));
let error=0;const modules=new GuestModules(expected.modules,{setLastError:value=>error=value});
const ntdll=modules.handle('NtDlL'),kernel=modules.handle('C:\\Windows\\System32\\KERNEL32.DLL');
assert.equal(modules.handle('kernel32.dll.'),kernel);
if(expected.modules.some(m=>m.primary))assert.equal(modules.handle(null),expected.modules.find(m=>m.primary).base);else assert.throws(()=>modules.handle(null),/PRIMARY_EXECUTABLE/);
assert.throws(()=>modules.handle('unknown'),/UNMODELED_MODULE/);
assert.throws(()=>modules.handle('D:\\other\\kernel32.dll'),/UNMODELED_MODULE_PATH/);
assert.throws(()=>modules.resolve(memory,ntdll,'RtlUnknownService'),/UNMODELED_EXPORT/);
assert.throws(()=>modules.resolve(memory,ntdll,'rtlgetversion'),/UNMODELED_EXPORT/);
assert.throws(()=>modules.resolve(memory,ntdll,1),/UNMODELED_SHIM_ORDINAL/);
assert.equal(modules.resolve(memory,ntdll,'wine_get_version'),0);assert.equal(error,127);
assert.equal(modules.resolve(memory,modules.handle('Geode'),'clearly_not_a_geode_export'),0);
if(expected.modules.some(m=>m.sliceOnly))assert.throws(()=>modules.handle('MSVCP140.dll'),/MSVCP_RUNTIME_INITIALIZATION_REQUIRED/);
const primary=expected.modules.find(m=>m.primary);if(primary)assert.equal(modules.resolve(memory,primary.base,'absent_export'),0);
const contract=expected.modules.find(m=>m.systemContract);if(contract){assert.equal(modules.loadContract('api-ms-win-core-synch-l1-2-0',0x800n,0n),contract.base);assert.equal(contract.loadReferences,1);assert.throws(()=>modules.loadContract(contract.name,0n,0n),/LOAD_FLAGS/);assert.throws(()=>modules.loadContract('kernel32',0x800n,0n),/UNMODELED_SYSTEM_LIBRARY_LOAD/);assert.throws(()=>modules.resolve(memory,contract.base,'WaitOnAddress'),/UNMODELED_EXPORT/);}
const address=modules.resolve(memory,ntdll,'RtlGetVersion');
assert.equal(expected.moduleGateways['0x'+address.toString(16)],'ntdll.dll!RtlGetVersion');
const prepare=()=>{v.setBigUint64(cpu+32,8192n,true);v.setBigUint64(8192,0x1234fedcn,true);};
prepare();v.setBigUint64(cpu+8,12288n,true);v.setUint32(12288,284,true);
new StartupServices().invoke(expected.moduleGateways['0x'+address.toString(16)],memory,cpu);
assert.equal(v.getBigUint64(cpu,true),0n);assert.equal(v.getUint32(12292,true),10);assert.equal(v.getBigUint64(cpu+192,true),0x1234fedcn);
const threads=new GuestThreads();threads.register('main');
for(const name of ['alpha','new name 😀']){
 prepare();v.setBigUint64(cpu+8,0xfffffffffffffffen,true);v.setBigUint64(cpu+16,16384n,true);
 new Uint8Array(memory.buffer,16384).set(Buffer.from(name+'\0','utf16le'));
 threads.invoke('kernel32.dll!SetThreadDescription',memory,cpu,'main');
 prepare();v.setBigUint64(cpu+16,20480n,true);threads.invoke('kernel32.dll!GetThreadDescription',memory,cpu,'main');
 const p=Number(v.getBigUint64(20480,true));assert.equal(Buffer.from(memory.buffer,p,(name.length+1)*2).toString('utf16le'),name+'\0');
 prepare();v.setBigUint64(cpu+8,BigInt(p),true);threads.invoke('kernel32.dll!LocalFree',memory,cpu,'main');assert.equal(threads.localAllocations.size,0);
 assert.throws(()=>threads.invoke('kernel32.dll!LocalFree',memory,cpu,'main'),/UNMODELED_LOCAL_HANDLE/);
}
prepare();v.setBigUint64(cpu+8,123n,true);assert.throws(()=>threads.invoke('kernel32.dll!GetThreadDescription',memory,cpu,'main'),/UNMODELED_THREAD_HANDLE/);
for(const check of report.nativeExportChecks){assert.equal(modules.resolve(memory,check.module,check.name),check.address);assert.equal(modules.resolve(memory,check.module,check.ordinal),check.address);}
for(const m of expected.modules.filter(m=>m.browserAdapterProvider)){
 for(const [name,entry] of Object.entries(m.entries)){assert.equal(modules.resolve(memory,m.base,name),entry.address);assert.equal(Buffer.from(memory.buffer,entry.address,entry.codeHex.length/2).toString('hex'),entry.codeHex);}
 assert.throws(()=>modules.resolve(memory,m.base,'unimplemented_fmod_export'),/UNMODELED_EXPORT/);
}
const pathModule=expected.modules.find(m=>m.primary&&m.path);
if(pathModule){
 const run=(capacity)=>{prepare();v.setBigUint64(cpu+8,0n,true);v.setBigUint64(cpu+16,24576n,true);v.setBigUint64(cpu+64,BigInt(capacity),true);return modules.invoke('KERNEL32.dll!GetModuleFileNameW',memory,cpu);};
 error=42;assert.equal(run(pathModule.path.length+1),pathModule.path.length);assert.equal(error,42);assert.equal(Buffer.from(memory.buffer,24576,(pathModule.path.length+1)*2).toString('utf16le'),pathModule.path+'\0');
 assert.equal(run(1),1);assert.equal(error,122);assert.equal(v.getUint16(24576,true),0);assert.equal(run(0),0);
}
const header=v.getUint32(ntdll+0x3c,true);v.setUint32(ntdll+header+24+112,0x10001,true);
assert.throws(()=>modules.resolve(memory,ntdll,'RtlGetVersion'),/bounds/);
console.log('PASS: PE export resolution, explicit absence, unknown rejection, callable gateway, UTF-16 thread name ownership');
