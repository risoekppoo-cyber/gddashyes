#!/usr/bin/env python3
"""Independent division-fault and SSE/overlapping-temporary regression cases."""
import json,sys,subprocess,platform,struct,mmap,ctypes
from pathlib import Path
from types import SimpleNamespace
import unicorn
from unicorn import x86_const as x
from lift import Lifter,REGS
out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True);base=0x1000000
programs={0:bytes.fromhex('48f7f7c3'),32:bytes.fromhex('48f7ffc3'),64:bytes.fromhex('f30f6f01f30f6f0a660f62c1660f73d804f3410f7f00c3')}
programs[96]=bytes.fromhex('f30f5fd9c3')
programs[112]=bytes.fromhex('f3480f2ac0c3');programs[120]=bytes.fromhex('f2480f2ac0c3')
programs[144]=bytes.fromhex('f30f5ed9c3')
code=bytearray(192)
for rva,data in programs.items():code[rva:rva+len(data)]=data
class Image:
 OPTIONAL_HEADER=SimpleNamespace(ImageBase=base,SizeOfImage=4096)
 def get_section_by_rva(self,rva):return SimpleNamespace(Characteristics=0x20000000) if 0<=rva<len(code) else None
 def get_data(self,rva,n):return bytes(code[rva:rva+n])
lifter=Lifter(Image(),128,allow_indirect=True,yield_unknown=True,wide_mode=True)
lifter.discover(base+rva for rva in programs)
(out/'alu.c').write_text(lifter.source())
uc=unicorn.Uc(unicorn.UC_ARCH_X86,unicorn.UC_MODE_64);uc.mem_map(base,4096);uc.mem_write(base,bytes(code));uc.mem_map(0x10000,0x10000)
cases=[]
hardware_overflow=None
if platform.machine().lower() in ['x86_64','amd64']:
 probe="""import mmap,ctypes,resource
resource.setrlimit(resource.RLIMIT_CORE,(0,0))
b=bytes.fromhex('48b8000000000000008048baffffffffffffffff48bfffffffffffffffff48f7ffc3')
m=mmap.mmap(-1,4096,prot=mmap.PROT_READ|mmap.PROT_WRITE|mmap.PROT_EXEC);m.write(b)
ctypes.CFUNCTYPE(ctypes.c_uint64)(ctypes.addressof(ctypes.c_char.from_buffer(m)))()
"""
 hardware_overflow=subprocess.run([sys.executable,'-c',probe],stdout=subprocess.PIPE,stderr=subprocess.PIPE).returncode
 assert hardware_overflow==-8,'Real x64 signed overflow did not raise SIGFPE'
inputs=[(0,100,0,7),(0,0xffffffffffffffff,0,1),(0,0xffffffffffffffff,1,3),(0,10,0,0),(0,1,3,3),
 (32,(-100)&0xffffffffffffffff,0xffffffffffffffff,7),(32,100,0,(-7)&0xffffffffffffffff),(32,0x8000000000000000,0xffffffffffffffff,0xffffffffffffffff)]
inputs += [(64,0,0,1)]*3
float_pairs=[(1.,2.),(2.,1.),(-3.,-1.),(0.,-0.),(-0.,0.),(1e-30,1e30)]
inputs += [(96,0,0,0)]*len(float_pairs)
float_case_map={11+i:pair for i,pair in enumerate(float_pairs)}
rounding_modes=[0]*len(inputs)
for rva in [112,120]:
 for mode in range(4):
  for value in [0,1,-1,16777217,16777219,0x7fffffffffffffff,-0x8000000000000000]:
   inputs.append((rva,value&0xffffffffffffffff,0,0));rounding_modes.append(mode)
for pair in [(1.,3.),(10.,2.),(-5.,3.),(0.,-3.),(-0.,3.),(1e10,7.),(-1e10,-7.)]:
 float_case_map[len(inputs)]=pair;inputs.append((144,0,0,0));rounding_modes.append(0)
