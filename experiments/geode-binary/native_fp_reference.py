"""Host-x64 SSE reference for register-only scalar FP operations.

Unicorn 2.1.4 omits some MXCSR precision flags. Execute the same operation in
normalized registers, preserve host MXCSR, and use the real hardware result.
This does not execute arbitrary guest byte strings on the host.
"""
import ctypes,mmap,platform,struct,re
CODES={
 'CVTSI2SS64':'f3480f2ac0','CVTSI2SS32':'f30f2ac0','CVTSI2SD64':'f2480f2ac0','CVTSI2SD32':'f20f2ac0',
 'CVTTSS2SI64':'f3480f2cc0','CVTTSS2SI32':'f30f2cc0','CVTTSD2SI64':'f2480f2cc0','CVTTSD2SI32':'f20f2cc0',
 'ADDSS':'f30f58c1','SUBSS':'f30f5cc1','MULSS':'f30f59c1','DIVSS':'f30f5ec1'}
GPR={'EAX':'RAX','EBX':'RBX','ECX':'RCX','EDX':'RDX','ESI':'RSI','EDI':'RDI','EBP':'RBP','ESP':'RSP',**{f'R{i}D':f'R{i}' for i in range(8,16)}}
class NativeFpReference:
 def __init__(self):self.stubs={};self.count=0;self.by_pc={};self.last_memory=None
 def operands(self,instruction):
  name=instruction.mnem
  if name not in ['CVTSI2SS','CVTSI2SD','CVTTSS2SI','CVTTSD2SI','ADDSS','SUBSS','MULSS','DIVSS']:return None
  operands=[part.strip() for part in instruction.body.split(',')]
  register=r'XMM(?:[0-9]|1[0-5])|R(?:AX|BX|CX|DX|SI|DI|BP|SP|[89]|1[0-5])|E(?:AX|BX|CX|DX|SI|DI|BP|SP)|R(?:[89]|1[0-5])D'
  if len(operands)!=2 or not re.fullmatch(register,operands[0]):raise RuntimeError('NATIVE_FLOAT_OPERAND_REFERENCE_REQUIRED')
  destination,source=operands;memory=None
  if not re.fullmatch(register,source):
   match=re.fullmatch(r'(dword|qword) ptr \[([^\]]+)\]',source)
   if not match:raise RuntimeError('NATIVE_FLOAT_MEMORY_REFERENCE_REQUIRED')
   width=4 if match[1]=='dword' else 8;expression=match[2].replace(' ','')
   literal=re.fullmatch(r'0x[0-9a-fA-F]+|[0-9]+',expression)
   address=re.fullmatch(r'(R(?:AX|BX|CX|DX|SI|DI|BP|SP|IP|[89]|1[0-5]))(?:([+-])(0x[0-9a-fA-F]+|[0-9]+))?',expression)
   if not literal and not address:raise RuntimeError('NATIVE_FLOAT_ADDRESSING_REFERENCE_REQUIRED')
   if not name.startswith('CVTSI') and width!=(8 if name.startswith('CVTTSD') else 4):raise RuntimeError('NATIVE_FLOAT_MEMORY_WIDTH_REQUIRED')
   memory={'width':width,'literal':int(expression,0) if literal else None,'base':address[1] if address else None,'displacement':(int(address[3],0)*(-1 if address[2]=='-' else 1)) if address and address[3] else 0}
  key=name+(('32' if (memory and memory['width']==4) or source in GPR else '64') if name.startswith('CVTSI') else ('32' if destination in GPR else '64') if name.startswith('CVTT') else '')
  return key,destination,source,memory
 def execute(self,key,integer,left,right,mxcsr):
  if platform.machine().lower() not in ['x86_64','amd64']:raise RuntimeError('HOST_X64_FLOAT_REFERENCE_REQUIRED')
  if mxcsr&0x1f80!=0x1f80:raise RuntimeError('UNMODELED_NATIVE_FP_EXCEPTIONS')
  if key not in self.stubs:
   # Input: RDI -> u64 integer, u32 MXCSR, XMM0 at 16, XMM1 at 32.
   # Output: XMM0 at 48, RAX at 64, MXCSR at 72; saved host MXCSR at 76.
   code=bytes.fromhex('0fae5f4c0fae5708488b07f30f6f4710f30f6f4f20')+bytes.fromhex(CODES[key])+bytes.fromhex('f30f7f4730488947400fae5f480fae574cc3')
   page=mmap.mmap(-1,4096,prot=mmap.PROT_READ|mmap.PROT_WRITE|mmap.PROT_EXEC);page.write(code)
   fn=ctypes.CFUNCTYPE(None,ctypes.c_void_p)(ctypes.addressof(ctypes.c_char.from_buffer(page)));self.stubs[key]=(page,fn)
  data=ctypes.create_string_buffer(80);p=ctypes.addressof(data)
  ctypes.memmove(p,struct.pack('<QI',integer,mxcsr),12)
  ctypes.memmove(p+16,left.to_bytes(16,'little'),16);ctypes.memmove(p+32,right.to_bytes(16,'little'),16)
  self.stubs[key][1](p);raw=data.raw
  return int.from_bytes(raw[48:64],'little'),struct.unpack_from('<Q',raw,64)[0],struct.unpack_from('<I',raw,72)[0]
 def apply(self,uc,x,instruction,code):
  operands=self.operands(instruction)
  if operands is None:return False
  key,destination,source,memory=operands;self.last_memory=None
  read=lambda name:uc.reg_read(getattr(x,'UC_X86_REG_'+name))
  if memory:
   address=memory['literal'] if memory['literal'] is not None else ((instruction.addr.offset+instruction.length if memory['base']=='RIP' else read(memory['base']))+memory['displacement'])&0xffffffffffffffff
   try:source_value=int.from_bytes(uc.mem_read(address,memory['width']),'little')
   except Exception as error:raise RuntimeError('UNMAPPED_NATIVE_FP_MEMORY') from error
   self.last_memory=(address,memory['width'])
  else:source_value=read(source)
  integer=source_value if key.startswith('CVTSI') else 0
  left=source_value if key.startswith('CVTT') else read(destination)
  right=source_value if key in ['ADDSS','SUBSS','MULSS','DIVSS'] else 0
  result,rax,csr=self.execute(key,integer,left,right,read('MXCSR'))
  if key.startswith('CVTT'):uc.reg_write(getattr(x,'UC_X86_REG_'+GPR.get(destination,destination)),rax)
  else:uc.reg_write(getattr(x,'UC_X86_REG_'+destination),result)
  uc.reg_write(x.UC_X86_REG_MXCSR,csr);uc.reg_write(x.UC_X86_REG_RIP,instruction.addr.offset+instruction.length)
  self.count+=1;pc=hex(instruction.addr.offset);record=self.by_pc.setdefault(pc,{'instruction':str(instruction),'bytes':code.hex(),'count':0})
  if self.last_memory:record['lastMemoryAddress']=hex(self.last_memory[0]);record['memoryWidth']=self.last_memory[1]
  record.update(count=record['count']+1,lastInputInteger=hex(integer),lastInputLeft=hex(left),lastInputRight=hex(right),lastOutput=hex(rax if key.startswith('CVTT') else result),lastMxcsr=hex(csr))
  return True
