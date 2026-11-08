import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {GeodePackage,crc32} from '../experiments/geode-binary/geode-package.mjs';
import {chromium} from 'playwright';
const root=resolve(process.argv[2]||'integration-input/jukebox-oracle'),bytes=await readFile(root+'/integration-input/jukebox-official.geode'),oracle=JSON.parse(await readFile(root+'/jukebox-package-preflight.json','utf8'));
assert.equal(createHash('sha256').update(bytes).digest('hex'),oracle.packageSha256);
const archive=new GeodePackage(bytes);let verified=0;
for(const [name,hash] of Object.entries(oracle.entryHashes)){assert.equal(createHash('sha256').update(await archive.read(name)).digest('hex'),hash,name);verified++;}
assert.equal((await archive.manifest()).id,'fleym.nongd');assert.equal((await archive.windowsDll()).bytes[0],0x4d);
assert.throws(()=>new GeodePackage(bytes.subarray(0,bytes.length-10)),/Geode package/);
assert.throws(()=>new GeodePackage(bytes,{maxArchiveBytes:1}),/bound/);
assert.throws(()=>new GeodePackage(bytes,{maxEntryBytes:1}),/bound/);
const entry=[...archive.entries.values()].find(e=>e.method===93||e.method===20);assert.ok(entry,'real upstream Zstandard member');
const corrupt=Uint8Array.from(bytes);corrupt[entry.start]=0;await assert.rejects(new GeodePackage(corrupt).read(entry.name),/Zstandard/);
assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926);
const browser=await chromium.launch({headless:true});let browserResult;
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:8765/integration-tests/');
 browserResult=await page.evaluate(async()=>{
  const {GeodePackage}=await import('/experiments/geode-binary/geode-package.mjs');
  const base='/integration-input/jukebox-oracle/',oracle=await (await fetch(base+'jukebox-package-preflight.json')).json(),bytes=new Uint8Array(await (await fetch(base+'integration-input/jukebox-official.geode')).arrayBuffer());
  const archive=new GeodePackage(bytes);let count=0;
  for(const [name,expected] of Object.entries(oracle.entryHashes)){const data=await archive.read(name),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(x=>x.toString(16).padStart(2,'0')).join('');if(hash!==expected)throw Error('Independent package SHA mismatch: '+name);count++;}
  return {entries:count,id:(await archive.manifest()).id,methods:[...new Set([...archive.entries.values()].map(e=>e.method))],nativeCodeExecuted:false};
 });assert.equal(browserResult.entries,verified);
}finally{await browser.close();}
await writeFile('jukebox-archive-result.json',JSON.stringify({status:'ORIGINAL_GEODE_ARCHIVE_PASS',verifiedEntries:verified,browser:browserResult,oracle:'Python zipfile/zstandard and SHA-256; all actual package members',modLoaded:false},null,2));
console.log('PASS: original Zstandard .geode members match independent Python output in Node and Chromium; bounds/corruption checks pass');
