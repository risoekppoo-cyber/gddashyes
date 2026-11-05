import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {mapPe64} from './pe-image.mjs';
import {instantiateLift} from './verify.mjs';
const bytes=await readFile(process.argv[2]),manifest=JSON.parse(await readFile(new URL('dist/manifest.json',import.meta.url)));
assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.dllSha256,'Official DLL hash mismatch');
const memory=new WebAssembly.Memory({initial:1024,maximum:65536}),base=0x2000000,guestBase=0x100000;
const image=mapPe64(bytes,memory,base,{guestBase});
assert.equal(image.relocationCount,56939);assert.equal(image.exports.size,2516);
assert.equal(image.imports.filter(x=>!x.delay).length,656);assert.equal(image.imports.filter(x=>x.delay).length,1353);
assert.equal(image.tlsCallbacks.length,2);assert.equal(image.unwindEntries,32807);
for(const [name,root] of Object.entries(manifest.roots)) {
 const found=[...image.exports.entries()].find(([symbol])=>symbol.startsWith('?'+name+'@Hook@geode@@'));
 assert.equal(found[1].address,BigInt(base)+BigInt(root.rva));
}
for(const i of image.unresolvedImports)assert.equal(new DataView(memory.buffer).getBigUint64(base+guestBase+i.iatRva,true),0n);
const expectedCallbacks=[0xa2e894,0xa2ebc4].map(r=>BigInt(base+r));
assert.deepEqual(image.tlsCallbacks,expectedCallbacks);
const lifted=await instantiateLift(await readFile(new URL('dist/lifted.wasm',import.meta.url)),memory);
const view=new DataView(memory.buffer),cpu=4096,hook=0x40000,impl=0x40100,stack=0x60008,stop=0x1234fedcn;
view.setBigUint64(hook+guestBase,BigInt(impl),true);
view.setBigUint64(impl+guestBase+0x20,0xfedcba9876543210n,true);
for(const [name,expected] of [['getAddress',0xfedcba9876543210n],['getAutoEnable',0n],['setAutoEnable',null],['getAutoEnable',1n]]) {
 new Uint8Array(memory.buffer,cpu,4096).fill(0);
 view.setBigUint64(cpu+8,BigInt(hook),true);view.setBigUint64(cpu+16,1n,true);
 view.setBigUint64(cpu+32,BigInt(stack),true);view.setBigUint64(stack+guestBase,stop,true);
 const entry=[...image.exports.entries()].find(([symbol])=>symbol.startsWith('?'+name+'@Hook@geode@@'))[1].address;
 assert.equal(lifted.exports.lift_run(cpu,entry,BigInt(base),guestBase,stop,128),4);
 assert.equal(view.getBigUint64(cpu+192,true),stop);if(expected!==null)assert.equal(view.getBigUint64(cpu,true),expected);
}
const address=0x70000000n;
const resolved=mapPe64(bytes,memory,base,{guestBase,resolveImport:()=>address});
assert.equal(resolved.unresolvedImports.length,0);
for(const i of resolved.imports)assert.equal(new DataView(memory.buffer).getBigUint64(base+guestBase+i.iatRva,true),address);
// Sentinel import addresses test the mapper only. No imports or entrypoint run.
assert.throws(()=>mapPe64(bytes,memory,base+1),/unaligned/);
const invalid=bytes.slice();invalid[0]=0;assert.throws(()=>mapPe64(invalid,memory,base),/MZ/);
console.log(JSON.stringify({status:'PE_IMAGE_MAPPING_PASS',dllSha256:manifest.dllSha256,
 imageBytes:image.size,rebasedTo:'0x'+base.toString(16),relocationsApplied:image.relocationCount,
 namedExports:image.exports.size,normalImports:656,delayImports:1353,
 unresolvedImports:image.unresolvedImports.length,tlsCallbacksRelocated:true,unwindEntries:image.unwindEntries,
 iatBindingFixture:true,translatedExportsExecutedAfterRebasing:true,windowsServicesImplemented:false,initializationExecuted:false,
 fullGeodeLoader:false,existingGeodePackagesSupported:false},null,2));
