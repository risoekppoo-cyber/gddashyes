#!/usr/bin/env python3
"""Lift only a native-observed callback path, stopping before an unresolved service.

Unknown instructions/services remain fatal. No Windows API success stubs.
"""
import hashlib,json,re,sys,ntpath,struct,math
from pathlib import Path
import pefile,pypcode,unicorn
from unicorn import x86_const as x
from lift import Lifter,LiftError,PIN,REGS

class WideLifter(Lifter):
 def __init__(self,pe):
  super().__init__(pe,4096,allow_indirect=True,yield_unknown=True)
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
  if code=='FLOAT_NAN' and a[0].size in [4,8]:
   value=f'bits_f{a[0].size*8}({self.expr(a[0])})'
   return self.assign(op.output,f'({value}!={value})')
  if code in ['FLOAT_EQUAL','FLOAT_NOTEQUAL','FLOAT_LESS','FLOAT_LESSEQUAL'] and a[0].size in [4,8]:
   operator={'FLOAT_EQUAL':'==','FLOAT_NOTEQUAL':'!=','FLOAT_LESS':'<','FLOAT_LESSEQUAL':'<='}[code];bits=a[0].size*8
   return self.assign(op.output,f'(bits_f{bits}({self.expr(a[0])}){operator}bits_f{bits}({self.expr(a[1])}))')
  if code=='FLOAT_INT2FLOAT' and op.output.size in [4,8] and a[0].size in [4,8]:
   return self.assign(op.output,f'f{op.output.size*8}_bits((int64_t)sext({self.expr(a[0])},{a[0].size}u))')
  if code in ['FLOAT_ADD','FLOAT_SUB','FLOAT_MULT','FLOAT_DIV'] and op.output.size in [4,8]:
   operator={'FLOAT_ADD':'+','FLOAT_SUB':'-','FLOAT_MULT':'*','FLOAT_DIV':'/'}[code];bits=op.output.size*8
   return self.assign(op.output,f'f{bits}_bits(bits_f{bits}({self.expr(a[0])}){operator}bits_f{bits}({self.expr(a[1])}))')
  if code=='FLOAT_FLOAT2FLOAT' and a[0].size in [4,8] and op.output.size in [4,8]:
   return self.assign(op.output,f'f{op.output.size*8}_bits(bits_f{a[0].size*8}({self.expr(a[0])}))')
  if code=='FLOAT_TRUNC' and a[0].size in [4,8] and op.output.size in [4,8]:
   return self.assign(op.output,f'float_trunc(bits_f{a[0].size*8}({self.expr(a[0])}),{op.output.size}u)')
  if code=='INT_SRIGHT' and a[0].size<=8:
   value,shift=[self.expr(v) for v in a];bits=a[0].size*8
   return self.assign(op.output,f'({shift}>={bits}u?(({value}>>{bits-1})&1u?mask({a[0].size}u):0u):(uint64_t)((int64_t)sext({value},{a[0].size}u)>>{shift}))')
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
  try:emitted=[self.emit_op(op,i,len(ops)) for i,op in enumerate(ops)]
  except LiftError as error:raise LiftError(f'{error}; instruction {ins}') from error
  # Supply architectural AF where SLEIGH omits it; capture the actual p-code
  # operands before a destination register can be overwritten.
  match=re.search(r': (ADD|SUB|CMP|INC|DEC) ',str(ins))
  if match:
   kind='INT_ADD' if match[1] in ['ADD','INC'] else 'INT_SUB'
   candidates=[i for i,op in enumerate(ops) if op.opcode.name==kind and op.output.size<=8 and len(op.inputs)==2]
   if not candidates:raise LiftError('Missing arithmetic p-code for AF: '+str(ins))
   i=candidates[-1];a,b=[self.expr(v) for v in ops[i].inputs];operator='+' if kind=='INT_ADD' else '-'
   emitted[i]='{uint64_t af_a='+a+',af_b='+b+';'+emitted[i]+f'raw_write(cpu+2564u,((af_a^af_b^(af_a{operator}af_b))>>4)&1u,1u);'+'}'
  self.blocks[va]=(ins,ops,emitted)
 def source(self):
  s=super().source().replace('uint64_t u_','wide_t u_')
  return s.replace('__attribute__((visibility("default")))',WIDE+'\n__attribute__((visibility("default")))')

