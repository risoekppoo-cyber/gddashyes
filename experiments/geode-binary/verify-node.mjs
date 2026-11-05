import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {instantiateLift,verifyVectors,verifyGameMemory} from './verify.mjs';
import {GuestApi} from '../geode-sdk/guest-api.mjs';
const read=p=>readFile(new URL(p,import.meta.url));
const [bytes,manifest,reference]=await Promise.all([read('./dist/lifted.wasm'),read('./dist/manifest.json').then(JSON.parse),read('./dist/reference.json').then(JSON.parse)]);
const report=await verifyVectors(bytes,manifest,reference);
report.wasmSha256=createHash('sha256').update(bytes).digest('hex');
if(process.argv[2]) {
  const require=createRequire(import.meta.url),prototype=require('../hook-prototype.js');
  const prepared=await prototype.patch(await readFile(process.argv[2]));
  const module=await WebAssembly.compile(prepared.bytes),imports={};let e;const output=[];
  for(const i of WebAssembly.Module.imports(module))(imports[i.module]||={})[i.name]=
    i.name==='emscripten_asm_const_int'?code=>{if(code===346202866)return 0;throw Error('Unexpected host code '+code);}:i.name==='fd_write'?(fd,iovs,count,written)=>{
      if(fd!==1&&fd!==2)throw Error('Unexpected write FD '+fd);
      const view=new DataView(e.memory.buffer);let total=0;
      for(let j=0;j<count;j++){const at=view.getUint32(iovs+j*8,true),size=view.getUint32(iovs+j*8+4,true);
        output.push(new TextDecoder().decode(new Uint8Array(e.memory.buffer,at,size)));total+=size;}
      view.setUint32(written,total,true);return 0;
    }:()=>{throw Error('Unexpected host import '+i.name);};
  const game=await WebAssembly.instantiate(module,imports);e=game.exports;
  await prototype.install(game,prepared.targets);
  const api=new GuestApi(e,{cpu:16384,stack:65536,scratch:32768});
  report.gameMemory=await verifyGameMemory(bytes,manifest,e,api);
  report.capturedGameLog=output.join('');
}
console.log(JSON.stringify(report,null,2));
