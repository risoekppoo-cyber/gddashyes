// Empty-queue condition variables in the serialized guest. Sleeping/waiting
// requires a scheduler and is deliberately unsupported.
export class ConditionVariables {
 constructor(){this.wakes=0;}
 invoke(name,memory,cpu){
  const v=new DataView(memory.buffer),p=v.getBigUint64(cpu+8,true),sp=v.getBigUint64(cpu+32,true);
  if(!p||p>0xffffffffn||Number(p)+8>v.byteLength||!sp||sp>0xffffffffn||Number(sp)+8>v.byteLength)throw Error('Condition-variable pointer outside memory');
  const key=name.split('!').at(-1).toLowerCase(),at=Number(p),ret=v.getBigUint64(Number(sp),true);
  if(v.getBigUint64(at,true)!==0n)throw Error('Condition-variable waiters require a scheduler');
  if(key==='initializeconditionvariable')v.setBigUint64(at,0n,true);
  else if(key==='wakeconditionvariable'||key==='wakeallconditionvariable')this.wakes++;
  else throw Error('Condition-variable sleep requires a scheduler');
  v.setBigUint64(cpu+32,sp+8n,true);v.setBigUint64(cpu+192,ret,true);
 }
}
