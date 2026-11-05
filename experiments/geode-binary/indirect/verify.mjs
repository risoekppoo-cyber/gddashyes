import {instantiateLift} from '../verify.mjs';
const check=(ok,text)=>{if(!ok)throw Error(text);};
const fromHex=s=>Uint8Array.from(s.match(/../g),x=>parseInt(x,16));
const hex=b=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
export async function verifyIndirect(fixtureBytes,geodeBytes,reference) {
 const memory=new WebAssembly.Memory({initial:512,maximum:65536}),cpu=4096,stop=0x1234fedcn;
 const fixture=await instantiateLift(fixtureBytes,memory),geode=await instantiateLift(geodeBytes,memory);
 const bases={fixture:BigInt(reference.fixtureBase),geode:BigInt(reference.geodeBase)};
 const modules={fixture,geode},targets=new Map();
 for(const name of ['fixture','geode'])for(const rva of reference.modules[name].rvas)targets.set((bases[name]+BigInt(rva)).toString(),name);
 new Uint8Array(memory.buffer,Number(bases.fixture),reference.fixtureImageHex.length/2).set(fromHex(reference.fixtureImageHex));
 function run(test,badTarget=false) {
  const view=new DataView(memory.buffer);
  new Uint8Array(memory.buffer,cpu,4096).fill(0);new Uint8Array(memory.buffer,0x5ff80,256).fill(0);
  for(let i=0;i<16;i++)view.setBigUint64(cpu+i*8,BigInt(test.initial[i]),true);
  if(badTarget)view.setBigUint64(cpu+16,0xdeadbeefn,true);
  view.setBigUint64(0x40000,0x40100n,true);view.setBigUint64(0x40120,BigInt(reference.callback),true);
  view.setBigUint64(0x40128,BigInt(test.value),true);view.setBigUint64(0x60008,stop,true);
  view.setBigUint64(cpu+192,BigInt(reference.entry),true);
  const route=[];let totalSteps=0;
  while(view.getBigUint64(cpu+192,true)!==stop) {
   const pc=view.getBigUint64(cpu+192,true),name=targets.get(pc.toString());
   if(!name)throw Error('Untranslated native address 0x'+pc.toString(16));
   if(route.length>=16)throw Error('Cross-module transfer budget exhausted');
   route.push(name);
   const status=modules[name].exports.lift_run(cpu,pc,bases[name],0,stop,128)>>>0;
   const steps=status&0x7fffffff;check(steps>0,'Dispatcher made no progress');totalSteps+=steps;
   check(totalSteps<=256,'Instruction budget exhausted');
   if(!(status&0x80000000))check(view.getBigUint64(cpu+192,true)===stop,'Module returned before the native call finished');
  }
  return {view,route,totalSteps};
 }
 for(const test of reference.cases) {
  const {view,route,totalSteps}=run(test);
  check(route.join(',')==='fixture,geode,fixture,geode,fixture','Unexpected native call route');
  check(totalSteps===21,'Unexpected instruction count');
  for(let i=0;i<16;i++)check(view.getBigUint64(cpu+i*8,true)===BigInt(test.expected[i]),'General register '+i+' disagrees with x64 execution');
  for(const [name,offset] of Object.entries(reference.flags))check(view.getUint8(cpu+offset)===test.flags[name],name+' flag disagrees with x64 execution');
  check(hex(new Uint8Array(memory.buffer,0x5ff80,256))===test.stackAfter,'Native return/shadow stack disagrees with x64 execution');
 }
 let rejected=false;try{run(reference.cases[0],true);}catch(e){rejected=String(e).includes('Untranslated native address 0xdeadbeef');}
 check(rejected,'Unknown indirect native target was accepted');
 return {status:'INDIRECT_BINARY_TRANSLATION_PASS',reference:reference.reference,cases:reference.cases.length,
  nativeWin64Fixture:true,compilerGeneratedCfgCalls:true,windowsCfgPolicyEnforced:false,officialGeodeGetAddress:true,officialGeodeGuardDispatchThunk:true,
  indirectCallInstructions:2,guardIndirectJumps:2,moduleTransfersPerCall:4,nativeInstructionsPerCase:21,
  callbackReturnedToNativeCaller:true,allGeneralRegistersMatch:true,arithmeticFlagsMatch:true,nativeStackMatches:true,
  unknownIndirectTargetRejected:true,sharedMemory:true,dllSha256:reference.dllSha256,
  fullGeodeLoader:false,dllInitializationTested:false,existingGeodePackagesSupported:false,fullGameBootTested:false};
}