WIDE='''typedef unsigned __int128 wide_t;
static inline uint64_t f32_bits(float f){union{float f;uint32_t u;}v={.f=f};return v.u;}
static inline uint64_t f64_bits(double f){union{double f;uint64_t u;}v={.f=f};return v.u;}
static inline float bits_f32(uint64_t u){union{float f;uint32_t u;}v={.u=(uint32_t)u};return v.f;}
static inline double bits_f64(uint64_t u){union{double f;uint64_t u;}v={.u=u};return v.f;}
static inline uint64_t float_trunc(double f,uint32_t size){double bound=size==4u?2147483648.0:9223372036854775808.0;if(!(f>=-bound&&f<bound))return size==4u?UINT64_C(0x80000000):UINT64_C(0x8000000000000000);return (uint64_t)(int64_t)f&mask(size);}
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
 cases=[];observed=set();boundaries=[];sar_fixture=[None]
 for image_base in [0x2000000,0x16000000]:
  for variant in range(4):
   image=bytearray(original)
   for block in pe.DIRECTORY_ENTRY_BASERELOC:
    for rel in block.entries:
     if rel.type==10:
      image[rel.rva:rel.rva+8]=((int.from_bytes(image[rel.rva:rel.rva+8],'little')+image_base-preferred)&((1<<64)-1)).to_bytes(8,'little')
   ctype=json.loads((Path(__file__).parent/'ctype-c.mjs').read_text().split('export const CTYPE_C=',1)[1].rstrip().rstrip(';'))
   crt=['wcslen','strlen','memcpy','memmove','memset','memcmp','malloc','calloc','realloc','free']+list(ctype)
   encoding=['WideCharToMultiByte','MultiByteToWideChar']
   file_services=['CreateFileW','GetFinalPathNameByHandleW','CloseHandle','SetCurrentDirectoryW','GetCurrentDirectoryW']
   lifecycle=['_initialize_onexit_table','_register_onexit_function','_execute_onexit_table','WakeAllConditionVariable']
   services={n:0x70000000+i*16 for i,n in enumerate(['AcquireSRWLockExclusive','ReleaseSRWLockExclusive','GetModuleFileNameW','GetLastError','SetLastError']+crt+encoding+['GetFullPathNameW']+file_services+lifecycle+['GetAsyncKeyState','ceilf','GetModuleHandleW'])}
   for rva,name in imports.items():image[rva:rva+8]=services.get(name.split('!')[-1],0).to_bytes(8,'little')
   uc=unicorn.Uc(unicorn.UC_ARCH_X86,unicorn.UC_MODE_64)
   uc.mem_map(image_base,(size+4095)&~4095);uc.mem_write(image_base,bytes(image))
   uc.mem_map(0x70000000,4096)
   uc.mem_map(0x1800000,0x400000);heap_at=[0x1800000];allocations={}
   def allocate(n,zero=False):
    if n>0x7ffffff0:return 0
    capacity=max(1,n)+15;raw=heap_at[0];heap_at[0]=(raw+capacity+7)&~7
    if heap_at[0]>0x1c00000:raise RuntimeError('Native fixture heap exhausted')
    pointer=(raw+15)&~15;allocations[pointer]=n
    if zero and n:uc.mem_write(pointer,b'\0'*n)
    return pointer
   def free(pointer):
    if pointer:
     if pointer not in allocations:raise RuntimeError('Unowned native fixture free')
     del allocations[pointer]
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
   if variant==3:
    if sar_fixture[0] is None:raise RuntimeError('Reached SAR fixture missing')
    entry_rva=sar_fixture[0][0];values[9]=0x8000000000000001;values[1]=1
   for reg,value in zip(REGS,values):uc.reg_write(getattr(x,'UC_X86_REG_'+reg),value)
   xmm=[((i+1)*0x01010101010101010101010101010101)&((1<<128)-1) for i in range(16)]
   for i,value in enumerate(xmm):uc.reg_write(getattr(x,'UC_X86_REG_XMM'+str(i)),value)
   flags=0x202 if not variant else 0xad7;uc.reg_write(x.UC_X86_REG_EFLAGS,flags)
   # Explicit CRT component initialization, required before registration. This
   # does not execute the DLL's complete CRT entrypoint or TLS callbacks.
   onexit={image_base+0xfb1960:{'callbacks':[],'buffer':0,'capacity':0}}
   uc.mem_write(image_base+0xfb1960,b'\0'*24)
   trace=[];boundary={};locks=set();service_calls=[];writes=[];defined_flags=[0x8d5];handles={};next_handle=[0x60000000];cwd=['C:\\GeometryDash']
   def memory_write(emu,_access,address,n,_value,_):
    if stack_base<=address<stack_base+stack_size:writes.append((address,address+n))
   uc.hook_add(unicorn.UC_HOOK_MEM_WRITE,memory_write)
   def hook(emu,address,n,_):
    if address in services.values():
     name=next(k for k,v in services.items() if v==address);ptr=emu.reg_read(x.UC_X86_REG_RCX)
     if name=='AcquireSRWLockExclusive':
      value=int.from_bytes(emu.mem_read(ptr,8),'little')
      if ptr in locks or value!=0:raise RuntimeError('Unsupported contended native lock')
      locks.add(ptr);emu.mem_write(ptr,(1).to_bytes(8,'little'))
     elif name=='ReleaseSRWLockExclusive':
      value=int.from_bytes(emu.mem_read(ptr,8),'little')
      if ptr not in locks or value!=1:raise RuntimeError('Unowned native lock release')
      locks.remove(ptr);emu.mem_write(ptr,b'\0'*8)
     elif name=='SetLastError':emu.mem_write(tib+0x68,(ptr&0xffffffff).to_bytes(4,'little'))
     elif name=='GetLastError':emu.reg_write(x.UC_X86_REG_RAX,int.from_bytes(emu.mem_read(tib+0x68,4),'little'))
     elif name=='GetModuleHandleW':
      if ptr:raise RuntimeError('Native fixture named module handle needs catalogue evidence')
      emu.reg_write(x.UC_X86_REG_RAX,0x400000)
     elif name=='GetAsyncKeyState':
      if ptr not in [16,17,18]:raise RuntimeError('Unsupported native fixture async key')
      emu.reg_write(x.UC_X86_REG_RAX,0) # No browser modifier pressed in the reference fixture.
     elif name=='ceilf':
      bits=emu.reg_read(x.UC_X86_REG_XMM0);value=struct.unpack('<f',(bits&0xffffffff).to_bytes(4,'little'))[0]
      result=float(math.ceil(value)) if math.isfinite(value) and value!=0 else value
      if -1<value<0:result=-0.0
      emu.reg_write(x.UC_X86_REG_XMM0,(bits&~0xffffffff)|int.from_bytes(struct.pack('<f',result),'little'))
     elif name in crt:
      a=ptr;b=emu.reg_read(x.UC_X86_REG_RDX);c=emu.reg_read(x.UC_X86_REG_R8);result=None
      if name in ctype:
       value=a&0xffffffff;value=value-(1<<32) if value>>31 else value
       if value< -1 or value>255:raise RuntimeError('Undefined native C ctype input')
       result=ctype[name][value if value>=0 else 256]&0xffffffff
      elif name in ['wcslen','strlen']:
       stride=2 if name=='wcslen' else 1;n=0
       while int.from_bytes(emu.mem_read(a+n*stride,stride),'little'):n+=1
       result=n
      elif name=='malloc':result=allocate(a)
      elif name=='calloc':result=allocate(a*b,True)
      elif name=='free':free(a)
      elif name=='realloc':
       if not a:result=allocate(b)
       elif not b:free(a);result=0
       else:
        if a not in allocations:raise RuntimeError('Unowned native fixture realloc')
        n=min(allocations[a],b);result=allocate(b)
        if result:
         if n:emu.mem_write(result,bytes(emu.mem_read(a,n)))
         free(a)
      elif name=='memset':
       if c:emu.mem_write(a,bytes([b&255])*c)
       result=a
      elif name=='memcmp':
       left=bytes(emu.mem_read(a,c)) if c else b'';right=bytes(emu.mem_read(b,c)) if c else b''
       result=next((-1 if x<y else 1 for x,y in zip(left,right) if x!=y),0)&0xffffffff
      else:
       if name=='memcpy' and a!=b and a<b+c and b<a+c:raise RuntimeError('Overlapping native memcpy fixture')
       if c:emu.mem_write(a,bytes(emu.mem_read(b,c)))
       result=a
      if result is not None:emu.reg_write(x.UC_X86_REG_RAX,result)
     elif name in lifecycle:
      result=None
      if name=='WakeAllConditionVariable':
       if int.from_bytes(emu.mem_read(ptr,8),'little')!=0:raise RuntimeError('Unsupported nonempty native condition variable')
      elif name=='_initialize_onexit_table':
       if ptr in onexit and onexit[ptr]['callbacks']:raise RuntimeError('Active native exit table reinitialization')
       onexit[ptr]={'callbacks':[],'buffer':0,'capacity':0};emu.mem_write(ptr,b'\0'*24);result=0
      elif ptr not in onexit:raise RuntimeError('Native onexit table requires explicit initialization')
      elif name=='_execute_onexit_table':
       if onexit[ptr]['callbacks']:raise RuntimeError('Native exit callbacks need a callback dispatcher')
       if onexit[ptr]['buffer']:free(onexit[ptr]['buffer'])
       del onexit[ptr];emu.mem_write(ptr,b'\0'*24);result=0
      else:
       entry=onexit[ptr];callback=emu.reg_read(x.UC_X86_REG_RDX)
       if len(entry['callbacks'])==entry['capacity']:
        capacity=max(4,entry['capacity']*2);buffer=allocate(capacity*8)
        if entry['buffer']:
         emu.mem_write(buffer,bytes(emu.mem_read(entry['buffer'],len(entry['callbacks'])*8)));free(entry['buffer'])
        entry['buffer']=buffer;entry['capacity']=capacity
       emu.mem_write(entry['buffer']+len(entry['callbacks'])*8,callback.to_bytes(8,'little'));entry['callbacks'].append(callback)
       emu.mem_write(ptr,b''.join(n.to_bytes(8,'little') for n in [entry['buffer'],entry['buffer']+len(entry['callbacks'])*8,entry['buffer']+entry['capacity']*8]));result=0
      if result is not None:emu.reg_write(x.UC_X86_REG_RAX,result)
     elif name in file_services:
      result=0;error=0
      if name=='SetCurrentDirectoryW':
       raw=bytearray();at=ptr
       while True:
        ch=bytes(emu.mem_read(at,2));at+=2
        if ch==b'\0\0':break
        raw.extend(ch)
       path=ntpath.normpath(ntpath.join(cwd[0],raw.decode('utf-16le')))
       if path.lower()!='c:\\geometrydash':error=3
       else:cwd[0]=path;result=1
      elif name=='GetCurrentDirectoryW':
       capacity=ptr&0xffffffff;output=emu.reg_read(x.UC_X86_REG_RDX);encoded=cwd[0].encode('utf-16le');units=len(encoded)//2
       if capacity<=units:result=units+1
       else:emu.mem_write(output,encoded+b'\0\0');result=units
      elif name=='CreateFileW':
       raw=bytearray();at=ptr
       while True:
        ch=bytes(emu.mem_read(at,2));at+=2
        if ch==b'\0\0':break
        raw.extend(ch)
       path=ntpath.normpath(raw.decode('utf-16le'));rsp=emu.reg_read(x.UC_X86_REG_RSP)
       disposition=int.from_bytes(emu.mem_read(rsp+40,4),'little');flags=int.from_bytes(emu.mem_read(rsp+48,4),'little')
       if emu.reg_read(x.UC_X86_REG_RDX)!=0 or disposition!=3 or emu.reg_read(x.UC_X86_REG_R9)!=0:raise RuntimeError('Unsupported native file access fixture')
       if path.lower()!='c:\\geometrydash':result=(1<<64)-1;error=3
       elif not flags&0x2000000:result=(1<<64)-1;error=5
       else:result=next_handle[0];next_handle[0]+=1;handles[result]=path
      elif name=='CloseHandle':
       if ptr in handles:del handles[ptr];result=1
       else:error=6
      elif ptr not in handles:error=6
      else:
       output=emu.reg_read(x.UC_X86_REG_RDX);capacity=emu.reg_read(x.UC_X86_REG_R8)&0xffffffff;flags=emu.reg_read(x.UC_X86_REG_R9)
       if flags not in [0,8]:raise RuntimeError('Unsupported native final path flags')
       text='\\\\?\\'+handles[ptr];encoded=text.encode('utf-16le');units=len(encoded)//2
       if capacity<=units:result=units+1
       else:emu.mem_write(output,encoded+b'\0\0');result=units
      if error:emu.mem_write(tib+0x68,error.to_bytes(4,'little'))
      emu.reg_write(x.UC_X86_REG_RAX,result)
     elif name in encoding:
      wide=name=='WideCharToMultiByte';flags=emu.reg_read(x.UC_X86_REG_RDX)&0xffffffff;input_pointer=emu.reg_read(x.UC_X86_REG_R8)
      count=emu.reg_read(x.UC_X86_REG_R9)&0xffffffff;count=count-(1<<32) if count>>31 else count
      rsp=emu.reg_read(x.UC_X86_REG_RSP);output=int.from_bytes(emu.mem_read(rsp+40,8),'little')
      capacity=int.from_bytes(emu.mem_read(rsp+48,4),'little',signed=True);result=0;error=0
      if ptr!=65001:raise RuntimeError(f'Unsupported native code page {ptr}')
      if flags not in [0,0x80 if wide else 8]:error=1004
      elif not input_pointer or count==0 or count< -1 or capacity<0 or capacity>0 and not output or input_pointer==output or wide and any(emu.mem_read(rsp+56,16)):error=87
      else:
       stride=2 if wide else 1;n=count
       if n==-1:
        n=0
        while True:
         value=int.from_bytes(emu.mem_read(input_pointer+n*stride,stride),'little');n+=1
         if not value:break
       raw=bytes(emu.mem_read(input_pointer,n*stride))
       try:
        text=raw.decode('utf-16le' if wide else 'utf-8','strict' if flags else 'replace')
        encoded=text.encode('utf-8' if wide else 'utf-16le');units=len(encoded)//(1 if wide else 2)
        if capacity==0:result=units
        elif capacity<units:error=122
        else:emu.mem_write(output,encoded);result=units
       except UnicodeError:error=1113
      if error:emu.mem_write(tib+0x68,error.to_bytes(4,'little'))
      emu.reg_write(x.UC_X86_REG_RAX,result)
     elif name=='GetFullPathNameW':
      raw=bytearray();at=ptr
      while True:
       c=bytes(emu.mem_read(at,2));at+=2
       if c==b'\0\0':break
       raw.extend(c)
      text=raw.decode('utf-16le');capacity=emu.reg_read(x.UC_X86_REG_RDX)&0xffffffff
      output=emu.reg_read(x.UC_X86_REG_R8);part=emu.reg_read(x.UC_X86_REG_R9);result=0
      if not text:emu.mem_write(tib+0x68,(123).to_bytes(4,'little'))
      else:
       text=text.replace('/','\\')
       if text.startswith('\\\\'):raise RuntimeError('Unconfigured native UNC/device path')
       full=ntpath.normpath(ntpath.join(cwd[0],text))
       if text.endswith('\\') and not full.endswith('\\'):full+='\\'
       elif not full.endswith('\\'):full=full.rstrip(' .')
       encoded=full.encode('utf-16le');units=len(encoded)//2
       if capacity<=units:result=units+1
       else:
        emu.mem_write(output,encoded+b'\0\0');result=units
        if part:
         value=0 if full.endswith('\\') else output+len(full[:full.rfind('\\')+1].encode('utf-16le'))
         emu.mem_write(part,value.to_bytes(8,'little'))
      emu.reg_write(x.UC_X86_REG_RAX,result)
     else:
      path={0:'C:\\GeometryDash\\GeometryDash.exe',0x400000:'C:\\GeometryDash\\GeometryDash.exe',image_base:'C:\\GeometryDash\\Geode.dll'}.get(ptr)
      capacity=emu.reg_read(x.UC_X86_REG_R8)&0xffffffff;result=0;error=0
      if path is None:error=126
      elif capacity==0:error=122
      else:
       encoded=path.encode('utf-16le');result=min(len(encoded)//2,capacity)
       emu.mem_write(emu.reg_read(x.UC_X86_REG_RDX),encoded[:(capacity-1)*2]+b'\0\0')
       if len(encoded)//2>=capacity:error=122
      emu.reg_write(x.UC_X86_REG_RAX,result);emu.mem_write(tib+0x68,error.to_bytes(4,'little'))
     service_calls.append(name)
     rsp=emu.reg_read(x.UC_X86_REG_RSP);ret=int.from_bytes(emu.mem_read(rsp,8),'little')
     emu.reg_write(x.UC_X86_REG_RSP,rsp+8);emu.reg_write(x.UC_X86_REG_RIP,ret);return
    rva=address-image_base
    if not 0<=rva<size:raise RuntimeError(f'Unexpected target {address:#x}')
    if variant==2 and rva==0x12df21:
     boundary.update(rva=rva,service='SIMD fixture stop');emu.emu_stop();return
    if variant==3 and rva==sar_fixture[0][0]+sar_fixture[0][1]:
     boundary.update(rva=rva,service='Signed-shift fixture stop');emu.emu_stop();return
    b=bytes(emu.mem_read(address,min(16,size-rva)))
    if b[:2] in [b'\xff\x15',b'\xff\x25']:
     slot=rva+6+int.from_bytes(b[2:6],'little',signed=True)
     if slot in imports and imports[slot].split('!')[-1] not in services:
      boundary.update(rva=rva,service=imports[slot],iatRva=slot)
      boundary['arguments']=[hex(emu.reg_read(getattr(x,'UC_X86_REG_'+r))) for r in ['RCX','RDX','R8','R9']]
      if imports[slot].endswith('!CreateFileW'):
       pointer=emu.reg_read(x.UC_X86_REG_RCX);raw=bytearray()
       for i in range(32768):
        ch=bytes(emu.mem_read(pointer+i*2,2))
        if ch==b'\0\0':break
        raw.extend(ch)
       rsp=emu.reg_read(x.UC_X86_REG_RSP)
       boundary['fileRequest']={'path':raw.decode('utf-16le'),'access':hex(emu.reg_read(x.UC_X86_REG_RDX)),'share':hex(emu.reg_read(x.UC_X86_REG_R8)),'disposition':int.from_bytes(emu.mem_read(rsp+32,4),'little'),'flags':hex(int.from_bytes(emu.mem_read(rsp+40,4),'little'))}
      emu.emu_stop();return
    instruction=str(ctx.disassemble(pe.get_data(rva,16),base_address=preferred+rva,max_instructions=1).instructions[0])
    mnemonic=instruction.split(': ',1)[1].split(' ',1)[0]
    if mnemonic=='SAR' and 'R9' in instruction and sar_fixture[0] is None:sar_fixture[0]=(rva,n)
    if mnemonic in ['ADD','SUB','CMP','ADC','SBB','NEG']:defined_flags[0]=0x8d5
    elif mnemonic in ['INC','DEC']:defined_flags[0]=(defined_flags[0]&1)|0x8d4
    elif mnemonic in ['TEST','AND','OR','XOR']:defined_flags[0]=0x8c5
    elif mnemonic in ['SHL','SHR','SAR','SHLD','SHRD']:defined_flags[0]&=~0x810
    elif mnemonic in ['MUL','IMUL']:defined_flags[0]&=0x801
    trace.append(rva);observed.add(rva)
    if len(trace)>50000:raise RuntimeError('Native path step limit')
   uc.hook_add(unicorn.UC_HOOK_CODE,hook)
   try:uc.emu_start(image_base+entry_rva,0,count=50001)
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
     'expectedFlags':uc.reg_read(x.UC_X86_REG_EFLAGS),'definedFlagsMask':defined_flags[0],'stopRva':boundary['rva'],'steps':len(trace),
     'stackBase':stack_base,'stackHex':bytes(uc.mem_read(stack_base,stack_size)).hex(),'dllChanges':changes,
     'tib':tib,'tlsArray':tls_array,'tlsData':tls_data,'tlsHex':bytes(uc.mem_read(tls_data,tls_size+tls.SizeOfZeroFill)).hex(),
     'serviceCalls':service_calls,'stackBelow':sp-min([a for a,b in writes]+[sp]),'stackAbove':max([b for a,b in writes]+[sp])-sp,
     'heapHex':bytes(uc.mem_read(0x1800000,heap_at[0]-0x1800000)).hex() if heap_at[0]>0x1800000 else '',
     'onexitCallbacks':[str(callback) for table in onexit.values() for callback in table['callbacks']]})
   boundaries.append(boundary)
 lifter=WideLifter(pe)
 for rva in sorted(observed):lifter.add(preferred+rva)
 source=lifter.source();(out/'deferred.c').write_text(source)
 manifest={'dllSha256':PIN,'entryRva':0x12f200,'boundaries':boundaries,'uniqueInstructions':len(observed),
  'instructions':[{'rva':va-preferred,'length':ins.length,'assembly':str(ins)} for va,(ins,_,_) in sorted(lifter.blocks.items())],
  'cases':cases,'gsOffset':2048+ctx.registers['GS_OFFSET'].offset,'onexitTables':[0xfb1960],
  'tls':{'templateRva':tls_rva,'templateSize':tls_size,'zeroFill':tls.SizeOfZeroFill,'indexRva':tls.AddressOfIndex-preferred,'callbacksExecuted':False},
  'generatedCsha256':hashlib.sha256(source.encode()).hexdigest(),'fullGeodeLoader':False}
 (out/'manifest.json').write_text(json.dumps(manifest,indent=2))
 print(json.dumps({k:v for k,v in manifest.items() if k not in ['instructions','cases']},indent=2))
if __name__=='__main__':main()
