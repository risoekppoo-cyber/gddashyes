export class CodeProtection {
 constructor(regions){this.regions=regions.filter(r=>r.module!=='executed generated code');this.pages=new Map();this.calls=[];}
 owner(p,n){return this.regions.find(r=>r.start<=p&&p+n<=r.end);}
 checkWrite(address,size){const p=Number(address),n=Number(size);if(!Number.isSafeInteger(p)||n<1)throw Error('Code write bounds');
  if(this.regions.some(r=>p<r.end&&p+n>r.start)){
   if(this.regions.some(r=>r.module==='unresolved import gateways'&&p<r.end&&p+n>r.start))throw Error('Unresolved import code write');
   if(!this.owner(p,n))throw Error('Code write crosses ownership');
   for(let page=Math.floor(p/4096)*4096;page<p+n;page+=4096)if((this.pages.get(page)??0x20)!==0x40)throw Error('Executable write without VirtualProtectEx');
  }
 }
 invoke(memory,cpu,setError){const v=new DataView(memory.buffer),args=[8,16,64,72].map(o=>v.getBigUint64(cpu+o,true)),sp=v.getBigUint64(cpu+32,true),output=Number(v.getBigUint64(Number(sp)+40,true));
  const [process,ptr,size,protect]=args,p=Number(ptr),n=Number(size),protection=Number(protect&0xffffffffn);let result=1n;
  if(process!==0xffffffffffffffffn||![0x20,0x40].includes(protection))throw Error('UNMODELED_CODE_PROTECTION');
  if(!n||!output){setError(87);result=0n;}
  else{const first=Math.floor(p/4096)*4096,end=Math.ceil((p+n)/4096)*4096;if(!this.owner(first,end-first)||this.owner(first,end-first).module==='unresolved import gateways')throw Error('UNOWNED_CODE_PROTECTION');
   const old=this.pages.get(first)??0x20;this.checkWrite(output,4);v.setUint32(output,old,true);
   for(let page=first;page<end;page+=4096)this.pages.set(page,protection);this.calls.push({address:p,size:n,protection,old});}
  v.setBigUint64(cpu,result,true);v.setBigUint64(cpu+192,v.getBigUint64(Number(sp),true),true);v.setBigUint64(cpu+32,sp+8n,true);return result;
 }
 snapshot(){return {pages:Object.fromEntries(this.pages),calls:this.calls};}
}
