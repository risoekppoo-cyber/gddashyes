"""Extract the actual installed entry patch and original trampoline from a completed attach."""
import sys,json,struct,hashlib
from pathlib import Path
from types import SimpleNamespace
import unicorn
from unicorn import x86_const as x
from lift import Lifter,REGS,PIN
out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True);probe=Path(sys.argv[1])
r=json.loads((probe/'report.json').read_text());e=json.loads((probe/'expected.json').read_text())
assert r['dllSha256']==PIN and r['firstRuntimeDependency']['reason']=='ENTRYPOINT_RETURNED' and e['stop']==0x1234fedc and int(e['registers'][0],16)==1
assert len(r['generatedCode']['allocations'])==1
stub=r['generatedCode']['allocations'][0];entry=r['codeProtection']['calls'][0]['address'];image_base=0x8000000
original=(probe/f'module-{image_base:x}.bin').read_bytes()[entry-image_base:entry-image_base+15]
patched=(probe/f'module-{image_base:x}-after.bin').read_bytes()[entry-image_base:entry-image_base+15]
trampoline=bytes.fromhex(stub['bytesHex']);assert trampoline[:15]==original and patched[:6]==bytes.fromhex('ff2500000000')
target=struct.unpack_from('<Q',patched,6)[0];resume=struct.unpack_from('<Q',trampoline,21)[0];assert resume==entry+15
programs=[('original',entry,original,resume),('patched',entry,patched,target),('trampoline',stub['base'],trampoline,resume)]
cases=[];variants=[]
for name,pc,code,end in programs:
 image=SimpleNamespace(OPTIONAL_HEADER=SimpleNamespace(ImageBase=0x2000000,SizeOfImage=0x1100000))
 lifter=Lifter(image,16,allow_indirect=True,yield_unknown=True,wide_mode=True,yield_on_budget=True);lifter.allowed_images.append((pc,pc+len(code)))
 position=0;count=1 if name=='patched' else 3 if name=='original' else 4
 for i in range(count):
  ins=lifter.ctx.disassemble(code[position:],base_address=pc+position,max_instructions=1).instructions[0]
  ops=lifter.ctx.translate(code[position:position+ins.length],base_address=pc+position,max_instructions=1).ops;lifter.current_instruction=ins;lifter.prepare_uniques(ops)
  lifter.blocks[pc+position]=(ins,ops,[lifter.emit_op(op,n,len(ops)) for n,op in enumerate(ops)]);lifter.code_guards[pc+position]=code[position:position+ins.length];position+=ins.length
 (out/f'{name}.c').write_text(lifter.source(partition_size=1));variants.append({'name':name,'entry':pc,'codeHex':code.hex(),'target':end,'steps':count,'imageBase':0x2000000})
 for index in range(8):
  uc=unicorn.Uc(unicorn.UC_ARCH_X86,unicorn.UC_MODE_64);uc.mem_map(pc&~4095,4096);uc.mem_write(pc,code);uc.mem_map(0x10000,0x10000)
  initial=[((i+1)*0x1111111111111111+index*0x10101010101)&0xffffffffffffffff for i in range(16)];initial[4]=0x1f008
  for reg,value in zip(REGS,initial):uc.reg_write(getattr(x,'UC_X86_REG_'+reg),value)
  xmm=[((i+1)*0x112233445566778899aabbccddee+index)&((1<<128)-1) for i in range(16)]
  for i,value in enumerate(xmm):uc.reg_write(getattr(x,f'UC_X86_REG_XMM{i}'),value)
  flags=0x202|(0x8d5 if index&1 else 0);uc.reg_write(x.UC_X86_REG_EFLAGS,flags);uc.mem_write(0x1f000,bytes([0xa5])*64)
  uc.emu_start(pc,end,count=16)
  cases.append({'variant':name,'initial':[hex(v) for v in initial],'xmm':[hex(v) for v in xmm],'flags':flags,'expected':[hex(uc.reg_read(getattr(x,'UC_X86_REG_'+reg))) for reg in REGS],'expectedFlags':uc.reg_read(x.UC_X86_REG_EFLAGS),'pc':uc.reg_read(x.UC_X86_REG_RIP),'stackHex':bytes(uc.mem_read(0x1f000,64)).hex()})
manifest={'dllSha256':PIN,'startupGenerationId':r['generationId'],'startupInstructions':r['originalX64InstructionsExecuted'],'nativeReference':'Unicorn 2.1.4','variants':variants,'cases':cases,'fullGeodeLoader':False,'existingGeodePackagesSupported':False}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'variants':len(variants),'nativeCases':len(cases),'actualInstalledPatch':patched.hex(),'actualGeneratedTrampoline':trampoline.hex()}))
