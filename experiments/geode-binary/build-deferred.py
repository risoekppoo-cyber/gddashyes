#!/usr/bin/env python3
"""Lift only a native-observed callback path, stopping before an unresolved service.

Unknown instructions/services remain fatal. No Windows API success stubs.
"""
import hashlib,json,re,sys
from pathlib import Path
import pefile,pypcode,unicorn
from unicorn import x86_const as x
from lift import Lifter,LiftError,PIN,REGS

class WideLifter(Lifter):
 def __init__(self,pe):
  super().__init__(pe,4096,allow_indirect=True)
  self.reg_roots.extend((self.ctx.registers['XMM'+str(i)].offset,512+i*16,16) for i in range(16))
 def expr(self,v):
  if v.space.name=='const' and self.base<=v.offset<self.base+self.pe.OPTIONAL_HEADER.SizeOfImage:
   return f'(image_base+UINT64_C({v.offset-self.base}))'
  if v.size<=8:return super().expr(v)
  if v.size!=16:raise LiftError(f'Unsupported wide input {v}')
  if v.space.name=='unique':return f'u_{v.offset:x}'
  if v.space.name=='register':return f'raw_read128(cpu+{self.reg_offset(v)}u)'
  if v.space.name=='ram':return f'guest_read128(image_base+UINT64_C({v.offset-self.base}),guest_base)'
  raise LiftError(f'Unsupported wide input {v}')
 def assign(self,v,expr):
  if v.size<=8:return super().assign(v,expr)
  if v.size!=16:raise LiftError(f'Unsupported wide output {v}')
  if v.space.name=='unique':return f'u_{v.offset:x}=({expr});'
  if v.space.name=='register':return f'raw_write128(cpu+{self.reg_offset(v)}u,({expr}));'
  if v.space.name=='ram':return f'guest_write128(image_base+UINT64_C({v.offset-self.base}),({expr}),guest_base);'
  raise LiftError(f'Unsupported wide output {v}')
 def emit_op(self,op,index,count):
  a=op.inputs;code=op.opcode.name
  if code=='IMARK':return ''
  if max([v.size for v in a]+([op.output.size] if op.output else [])+[0])<=8:
   return super().emit_op(op,index,count)
  if code=='COPY':return self.assign(op.output,self.expr(a[0]))
  if code=='LOAD' and op.output.size==16:return self.assign(op.output,f'guest_read128({self.expr(a[1])},guest_base)')
  if code=='STORE' and a[2].size==16:return f'guest_write128({self.expr(a[1])},{self.expr(a[2])},guest_base);'
  if code in ['INT_XOR','INT_AND','INT_OR']:
   operator={'INT_XOR':'^','INT_AND':'&','INT_OR':'|'}[code]
   return self.assign(op.output,f'({self.expr(a[0])}{operator}{self.expr(a[1])})')
  if code=='PIECE':return self.assign(op.output,f'((wide_t){self.expr(a[0])}<<{a[1].size*8})|{self.expr(a[1])}')
  if code=='SUBPIECE':return self.assign(op.output,f'({self.expr(a[0])}>>({self.expr(a[1])}*8))')
  raise LiftError(f'Unsupported wide p-code {op}')
 def add(self,va):
  data=self.pe.get_data(va-self.base,32)
  ins=self.ctx.disassemble(data,base_address=va,max_instructions=1).instructions[0]
  ops=self.ctx.translate(data[:ins.length],base_address=va,max_instructions=1).ops
  emitted=[self.emit_op(op,i,len(ops)) for i,op in enumerate(ops)]
  # SLEIGH omits architectural AF for these stack ADD/SUB forms.
  match=re.search(r'\b(SUB|ADD) RSP,0x([0-9a-f]+)',str(ins))
  if match:
   emitted[0]='uint64_t old_stack=raw_read(cpu+32u,8u);'+emitted[0]
   emitted[-1]+=f'raw_write(cpu+2564u,((old_stack^UINT64_C({int(match[2],16)})^raw_read(cpu+32u,8u))>>4)&1u,1u);'
  self.blocks[va]=(ins,ops,emitted)
 def source(self):
  s=super().source().replace('uint64_t u_','wide_t u_')
  return s.replace('__attribute__((visibility("default")))',WIDE+'\n__attribute__((visibility("default")))')

