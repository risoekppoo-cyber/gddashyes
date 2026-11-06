#!/usr/bin/env python3
"""Bare DLL entrypoint probe. Stops at the first required Windows import.

Unicorn executes original relocated x64 bytes; the reached instructions are
then checked against the current binary translator. No API success is faked.
TLS callbacks and actual Windows loader initialization are not provided.
"""
import sys,json,hashlib,struct,time
from pathlib import Path
import pefile,pypcode,unicorn
from unicorn import x86_const as x
from lift import PIN,Lifter,LiftError

path=Path(sys.argv[1]);assert hashlib.sha256(path.read_bytes()).hexdigest()==PIN
pe=pefile.PE(str(path));base=0x2000000;preferred=pe.OPTIONAL_HEADER.ImageBase
image=bytearray(pe.get_memory_mapped_image());size=(pe.OPTIONAL_HEADER.SizeOfImage+4095)&~4095
for block in pe.DIRECTORY_ENTRY_BASERELOC:
 for reloc in block.entries:
  if reloc.type==0:continue
  assert reloc.type==10
  value=struct.unpack_from('<Q',image,reloc.rva)[0]
  struct.pack_into('<Q',image,reloc.rva,(value+base-preferred)&0xffffffffffffffff)
pe.OPTIONAL_HEADER.ImageBase=base
uc=unicorn.Uc(unicorn.UC_ARCH_X86,unicorn.UC_MODE_64)
uc.mem_map(base,size);uc.mem_write(base,bytes(image))
uc.mem_map(0x200000,0x100000);uc.mem_map(0x70000000,0x10000)
imports={};i=0
for desc in pe.DIRECTORY_ENTRY_IMPORT:
 for imp in desc.imports:
  target=0x70000000+i*16;i+=1
  imports[target]=desc.dll.decode()+'!'+(imp.name.decode() if imp.name else '#'+str(imp.ordinal))
  uc.mem_write(imp.address-preferred+base,target.to_bytes(8,'little'))
uc.reg_write(x.UC_X86_REG_RCX,base);uc.reg_write(x.UC_X86_REG_RDX,1)
uc.reg_write(x.UC_X86_REG_R8,0);uc.reg_write(x.UC_X86_REG_RSP,0x2fff08)
uc.mem_write(0x2fff08,(0x1234fedc).to_bytes(8,'little'))
initial_image=bytes(uc.mem_read(base,size))
trace=[];stop={};host_calls=[]
clock_ms=time.time_ns()//1_000_000
def code(uc,pc,length,_):
 if pc in imports and imports[pc].lower()=='kernel32.dll!getsystemtimeasfiletime':
  output=uc.reg_read(x.UC_X86_REG_RCX)
  timestamp=(clock_ms+11644473600000)*10000
  uc.mem_write(output,struct.pack('<Q',timestamp))
  sp=uc.reg_read(x.UC_X86_REG_RSP);ret=int.from_bytes(uc.mem_read(sp,8),'little')
  host_calls.append({'address':hex(pc),'name':imports[pc],'unixMilliseconds':clock_ms,'output':hex(output)})
  uc.reg_write(x.UC_X86_REG_RSP,sp+8);uc.reg_write(x.UC_X86_REG_RIP,ret)
  uc.emu_stop();return
 if pc in imports and imports[pc].lower()=='kernel32.dll!getcurrentthreadid':
  # The one registered guest execution context is main, with stable ID 1.
  thread_id=1
  sp=uc.reg_read(x.UC_X86_REG_RSP);ret=int.from_bytes(uc.mem_read(sp,8),'little')
  host_calls.append({'address':hex(pc),'name':imports[pc],'threadId':thread_id})
  uc.reg_write(x.UC_X86_REG_RAX,thread_id)
  uc.reg_write(x.UC_X86_REG_RSP,sp+8);uc.reg_write(x.UC_X86_REG_RIP,ret)
  uc.emu_stop();return
 if pc in imports:
  stop.update(reason='WINDOWS_IMPORT_REQUIRED',importName=imports[pc],address=hex(pc));uc.emu_stop();return
 trace.append(pc)
 if len(trace)>=10000:stop.update(reason='INSTRUCTION_LIMIT');uc.emu_stop()
def memory_error(uc,access,address,size,value,_):
 stop.update(reason='UNMAPPED_MEMORY',address=hex(address),access=access);return False
uc.hook_add(unicorn.UC_HOOK_CODE,code);uc.hook_add(unicorn.UC_HOOK_MEM_INVALID,memory_error)
entry=base+pe.OPTIONAL_HEADER.AddressOfEntryPoint
try:
 resume=entry
 for attempt in range(64):
  count_before=len(host_calls)
  uc.emu_start(resume,0x1234fedc,count=10001)
  if stop or len(host_calls)==count_before:break
  resume=uc.reg_read(x.UC_X86_REG_RIP)
 else:stop['reason']='HOST_CALL_LIMIT'
except unicorn.UcError as error:stop.setdefault('error',str(error))
if not stop:stop['reason']='ENTRYPOINT_RETURNED'
lifter=Lifter(pe,10000,allow_indirect=True,yield_unknown=True);blocked=None;translated=0
for pc in dict.fromkeys(trace):
 data=bytes(uc.mem_read(pc,32));ins=lifter.ctx.disassemble(data,base_address=pc,max_instructions=1).instructions[0]
 ops=lifter.ctx.translate(data[:ins.length],base_address=pc,max_instructions=1).ops
 try:
  emitted=[]
  for n,op in enumerate(ops):emitted.append(lifter.emit_op(op,n,len(ops)))
  lifter.blocks[pc]=(ins,ops,emitted)
  translated+=1
 except LiftError as error:
  blocked={'instruction':str(ins),'reason':str(error),'pcode':str(op)};break
report={'status':'DLL_STARTUP_BLOCKED','dllSha256':PIN,'entry':hex(entry),
 'originalX64InstructionsExecuted':len(trace),'uniqueInstructionsReached':len(set(trace)),
 'firstRuntimeDependency':stop,'reachedInstructionsSupportedBeforeBlock':translated,
 'firstTranslationBlocker':blocked,'wasmStartupExecuted':False,'windowsImportsExecuted':False,
 'guestThreadModel':'single registered main context','hostCalls':host_calls,'tlsCallbacksExecuted':False,'fullGeodeLoader':False,'existingGeodePackagesSupported':False}
if len(sys.argv)>2 and not blocked:
 out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
 (out/'startup.c').write_text(lifter.source());(out/'image.bin').write_bytes(initial_image)
 (out/'stack.bin').write_bytes(bytes(uc.mem_read(0x200000,0x100000)))
 names=['RAX','RCX','RDX','RBX','RSP','RBP','RSI','RDI','R8','R9','R10','R11','R12','R13','R14','R15']
 (out/'expected.json').write_text(json.dumps({'entry':entry,'base':base,'stop':uc.reg_read(x.UC_X86_REG_RIP),
  'instructions':len(trace),'hostCalls':host_calls,'registers':[hex(uc.reg_read(getattr(x,'UC_X86_REG_'+name))) for name in names]}))
print(json.dumps(report,indent=2))
