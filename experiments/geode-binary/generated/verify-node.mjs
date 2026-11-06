import {readFile} from 'node:fs/promises';
import {verifyGeneratedCode} from './verify.mjs';
const root=process.argv[2]??new URL('.',import.meta.url);
const result=await verifyGeneratedCode(async(file,json)=>{const b=await readFile(typeof root==='string'?root+'/'+file:new URL(file,root));return json?JSON.parse(b):b;});
console.log(JSON.stringify(result,null,2));