WIDE='''typedef unsigned __int128 wide_t;
static inline wide_t raw_read128(uint64_t p){return (wide_t)raw_read(p,8u)|((wide_t)raw_read(p+8u,8u)<<64);}
static inline void raw_write128(uint64_t p,wide_t v){raw_write(p,(uint64_t)v,8u);raw_write(p+8u,(uint64_t)(v>>64),8u);}
static inline wide_t guest_read128(uint64_t p,uint32_t b){if(p>UINT32_MAX-15u){lift_fault(3u,p,0);__builtin_trap();}return raw_read128(p+b);}
static inline void guest_write128(uint64_t p,wide_t v,uint32_t b){if(p>UINT32_MAX-15u){lift_fault(3u,p,0);__builtin_trap();}raw_write128(p+b,v);}
'''

def main():
 data=Path(sys.argv[1]).read_bytes();assert hashlib.sha256(data).hexdigest()==PIN
 out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
 pe=pefile.PE(data=data);preferred=pe.OPTIONAL_HEADER.ImageBase;size=pe.OPTIONAL_HEADER.SizeOfImage
 original=pe.get_memory_mapped_image().ljust(size,b'\0');ctx=pypcode.Context('x86:LE:64:default')
 imports={}
 for group in [getattr(pe,'DIRECTORY_ENTRY_IMPORT',[]),getattr(pe,'DIRECTORY_ENTRY_DELAY_IMPORT',[])]:
  for desc in group:
   for imp in desc.imports:imports[imp.address-preferred]=desc.dll.decode()+'!'+(imp.name.decode() if imp.name else '#'+str(imp.ordinal))
 cases=[];observed=set();boundaries=[]
 for image_base in [0x2000000,0x16000000]:
  for variant in range(3):
   image=bytearray(original)
   for block in pe.DIRECTORY_ENTRY_BASERELOC:
    for rel in block.entries:
     if rel.type==10:
      image[rel.rva:rel.rva+8]=((int.from_bytes(image[rel.rva:rel.rva+8],'little')+image_base-preferred)&((1<<64)-1)).to_bytes(8,'little')
   for rva in imports:image[rva:rva+8]=b'\0'*8
   uc=unicorn.Uc(unicorn.UC_ARCH_X86,unicorn.UC_MODE_64)
   uc.mem_map(image_base,(size+4095)&~4095);uc.mem_write(image_base,bytes(image))
   # One explicit static-TLS fixture. This models template/zero-fill storage,
   # not TLS callback execution, Windows threading, or completed CRT startup.
   tls=pe.DIRECTORY_ENTRY_TLS.struct
   tls_rva=tls.StartAddressOfRawData-preferred;tls_size=tls.EndAddressOfRawData-tls.StartAddressOfRawData
   if tls_size+tls.SizeOfZeroFill>4096:raise RuntimeError('TLS fixture exceeds bounded reservation')
   tib=0x120000;tls_array=tib+0x1000;tls_data=tib+0x2000
   uc.mem_map(tib,0x10000)
   uc.mem_write(tib+0x58,tls_array.to_bytes(8,'little'));uc.mem_write(tls_array,tls_data.to_bytes(8,'little'))
   uc.mem_write(tls_data,bytes(image[tls_rva:tls_rva+tls_size]))
   uc.mem_write(image_base+tls.AddressOfIndex-preferred,b'\0'*4)
   uc.reg_write(x.UC_X86_REG_GS_BASE,tib)
   stack_base=0x100000;stack_size=0x10000;sp=0x10f008
   uc.mem_map(stack_base,stack_size);uc.mem_write(stack_base,b'\xa5'*stack_size)
   values=[((i+1)*0x1111111111111111+variant)&((1<<64)-1) for i in range(16)]
   for i,value in {1:0x400000,2:0,4:sp,8:0,9:10}.items():values[i]=value
   entry_rva=0x12df16 if variant==2 else 0x12f200
   if variant==2:values[5]=0x10e000
   for reg,value in zip(REGS,values):uc.reg_write(getattr(x,'UC_X86_REG_'+reg),value)
   xmm=[((i+1)*0x01010101010101010101010101010101)&((1<<128)-1) for i in range(16)]
   for i,value in enumerate(xmm):uc.reg_write(getattr(x,'UC_X86_REG_XMM'+str(i)),value)
   flags=0x202 if not variant else 0xad7;uc.reg_write(x.UC_X86_REG_EFLAGS,flags)
   trace=[];boundary={}
   def hook(emu,address,n,_):
    rva=address-image_base
    if not 0<=rva<size:raise RuntimeError(f'Unexpected target {address:#x}')
    if variant==2 and rva==0x12df21:
     boundary.update(rva=rva,service='SIMD fixture stop');emu.emu_stop();return
    b=bytes(emu.mem_read(address,min(16,size-rva)))
    if b[:2] in [b'\xff\x15',b'\xff\x25']:
     slot=rva+6+int.from_bytes(b[2:6],'little',signed=True)
     if slot in imports:
      boundary.update(rva=rva,service=imports[slot],iatRva=slot);emu.emu_stop();return
    trace.append(rva);observed.add(rva)
    if len(trace)>10000:raise RuntimeError('Native path step limit')
   uc.hook_add(unicorn.UC_HOOK_CODE,hook)
   try:uc.emu_start(image_base+entry_rva,0,count=10001)
   except unicorn.UcError as error:
    fault=uc.reg_read(x.UC_X86_REG_RIP)
    recent=[str(ctx.disassemble(bytes(uc.mem_read(image_base+i,16)),base_address=preferred+i,max_instructions=1).instructions[0]) for i in trace[-6:]]
    raise RuntimeError(f'Native path fault at {fault:#x}; recent {recent}: {error}') from error
   if not boundary:raise RuntimeError('No explicit service boundary found')
   print(json.dumps({'nativeBoundary':boundary,'steps':len(trace),'imageBase':hex(image_base)}),flush=True)
   # Store only changed DLL bytes; pointers in the reference are base-specific.
   final=bytes(uc.mem_read(image_base,size));changes=[];at=0
   while at<size:
    if final[at]==image[at]:at+=1;continue
    start=at
    while at<size and final[at]!=image[at]:at+=1
    changes.append({'rva':start,'hex':final[start:at].hex()})
   cases.append({'imageBase':image_base,'entryRva':entry_rva,'initial':[hex(v) for v in values],'initialXmm':[hex(v) for v in xmm],'flags':flags,
     'expected':[hex(uc.reg_read(getattr(x,'UC_X86_REG_'+r))) for r in REGS],
     'expectedXmm':[hex(uc.reg_read(getattr(x,'UC_X86_REG_XMM'+str(i)))) for i in range(16)],
     'expectedFlags':uc.reg_read(x.UC_X86_REG_EFLAGS),'stopRva':boundary['rva'],'steps':len(trace),
     'stackBase':stack_base,'stackHex':bytes(uc.mem_read(stack_base,stack_size)).hex(),'dllChanges':changes,
     'tib':tib,'tlsArray':tls_array,'tlsData':tls_data,'tlsHex':bytes(uc.mem_read(tls_data,tls_size+tls.SizeOfZeroFill)).hex()})
   boundaries.append(boundary)
 lifter=WideLifter(pe)
 for rva in sorted(observed):lifter.add(preferred+rva)
 source=lifter.source();(out/'deferred.c').write_text(source)
 manifest={'dllSha256':PIN,'entryRva':0x12f200,'boundaries':boundaries,'uniqueInstructions':len(observed),
  'instructions':[{'rva':va-preferred,'length':ins.length,'assembly':str(ins)} for va,(ins,_,_) in sorted(lifter.blocks.items())],
  'cases':cases,'gsOffset':2048+ctx.registers['GS_OFFSET'].offset,
  'tls':{'templateRva':tls_rva,'templateSize':tls_size,'zeroFill':tls.SizeOfZeroFill,'indexRva':tls.AddressOfIndex-preferred,'callbacksExecuted':False},
  'generatedCsha256':hashlib.sha256(source.encode()).hexdigest(),'fullGeodeLoader':False}
 (out/'manifest.json').write_text(json.dumps(manifest,indent=2))
 print(json.dumps({k:v for k,v in manifest.items() if k not in ['instructions','cases']},indent=2))
if __name__=='__main__':main()