def hardware_float(program,rax,mxcsr,xmm):
 if platform.machine().lower() not in ['x86_64','amd64']:return None
 # SysV wrapper: save host MXCSR, load declared guest inputs, execute one SSE
 # instruction, store outputs/status, restore host MXCSR before returning.
 wrapper=bytes.fromhex('0fae5f640fae5708488b07660fefc0f30f6f4f10f30f6f5f20')+program[:-1]+bytes.fromhex('f30f7f4730f30f7f4f40f30f7f5f500fae5f600fae5764c3')
 executable=mmap.mmap(-1,4096,prot=mmap.PROT_READ|mmap.PROT_WRITE|mmap.PROT_EXEC);executable.write(wrapper)
 buf=ctypes.create_string_buffer(112);address=ctypes.addressof(buf)
 ctypes.memmove(address,struct.pack('<QI',rax,mxcsr),12)
 ctypes.memmove(address+16,xmm[1].to_bytes(16,'little'),16);ctypes.memmove(address+32,xmm[3].to_bytes(16,'little'),16)
 ctypes.CFUNCTYPE(None,ctypes.c_void_p)(ctypes.addressof(ctypes.c_char.from_buffer(executable)))(address)
 raw=buf.raw;result={'xmm':{i:int.from_bytes(raw[offset:offset+16],'little') for i,offset in [(0,48),(1,64),(3,80)]},'mxcsr':struct.unpack_from('<I',raw,96)[0]};executable.close();return result
for index,(rva,rax,rdx,rdi) in enumerate(inputs):
 initial=[0]*16;initial[0]=rax;initial[2]=rdx;initial[7]=rdi;initial[4]=0x1f008
 if rva==64:initial[1]=0x12000;initial[2]=0x12020;initial[8]=0x12040
 for name,value in zip(REGS,initial):uc.reg_write(getattr(x,'UC_X86_REG_'+name),value)
 for i in range(16):uc.reg_write(getattr(x,f'UC_X86_REG_XMM{i}'),0)
 initial_xmm=[0]*16
 if index in float_case_map:
  first,second=float_case_map[index]
  for reg,value in [(3,first),(1,second)]:initial_xmm[reg]=(0x112233445566778899aabbcc<<32)|struct.unpack('<I',struct.pack('<f',value))[0]
 for i,value in enumerate(initial_xmm):uc.reg_write(getattr(x,f'UC_X86_REG_XMM{i}'),value)
 uc.reg_write(x.UC_X86_REG_MXCSR,0x1f80|(rounding_modes[index]<<13))
 uc.mem_write(0x1f008,(0x1234fedc).to_bytes(8,'little'))
 data=bytes((n*17+index)&255 for n in range(64))+bytes(16);uc.mem_write(0x12000,data)
 fault=False
 try:uc.emu_start(base+rva,0x1234fedc,count=64)
 except unicorn.UcError as error:
  if error.errno!=unicorn.UC_ERR_EXCEPTION:raise
  fault=True
 # Unicorn 2.1.4 incorrectly wraps signed MIN64/-1. Keep architectural #DE
 # behavior; validate it on real x64 above instead of copying the emulator bug.
 discrepancy=index==7 and not fault
 if index==7:
  fault=True
  for name,value in zip(REGS,initial):uc.reg_write(getattr(x,'UC_X86_REG_'+name),value)
  uc.reg_write(x.UC_X86_REG_RIP,base+rva)
 native_float=hardware_float(programs[rva],rax,0x1f80|(rounding_modes[index]<<13),initial_xmm) if rva in [96,112,120,144] else None
 if native_float:
  for reg,value in native_float['xmm'].items():assert value==uc.reg_read(getattr(x,f'UC_X86_REG_XMM{reg}')),'Hardware/emulator float value mismatch'
 cases.append({'hardwareFloatingVerified':native_float is not None,'emulatorMxcsrDiscrepancy':native_float is not None and native_float['mxcsr']!=uc.reg_read(x.UC_X86_REG_MXCSR),'entry':base+rva,'initial':[hex(v) for v in initial],'initialXmm':[hex(v) for v in initial_xmm],'initialMxcsr':0x1f80|(rounding_modes[index]<<13),'mxcsr':native_float['mxcsr'] if native_float else uc.reg_read(x.UC_X86_REG_MXCSR),'data':data.hex(),'fault':fault,'emulatorSignedOverflowDiscrepancy':discrepancy,
  'expected':[hex(uc.reg_read(getattr(x,'UC_X86_REG_'+n))) for n in REGS],
  'pc':hex(uc.reg_read(x.UC_X86_REG_RIP)),'output':bytes(uc.mem_read(0x12040,16)).hex(),
  'xmm':[hex(uc.reg_read(getattr(x,f'UC_X86_REG_XMM{i}'))) for i in range(16)]})
(out/'alu.json').write_text(json.dumps({'base':base,'hardwareSignedOverflowExit':hardware_overflow,'cases':cases}))
print('Generated',len(cases),'independent x64 division/SSE cases')
