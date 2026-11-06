import {instantiateStartupLift} from './startup-module.mjs';
export class VersionedCodeRouter {
 constructor(memory){this.memory=memory;this.versions=[];}
 async register(variant,wasm){const instance=await instantiateStartupLift(wasm,this.memory,{stackTop:0x900000});this.versions.push({...variant,instance,bytes:Uint8Array.from(variant.codeHex.match(/../g),b=>parseInt(b,16))});}
 select(entry){const matches=this.versions.filter(v=>v.entry===entry&&v.bytes.every((b,i)=>new Uint8Array(this.memory.buffer)[entry+i]===b));if(matches.length!==1)throw Error('Unknown or ambiguous native code version');return matches[0];}
 run(entry,cpu=4096){const v=this.select(entry);return {variant:v.name,result:v.instance.exports.lift_run(cpu,BigInt(entry),BigInt(v.imageBase),0,BigInt(v.target),v.steps+1)>>>0};}
}
