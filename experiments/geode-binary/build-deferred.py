#!/usr/bin/env python3
"""Lift only a native-observed callback path, stopping before an unresolved service.

Unknown instructions/services remain fatal. No Windows API success stubs.
"""
import hashlib,json,re,sys,ntpath,struct,math
from pathlib import Path
import pefile,pypcode,unicorn
from unicorn import x86_const as x
from lift import Lifter,LiftError,PIN,REGS,PRELUDE

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
  if code=='CALLOTHER' and str(op).strip() in ['LOCK()','UNLOCK()']:
   return '__atomic_signal_fence(5);' # One non-shared, synchronous guest CPU.
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
  if code in ['INT_DIV','INT_REM'] and a[0].size==16:
   return self.assign(op.output,f'unsigned_divrem128({self.expr(a[0])},{self.expr(a[1])},{1 if code=="INT_REM" else 0}u)')
  if code in ['INT_DIV','INT_REM'] and a[0].size<=8:
   return self.assign(op.output,f'unsigned_divrem({self.expr(a[0])},{self.expr(a[1])},{1 if code=="INT_REM" else 0}u)')
  if code=='INT_SRIGHT' and a[0].size<=8:
   value,shift=[self.expr(v) for v in a];bits=a[0].size*8
   return self.assign(op.output,f'({shift}>={bits}u?(({value}>>{bits-1})&1u?mask({a[0].size}u):0u):(uint64_t)((int64_t)sext({value},{a[0].size}u)>>{shift}))')
  if max([v.size for v in a]+([op.output.size] if op.output else [])+[0])<=8:
   return super().emit_op(op,index,count)
  if code=='COPY':return self.assign(op.output,self.expr(a[0]))
  if code=='INT_ZEXT' and op.output.size==16:return self.assign(op.output,f'(wide_t){self.expr(a[0])}')
  if code=='INT_SEXT' and op.output.size==16:return self.assign(op.output,f'(wide_t)(__int128)(int64_t)sext({self.expr(a[0])},{a[0].size}u)')
  if code=='INT_MULT' and op.output.size==16:return self.assign(op.output,f'((wide_t){self.expr(a[0])}*(wide_t){self.expr(a[1])})')
  if code in ['INT_EQUAL','INT_NOTEQUAL']:
   operator='==' if code=='INT_EQUAL' else '!='
   return self.assign(op.output,f'({self.expr(a[0])}{operator}{self.expr(a[1])})')
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
  if ': DIV ' in str(ins) and not re.search(r': DIV (?:E[ABCD]X|E[BS]P|E[SD]I|R(?:[89]|1[0-5])D|R(?:AX|BX|CX|DX|SP|BP|SI|DI|[89]|1[0-5]))$',str(ins)):raise LiftError('Unverified unsigned division form: '+str(ins))
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
  # Keep each machine-code page in a separate non-inlined function. A single
  # multi-thousand-case switch exhausted V8's optimizing compiler memory.
  groups={}
  for va,block in sorted(self.blocks.items()):groups.setdefault((va-self.base)>>8,[]).append((va,block))
  source=PRELUDE.split('__attribute__((visibility("default")))',1)[0]+WIDE
  for group,blocks in groups.items():
   source+=f'\n__attribute__((noinline)) static uint32_t page_{group}(uint32_t cpu,uint64_t image_base,uint32_t guest_base,uint64_t pc){{switch(pc-image_base){{\n'
   for va,(ins,ops,emitted) in blocks:
    unique=sorted({v.offset for op in ops for v in ([op.output] if op.output else [])+list(op.inputs) if v.space.name=='unique'})
    source+=f'case UINT64_C({va-self.base}):{{ /* {ins} */\n'
    source+='\n'.join(f'wide_t u_{n:x}=0;' for n in unique)+'\n'
    division=re.search(r': DIV (E[ABCD]X|E[BS]P|E[SD]I|R(?:[89]|1[0-5])D|R(?:AX|BX|CX|DX|SP|BP|SI|DI|[89]|1[0-5]))$',str(ins))
    if division:
     operand=self.ctx.registers[division[1]];offset=self.reg_offset(operand);width=operand.size
     source+=f'if(raw_read(cpu+{offset}u,{width}u)==0u||raw_read(cpu+16u,{width}u)>=raw_read(cpu+{offset}u,{width}u)){{lift_fault(5u,raw_read(cpu+{offset}u,{width}u),image_base+UINT64_C({va-self.base}));__builtin_trap();}}\n'
    source+=f'raw_write(cpu+192u,image_base+UINT64_C({va-self.base+ins.length}),8u);\n'
    for i,line in enumerate(emitted):
     line=re.sub(r'\bop_(\d+)\b',lambda m:f'pc_{va:x}_op_{m[1]}',line)
     source+=f'pc_{va:x}_op_{i}: ; '+line+'\n'
    source+=f'pc_{va:x}_op_{len(ops)}: ; goto next_instruction;}}\n'
   source+='default:return 0u;}next_instruction:return 1u;}\n'
  source+='''\n__attribute__((visibility("default")))
uint32_t lift_run(uint32_t cpu,uint64_t entry,uint64_t image_base,uint32_t guest_base,uint64_t stop,uint32_t limit){
raw_write(cpu+192u,entry,8u);for(uint32_t step=0;step<limit;step++){
uint64_t pc=raw_read(cpu+192u,8u);if(pc==stop)return step;uint32_t handled=0;
switch((pc-image_base)>>8){
'''
  for group in groups:source+=f'case UINT64_C({group}):handled=page_{group}(cpu,image_base,guest_base,pc);break;\n'
  return source+'''default:break;}if(!handled)return 0x80000000u|step;
}lift_fault(4u,raw_read(cpu+192u,8u),entry);__builtin_trap();}\n'''

WIDE='''static inline uint64_t unsigned_divrem(uint64_t a,uint64_t b,uint32_t remainder){if(!b){lift_fault(5u,b,0);__builtin_trap();}return remainder?a%b:a/b;}
typedef unsigned __int128 wide_t;
typedef union {wide_t value;struct{uint64_t lo,hi;}words;} wide_words;
static inline wide_t unsigned_divrem128(wide_t dividend,wide_t divisor,uint32_t remainder){
 wide_words a={.value=dividend},b={.value=divisor};uint64_t r=a.words.hi,q=0;
 if(b.words.hi||!b.words.lo||r>=b.words.lo){lift_fault(5u,b.words.lo,0);__builtin_trap();}
 for(int i=63;i>=0;i--){uint64_t carry=r>>63;r=(r<<1)|((a.words.lo>>i)&1u);if(carry||r>=b.words.lo){r-=b.words.lo;q|=UINT64_C(1)<<i;}}
 return (wide_t)(remainder?r:q);
}

wide_t __multi3(wide_t a,wide_t b){wide_words x={.value=a},y={.value=b},r;uint64_t a0=(uint32_t)x.words.lo,a1=x.words.lo>>32,b0=(uint32_t)y.words.lo,b1=y.words.lo>>32,p=a0*b0,t=a1*b0+(p>>32),u=a0*b1+(uint32_t)t;r.words.lo=(u<<32)|(uint32_t)p;r.words.hi=a1*b1+(t>>32)+(u>>32)+x.words.lo*y.words.hi+x.words.hi*y.words.lo;return r.value;}
wide_t __lshrti3(wide_t value,int n){wide_words x={.value=value},r;if(n<=0)return value;if(n>=128){r.words.lo=0;r.words.hi=0;}else if(n>=64){r.words.lo=x.words.hi>>(n-64);r.words.hi=0;}else{r.words.lo=(x.words.lo>>n)|(x.words.hi<<(64-n));r.words.hi=x.words.hi>>n;}return r.value;}
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
 game_headers=json.loads(Path('integration-input/game-headers.json').read_text())
 assert game_headers['base']==0x400000 and game_headers['gameWasmSha256']=='523d9362955eba27a8ce64ec9b4fda496c8ecc30e6ac9ca1f01cc76c89a5a15a'
 header_bytes=bytes.fromhex(game_headers['hex']);assert len(header_bytes)==4096 and header_bytes[:2]==b'MZ'
 timestamp_rva=0xfb22a8;cmp=pe.get_data(0x12f281,6)
 assert cmp[:2]==b'\x3b\x05' and 0x12f287+int.from_bytes(cmp[2:6],'little',signed=True)==timestamp_rva
 game_timestamp=int.from_bytes(header_bytes[int.from_bytes(header_bytes[0x3c:0x40],'little')+8:][:4],'little')
 cocos=json.loads(Path('integration-input/cocos-binding.json').read_text())
 assert cocos['gameWasmSha256']==game_headers['gameWasmSha256'] and cocos['dll']=='libcocos2d.dll'
 assert cocos['name']=='?convertToNodeSpace@CCNode@cocos2d@@QEAA?AVCCPoint@2@AEBV32@@Z'
 cocos_page=bytes.fromhex(cocos['pageHex']);assert len(cocos_page)==4096 and cocos['pageBase']%4096==0
 assert cocos['address']==cocos['base']+cocos['rva'] and cocos['pageBase']<=cocos['address']<cocos['pageBase']+4096
 external={cocos['dll']+'!'+cocos['name']:cocos['address']}
 original=pe.get_memory_mapped_image().ljust(size,b'\0');ctx=pypcode.Context('x86:LE:64:default')
 imports={}
 for group in [getattr(pe,'DIRECTORY_ENTRY_IMPORT',[]),getattr(pe,'DIRECTORY_ENTRY_DELAY_IMPORT',[])]:
  for desc in group:
   for imp in desc.imports:imports[imp.address-preferred]=desc.dll.decode()+'!'+(imp.name.decode() if imp.name else '#'+str(imp.ordinal))
 cases=[];observed=set();boundaries=[];sar_fixture=[None]
 for image_base in [0x2000000,0x16000000]:
  for variant in range(18):
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
   console=['GetStdHandle','GetConsoleMode','SetConsoleMode','AttachConsole']
   stdio=['__acrt_iob_func','_fileno','_dup','_fdopen','_get_osfhandle','_close']
   pipe_services=['CreateNamedPipeW','ReadFile','WriteFile','GetOverlappedResult','freopen_s','_write']
   critical_names=['InitializeCriticalSection','EnterCriticalSection','LeaveCriticalSection','TryEnterCriticalSection','DeleteCriticalSection','InitializeConditionVariable','WakeConditionVariable']
   iocp_names=['CreateIoCompletionPort','PostQueuedCompletionStatus','GetQueuedCompletionStatus']
   exception_names=['?__ExceptionPtrCreate@@YAXPEAX@Z','?__ExceptionPtrDestroy@@YAXPEAX@Z','?__ExceptionPtrCopy@@YAXPEAXPEBX@Z','?__ExceptionPtrAssign@@YAXPEAXPEBX@Z','?__ExceptionPtrToBool@@YA_NPEBX@Z']
   services={n:0x70000000+i*16 for i,n in enumerate(['AcquireSRWLockExclusive','ReleaseSRWLockExclusive','GetModuleFileNameW','GetLastError','SetLastError']+crt+encoding+['GetFullPathNameW']+file_services+lifecycle+['GetAsyncKeyState','ceilf','GetModuleHandleW','GetCurrentThreadId','powf','RaiseException']+console+stdio+['GetCurrentProcessId']+pipe_services+critical_names+iocp_names+['_beginthreadex']+exception_names+['QueryPerformanceFrequency','QueryPerformanceCounter'])}
   def bound(name):return name.split('!')[-1] in services or name in external
   for rva,name in imports.items():image[rva:rva+8]=services.get(name.split('!')[-1],external.get(name,0)).to_bytes(8,'little')
   uc=unicorn.Uc(unicorn.UC_ARCH_X86,unicorn.UC_MODE_64)
   uc.mem_map(image_base,(size+4095)&~4095);uc.mem_write(image_base,bytes(image))
   initial_timestamp=0 if variant==1 else game_timestamp
   uc.mem_write(image_base+timestamp_rva,initial_timestamp.to_bytes(4,'little'))
   uc.mem_map(game_headers['base'],4096);uc.mem_write(game_headers['base'],header_bytes)
   for start,length in [(image_base,size),(0x400000,4096),(0x1800000,0x400000),(0x100000,0x10000),(0x120000,0x10000)]:
    assert not(cocos['pageBase']<start+length and start<cocos['pageBase']+4096),'Cocos page overlaps fixture storage'
   uc.mem_map(cocos['pageBase'],4096);uc.mem_write(cocos['pageBase'],cocos_page)
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
     n=allocations[pointer]
     for p in list(exception_state):
      if pointer<=p<pointer+n:exception_state.remove(p)
     del allocations[pointer]
   # One explicit static-TLS fixture. This models template/zero-fill storage,
   # not TLS callback execution, Windows threading, or completed CRT startup.
   tls=pe.DIRECTORY_ENTRY_TLS.struct
   tls_rva=tls.StartAddressOfRawData-preferred;tls_size=tls.EndAddressOfRawData-tls.StartAddressOfRawData
   if tls_size+tls.SizeOfZeroFill>4096:raise RuntimeError('TLS fixture exceeds bounded reservation')
   tib=0x120000;tls_array=tib+0x1000;tls_data=tib+0x2000
   uc.mem_map(tib,0x10000)
   uc.mem_write(tib+0x58,tls_array.to_bytes(8,'little'));uc.mem_write(tls_array,tls_data.to_bytes(8,'little'))
   uc.mem_write(tib+0x48,(1).to_bytes(8,'little'))
   uc.mem_write(tib+0x40,(1).to_bytes(8,'little'))
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
   division_fault=variant in [7,8,10,12,16,17]
   if variant>=4:
    entry_rva=0x50fc87 if variant>=13 else 0x50fc6e if variant>=11 else 0x4f074e if variant>=9 else 0x4f060f
    division_length=2 if 11<=variant<13 else 3
    assert pe.get_data(entry_rva,division_length)==bytes.fromhex('48f7f7' if variant>=13 else 'f7f7' if variant>=11 else '41f7f1' if variant>=9 else '41f7f0'),'Pinned division instruction changed'
    dividend_cases={4:(0xabcdef01ffffffff,0xdeadbeef00000000,3),5:(0x12345678,1,2),6:(0xfedcba98,0x1234,0x1235),7:(123,0,0),8:(0,2,2),9:(0xfedcba98,0x1234,0x1235),10:(0,2,2),11:(0x12345678,1,3),12:(123,0,0),13:(0xffffffffffffffff,0,3),14:(0xffffffffffffffff,0x123456789abcdef0,0xfedcba9876543210),15:(0xffffffffffffffff,0xfffffffffffffffe,0xffffffffffffffff),16:(123,0,0),17:(0,2,2)}
    values[0],values[2],values[7 if variant>=11 else 9 if variant>=9 else 8]=dividend_cases[variant]
   for reg,value in zip(REGS,values):uc.reg_write(getattr(x,'UC_X86_REG_'+reg),value)
   xmm=[((i+1)*0x01010101010101010101010101010101)&((1<<128)-1) for i in range(16)]
   for i,value in enumerate(xmm):uc.reg_write(getattr(x,'UC_X86_REG_XMM'+str(i)),value)
   flags=0x202 if not variant else 0xad7;uc.reg_write(x.UC_X86_REG_EFLAGS,flags)
   # Explicit CRT component initialization, required before registration. This
   # does not execute the DLL's complete CRT entrypoint or TLS callbacks.
   onexit={image_base+0xfb1960:{'callbacks':[],'buffer':0,'capacity':0}}
   uc.mem_write(image_base+0xfb1960,b'\0'*24)
   current_id=1;worker_mode=False
   trace=[];boundary={};locks=set();service_calls=[];writes=[];defined_flags=[0x8d5];handles={};next_handle=[0x60000000];cwd=['C:\\GeometryDash'];thread_names={}
   stdio_state={'base':0,'streams':{},'fds':{},'nextHandle':0x61000010}
   pipe_state={'nextHandle':0x62000000,'pipes':[],'byName':{},'ends':{},'completions':[],'outputs':[]}
   critical_state={};exception_state=set();clock_value=[1000000000];clock_reads=[0]
   port_state={'next':0x63000000,'ports':{},'associations':{}}
   def memory_write(emu,_access,address,n,_value,_):
    if stack_base<=address<stack_base+stack_size:writes.append((address,address+n))
   uc.hook_add(unicorn.UC_HOOK_MEM_WRITE,memory_write)
   # An unresolved function pointer must not silently become a null pointer
   # and change a probe's branch. Catch indirect IAT reads as well as calls.
   unresolved={image_base+rva:name for rva,name in imports.items() if not bound(name)}
   import_snapshot=[]
   def import_read(emu,_access,address,n,_value,_):
    slot=next((p for p in range(address-7,address+n) if p in unresolved),None)
    if slot is None:return
    pc=emu.reg_read(x.UC_X86_REG_RIP);rva=pc-image_base
    ins=str(ctx.disassemble(pe.get_data(rva,16),base_address=preferred+rva,max_instructions=1).instructions[0])
    if not re.search(r': MOV(?:ZX|SX|SXD|UPS|APS|DQA|DQU|Q|D)? (?:[RE][A-Z0-9]+|XMM[0-9]+),',ins):raise RuntimeError('Unresolved import read needs an explicit pre-instruction boundary: '+ins)
    regs=[getattr(x,'UC_X86_REG_'+r) for r in REGS]+[getattr(x,'UC_X86_REG_XMM'+str(i)) for i in range(16)]+[x.UC_X86_REG_EFLAGS,x.UC_X86_REG_RIP]
    import_snapshot.extend((reg,emu.reg_read(reg)) for reg in regs)
    boundary.update(rva=rva,service=unresolved[slot],iatRva=slot-image_base,kind='import-address-read')
    emu.emu_stop()
   uc.hook_add(unicorn.UC_HOOK_MEM_READ,import_read)
   def hook(emu,address,n,_):
    if address in services.values():
     name=next(k for k,v in services.items() if v==address);ptr=emu.reg_read(x.UC_X86_REG_RCX)
     if worker_mode and name in ['ReadFile','WriteFile','GetOverlappedResult','GetQueuedCompletionStatus']:
      boundary.update(rva=address-image_base,service=name,kind='worker-service-entry',stopService=name);emu.emu_stop();return
     if name=='_beginthreadex':
      rsp=emu.reg_read(x.UC_X86_REG_RSP);start=emu.reg_read(x.UC_X86_REG_R8);argument=emu.reg_read(x.UC_X86_REG_R9);id_out=int.from_bytes(emu.mem_read(rsp+48,8),'little')
      boundary.update(rva=address-image_base,service='api-ms-win-crt-runtime-l1-1-0.dll!_beginthreadex',kind='thread-start-request',stopService='_beginthreadex')
      boundary['threadRequest']={'security':hex(ptr),'stackSize':emu.reg_read(x.UC_X86_REG_RDX)&0xffffffff,'entryAddress':hex(start),'entryRva':start-image_base if image_base<=start<image_base+size else None,'argument':hex(argument),'argumentIsNull':argument==0,'initFlags':int.from_bytes(emu.mem_read(rsp+40,4),'little'),'threadIdOutput':hex(id_out),'threadIdOutputIsNull':id_out==0,'threadCreationImplemented':False}
      emu.emu_stop();return
     if name in ['QueryPerformanceFrequency','QueryPerformanceCounter']:
      if name=='QueryPerformanceFrequency':value=10000000
      else:clock_value[0]+=10000;clock_reads[0]+=1;value=clock_value[0]
      emu.mem_write(ptr,value.to_bytes(8,'little',signed=True));emu.reg_write(x.UC_X86_REG_RAX,1)
     elif name in exception_names:
      if ptr%8:raise RuntimeError('Unaligned native exception_ptr')
      op=exception_names.index(name)
      def empty_exception(p):
       if p not in exception_state:raise RuntimeError('Unowned native exception_ptr')
       if any(emu.mem_read(p,16)):raise RuntimeError('Non-empty native exception_ptr needs record ownership')
      if op in [0,2]:
       if ptr in exception_state:raise RuntimeError('Native exception_ptr already constructed')
       if op==2:empty_exception(emu.reg_read(x.UC_X86_REG_RDX))
       emu.mem_write(ptr,b'\0'*16);exception_state.add(ptr)
      else:
       empty_exception(ptr)
       if op==1:exception_state.remove(ptr)
       elif op==3:empty_exception(emu.reg_read(x.UC_X86_REG_RDX))
       else:emu.reg_write(x.UC_X86_REG_RAX,0)
     elif name=='AcquireSRWLockExclusive':
      value=int.from_bytes(emu.mem_read(ptr,8),'little')
      if ptr in locks or value!=0:raise RuntimeError('Unsupported contended native lock')
      locks.add(ptr);emu.mem_write(ptr,(1).to_bytes(8,'little'))
     elif name=='ReleaseSRWLockExclusive':
      value=int.from_bytes(emu.mem_read(ptr,8),'little')
      if ptr not in locks or value!=1:raise RuntimeError('Unowned native lock release')
      locks.remove(ptr);emu.mem_write(ptr,b'\0'*8)
     elif name=='SetLastError':emu.mem_write(tib+0x68,(ptr&0xffffffff).to_bytes(4,'little'))
     elif name=='GetLastError':emu.reg_write(x.UC_X86_REG_RAX,int.from_bytes(emu.mem_read(tib+0x68,4),'little'))
     elif name=='GetCurrentThreadId':emu.reg_write(x.UC_X86_REG_RAX,current_id)
     elif name=='GetCurrentProcessId':emu.reg_write(x.UC_X86_REG_RAX,1)
     elif name=='CloseHandle' and ptr in port_state['ports']:
      del port_state['ports'][ptr];emu.reg_write(x.UC_X86_REG_RAX,1)
     elif name in iocp_names:
      b=emu.reg_read(x.UC_X86_REG_RDX);c=emu.reg_read(x.UC_X86_REG_R8);d=emu.reg_read(x.UC_X86_REG_R9);result=0;error=0
      if name=='CreateIoCompletionPort':
       if ptr==(1<<64)-1 and b:error=87
       elif b and b not in port_state['ports']:error=6
       elif ptr in port_state['associations']:error=87
       else:
        if ptr!=(1<<64)-1 and (ptr not in pipe_state['ends'] or pipe_state['ends'][ptr][1]!='server'):raise RuntimeError('Unowned native IOCP file target')
        result=b
        if not result:
         result=port_state['next'];port_state['next']+=1;port_state['ports'][result]={'concurrency':d&0xffffffff,'queue':[]}
        if ptr!=(1<<64)-1:port_state['associations'][ptr]=(result,c)
      elif name=='PostQueuedCompletionStatus':
       if ptr not in port_state['ports']:error=6
       else:port_state['ports'][ptr]['queue'].append({'bytes':b&0xffffffff,'key':c,'ov':d,'error':0});result=1
      else:
       port=port_state['ports'].get(ptr)
       if port is None:emu.mem_write(d,b'\0'*8);error=6
       elif not port['queue']:
        timeout=int.from_bytes(emu.mem_read(emu.reg_read(x.UC_X86_REG_RSP)+40,4),'little')
        if timeout:raise RuntimeError('Native IOCP wait requires a guest scheduler')
        emu.mem_write(d,b'\0'*8);error=258
       else:
        packet=port['queue'].pop(0);emu.mem_write(b,packet['bytes'].to_bytes(4,'little'));emu.mem_write(c,packet['key'].to_bytes(8,'little'));emu.mem_write(d,packet['ov'].to_bytes(8,'little'));error=packet['error'];result=0 if error else 1
      if error:emu.mem_write(tib+0x68,error.to_bytes(4,'little'))
      emu.reg_write(x.UC_X86_REG_RAX,result)
     elif name in ['InitializeConditionVariable','WakeConditionVariable']:
      if ptr%8:raise RuntimeError('Unaligned native condition variable')
      if name=='InitializeConditionVariable':emu.mem_write(ptr,b'\0'*8)
      elif int.from_bytes(emu.mem_read(ptr,8),'little'):raise RuntimeError('Native condition-variable waiter dispatch needs a scheduler')
     elif name in critical_names:
      if ptr%8:raise RuntimeError('Unaligned native critical section')
      entry=critical_state.get(ptr);result=None
      if name=='InitializeCriticalSection':
       if entry is not None:raise RuntimeError('Native critical section already initialized')
       entry={'owner':0,'recursion':0};critical_state[ptr]=entry
      else:
       if entry is None:raise RuntimeError('Uninitialized native critical section')
       if name=='DeleteCriticalSection':
        if entry['recursion']:raise RuntimeError('Delete owned native critical section')
        del critical_state[ptr];emu.mem_write(ptr,b'\0'*40)
       elif name=='LeaveCriticalSection':
        if entry['owner']!=current_id or not entry['recursion']:raise RuntimeError('Unowned native critical-section leave')
        entry['recursion']-=1
        if not entry['recursion']:entry['owner']=0
       else:
        if entry['owner'] not in [0,current_id]:raise RuntimeError('Native critical section needs a scheduler')
        entry['owner']=current_id;entry['recursion']+=1
        if name=='TryEnterCriticalSection':result=1
      if name!='DeleteCriticalSection':emu.mem_write(ptr,struct.pack('<QiIQQQ',(1<<64)-1,-2 if entry['recursion'] else -1,entry['recursion'],entry['owner'],0,0x20007d0))
      if result is not None:emu.reg_write(x.UC_X86_REG_RAX,result)
     elif name in pipe_services:
      result=0;error=0
      if name=='CreateNamedPipeW':
       raw=bytearray()
       for i in range(32768):
        ch=bytes(emu.mem_read(ptr+i*2,2))
        if ch==b'\0\0':break
        raw.extend(ch)
       else:raise RuntimeError('Unterminated native pipe name')
       path=raw.decode('utf-16le');mode=emu.reg_read(x.UC_X86_REG_RDX)&0xffffffff;kind=emu.reg_read(x.UC_X86_REG_R8)&0xffffffff;instances=emu.reg_read(x.UC_X86_REG_R9)&0xffffffff;rsp=emu.reg_read(x.UC_X86_REG_RSP)
       tail=[int.from_bytes(emu.mem_read(rsp+offset,n),'little') for offset,n in [(40,4),(48,4),(56,4),(64,8)]]
       if not path.lower().startswith('\\\\.\\pipe\\') or mode!=0x40000001 or kind!=8 or instances!=1 or tail!=[0,1024,0,0]:raise RuntimeError('Unsupported native pipe configuration')
       key=path.lower()
       if key in pipe_state['byName']:result=(1<<64)-1;error=231
       else:
        result=pipe_state['nextHandle'];pipe_state['nextHandle']+=1
        item={'name':path,'server':result,'clients':[],'queued':bytearray(),'closed':False,'everConnected':False}
        pipe_state['pipes'].append(item);pipe_state['byName'][key]=item;pipe_state['ends'][result]=(item,'server')
      elif name=='freopen_s':
       def ascii_z(pointer):
        raw=bytearray()
        for i in range(32768):
         ch=bytes(emu.mem_read(pointer+i,1))
         if ch==b'\0':return raw.decode('ascii')
         raw.extend(ch)
        raise RuntimeError('Unterminated native CRT pipe string')
       path=ascii_z(emu.reg_read(x.UC_X86_REG_RDX));mode=ascii_z(emu.reg_read(x.UC_X86_REG_R8));stream=emu.reg_read(x.UC_X86_REG_R9)
       if stream not in stdio_state['streams'] or mode not in ['w','wb','wt']:raise RuntimeError('Unsupported native pipe reopen')
       fd=stdio_state['streams'][stream];item=pipe_state['byName'].get(path.lower())
       if item and (item['everConnected'] or item['closed']):raise RuntimeError('Native pipe reconnect needs explicit support')
       stdio_state['fds'].pop(fd,None)
       if item:
        handle=pipe_state['nextHandle'];pipe_state['nextHandle']+=1;item['clients'].append(handle);item['everConnected']=True;pipe_state['ends'][handle]=(item,'client')
        stdio_state['fds'][fd]={'channel':2 if fd==2 else 1,'handle':handle,'pipe':path.lower(),'text':'b' not in mode};emu.mem_write(ptr,stream.to_bytes(8,'little'));result=0
       else:
        del stdio_state['streams'][stream];emu.mem_write(ptr,b'\0'*8);result=2
      else:raise RuntimeError('Reached pipe operation needs native fixture extension: '+name)
      if error:emu.mem_write(tib+0x68,error.to_bytes(4,'little'))
      emu.reg_write(x.UC_X86_REG_RAX,result)
     elif name in stdio:
      if not stdio_state['base']:
       stdio_state['base']=allocate(3*88,True)
       for fd in range(3):
        stdio_state['streams'][stdio_state['base']+fd*88]=fd
        stdio_state['fds'][fd]={'channel':fd,'handle':0x61000000+fd}
      if name=='__acrt_iob_func':
       index=ptr&0xffffffff
       if index>2:raise RuntimeError('Unsupported native stdio index')
       result=stdio_state['base']+index*88
      elif name=='_fileno':
       if ptr not in stdio_state['streams']:raise RuntimeError('Unowned native FILE identity')
       result=stdio_state['streams'][ptr]
      else:
       fd=ptr&0xffffffff;fd=fd-(1<<32) if fd>>31 else fd;entry=stdio_state['fds'].get(fd)
       if entry is None:result=0 if name=='_fdopen' else (1<<64)-1 if name=='_get_osfhandle' else 0xffffffff
       elif name=='_dup':
        next_fd=3
        while next_fd in stdio_state['fds']:next_fd+=1
        stdio_state['fds'][next_fd]={'channel':entry['channel'],'handle':stdio_state['nextHandle']};stdio_state['nextHandle']+=1;result=next_fd
       elif name=='_get_osfhandle':result=entry['handle']
       elif name=='_close':del stdio_state['fds'][fd];result=0
       else:
        pointer=emu.reg_read(x.UC_X86_REG_RDX);mode=bytes(emu.mem_read(pointer,4)).split(b'\0',1)[0]
        if mode not in [b'w',b'wb',b'wt']:raise RuntimeError('Unsupported native fdopen mode')
        result=allocate(88,True);stdio_state['streams'][result]=fd
      emu.reg_write(x.UC_X86_REG_RAX,result)
     elif name in console:
      result=0;error=0
      if name=='GetStdHandle':
       if ptr&0xffffffff not in [0xfffffff6,0xfffffff5,0xfffffff4]:result=(1<<64)-1;error=6
      else:
       if name=='AttachConsole' and ptr&0xffffffff!=0xffffffff:raise RuntimeError('Unsupported native console attach target')
       error=6
      if error:emu.mem_write(tib+0x68,error.to_bytes(4,'little'))
      emu.reg_write(x.UC_X86_REG_RAX,result)
     elif name=='RaiseException':
      flags=emu.reg_read(x.UC_X86_REG_RDX)&0xffffffff;count=emu.reg_read(x.UC_X86_REG_R8)&0xffffffff;args=emu.reg_read(x.UC_X86_REG_R9)
      if ptr&0xffffffff!=0x406d1388 or flags or count!=3:raise RuntimeError('Unsupported native fixture exception')
      kind,pointer,tid,reserved=struct.unpack('<I4xQII',bytes(emu.mem_read(args,24)))
      if kind!=0x1000 or tid not in [current_id,0xffffffff] or reserved:raise RuntimeError('Unsupported native thread-name event')
      raw=bytearray()
      for i in range(4096):
       char=bytes(emu.mem_read(pointer+i,1))
       if char==b'\0':break
       raw.extend(char)
      else:raise RuntimeError('Unterminated native thread name')
      thread_names[current_id]=raw.decode('ascii')
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
     elif name=='powf':
      bits=emu.reg_read(x.UC_X86_REG_XMM0);a=struct.unpack('<f',(bits&0xffffffff).to_bytes(4,'little'))[0];b=struct.unpack('<f',(emu.reg_read(x.UC_X86_REG_XMM1)&0xffffffff).to_bytes(4,'little'))[0]
      if not(math.isfinite(a) and math.isfinite(b) and a>0):raise RuntimeError('Unsupported native powf domain')
      result=struct.unpack('<f',struct.pack('<f',math.pow(a,b)))[0]
      if not math.isfinite(result) or result==0:raise RuntimeError('Unsupported native powf range')
      if image_base==0x2000000 and variant==0:print(json.dumps({'powfReference':{'a':a,'b':b,'result':result}}),flush=True)
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
    if variant>=4 and rva==entry_rva+division_length:
     boundary.update(rva=rva,service='Unsigned-division fixture stop');emu.emu_stop();return
    if variant==2 and rva==0x12df21:
     boundary.update(rva=rva,service='SIMD fixture stop');emu.emu_stop();return
    if variant==3 and rva==sar_fixture[0][0]+sar_fixture[0][1]:
     boundary.update(rva=rva,service='Signed-shift fixture stop');emu.emu_stop();return
    b=bytes(emu.mem_read(address,min(16,size-rva)))
    if 0x40<=b[0]<=0x4f and b[1]==0x8b and b[2]&0xc7==5:
     slot=rva+7+int.from_bytes(b[3:7],'little',signed=True)
     if slot in imports and not bound(imports[slot]):
      boundary.update(rva=rva,service=imports[slot],iatRva=slot,kind='import-address-read');emu.emu_stop();return
    if b[:2] in [b'\xff\x15',b'\xff\x25']:
     slot=rva+6+int.from_bytes(b[2:6],'little',signed=True)
     if slot in imports and (not bound(imports[slot]) or imports[slot] in external):
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
      if imports[slot].endswith('!MessageBoxW'):
       def wide_text(pointer):
        raw=bytearray()
        for i in range(32768):
         char=bytes(emu.mem_read(pointer+i*2,2))
         if char==b'\0\0':return raw.decode('utf-16le')
         raw.extend(char)
        raise RuntimeError('Unterminated guest dialog text')
       boundary['dialog']={'text':wide_text(emu.reg_read(x.UC_X86_REG_RDX)),'caption':wide_text(emu.reg_read(x.UC_X86_REG_R8))}
      if imports[slot].endswith('!RaiseException'):
       boundary['exception']={'code':hex(emu.reg_read(x.UC_X86_REG_RCX)&0xffffffff),'flags':emu.reg_read(x.UC_X86_REG_RDX)&0xffffffff,'argumentCount':emu.reg_read(x.UC_X86_REG_R8)&0xffffffff}
      if imports[slot].endswith('!CreateNamedPipeW'):
       pointer=emu.reg_read(x.UC_X86_REG_RCX);raw=bytearray()
       for i in range(32768):
        char=bytes(emu.mem_read(pointer+i*2,2))
        if char==b'\0\0':break
        raw.extend(char)
       else:raise RuntimeError('Unterminated pipe name')
       rsp=emu.reg_read(x.UC_X86_REG_RSP)
       boundary['pipeRequest']={'path':raw.decode('utf-16le'),'openMode':emu.reg_read(x.UC_X86_REG_RDX)&0xffffffff,'pipeMode':emu.reg_read(x.UC_X86_REG_R8)&0xffffffff,'maxInstances':emu.reg_read(x.UC_X86_REG_R9)&0xffffffff,
        'outBufferSize':int.from_bytes(emu.mem_read(rsp+32,4),'little'),'inBufferSize':int.from_bytes(emu.mem_read(rsp+40,4),'little'),'defaultTimeout':int.from_bytes(emu.mem_read(rsp+48,4),'little'),'security':hex(int.from_bytes(emu.mem_read(rsp+56,8),'little'))}
      emu.emu_stop();return
    instruction=str(ctx.disassemble(pe.get_data(rva,16),base_address=preferred+rva,max_instructions=1).instructions[0])
    mnemonic=instruction.split(': ',1)[1].split(' ',1)[0]
    if mnemonic=='SAR' and 'R9' in instruction and sar_fixture[0] is None:sar_fixture[0]=(rva,n)
    if mnemonic=='DIV':defined_flags[0]=0
    elif mnemonic in ['ADD','SUB','CMP','ADC','SBB','NEG']:defined_flags[0]=0x8d5
    elif mnemonic in ['INC','DEC']:defined_flags[0]=(defined_flags[0]&1)|0x8d4
    elif mnemonic in ['TEST','AND','OR','XOR']:defined_flags[0]=0x8c5
    elif mnemonic in ['SHL','SHR','SAR','SHLD','SHRD']:defined_flags[0]&=~0x810
    elif mnemonic in ['MUL','IMUL']:defined_flags[0]&=0x801
    trace.append(rva);observed.add(rva)
    if len(trace)>50000:raise RuntimeError('Native path step limit')
   uc.hook_add(unicorn.UC_HOOK_CODE,hook)
   try:uc.emu_start(image_base+entry_rva,0,count=50001)
   except unicorn.UcError as error:
    if division_fault:
     assert error.errno==unicorn.UC_ERR_EXCEPTION and uc.reg_read(x.UC_X86_REG_RIP)==image_base+entry_rva
     boundary.update(rva=entry_rva,service='Unsigned-division fault fixture',kind='division-error');trace=[];defined_flags[0]=0x8d5
    else:
     fault=uc.reg_read(x.UC_X86_REG_RIP)
     recent=[str(ctx.disassemble(bytes(uc.mem_read(image_base+i,16)),base_address=preferred+i,max_instructions=1).instructions[0]) for i in trace[-6:]]
     raise RuntimeError(f'Native path fault at {fault:#x}; recent {recent}: {error}') from error
   if division_fault and not boundary:raise RuntimeError('Expected native division exception missing')
   if import_snapshot:
    for reg,value in import_snapshot:uc.reg_write(reg,value)
    if trace and trace[-1]==boundary['rva']:trace.pop()
   if not boundary:raise RuntimeError('No explicit service boundary found')
   assert bytes(uc.mem_read(game_headers['base'],4096))==header_bytes,'Unexpected primary game header mutation'
   assert bytes(uc.mem_read(cocos['pageBase'],4096))==cocos_page,'Unexpected Cocos code mutation'
   print(json.dumps({'nativeBoundary':boundary,'steps':len(trace),'imageBase':hex(image_base)}),flush=True)
   if image_base==0x2000000 and variant==0:
    print(json.dumps({'callbackInstructions':[str(ctx.disassemble(pe.get_data(rva,16),base_address=preferred+rva,max_instructions=1).instructions[0]) for rva in dict.fromkeys(trace) if 0x12f200<=rva<0x12f400]}),flush=True)
   # Store only changed DLL bytes; pointers in the reference are base-specific.
   final=bytes(uc.mem_read(image_base,size));changes=[];at=0
   while at<size:
    if final[at]==image[at]:at+=1;continue
    start=at
    while at<size and final[at]!=image[at]:at+=1
    changes.append({'rva':start,'hex':final[start:at].hex()})
   cases.append({'instructionLength':division_length if variant>=4 else None,'expectedFault':5 if division_fault else None,'imageBase':image_base,'entryRva':entry_rva,'initialTimestamp':initial_timestamp,'initial':[hex(v) for v in values],'initialXmm':[hex(v) for v in xmm],'flags':flags,
     'expected':[hex(uc.reg_read(getattr(x,'UC_X86_REG_'+r))) for r in REGS],
     'expectedXmm':[hex(uc.reg_read(getattr(x,'UC_X86_REG_XMM'+str(i)))) for i in range(16)],
     'expectedFlags':uc.reg_read(x.UC_X86_REG_EFLAGS),'definedFlagsMask':defined_flags[0],'stopRva':boundary['rva'],'steps':len(trace),
     'stackBase':stack_base,'stackHex':bytes(uc.mem_read(stack_base,stack_size)).hex(),'dllChanges':changes,
     'tib':tib,'tlsArray':tls_array,'tlsData':tls_data,'tlsHex':bytes(uc.mem_read(tls_data,tls_size+tls.SizeOfZeroFill)).hex(),
     'serviceCalls':service_calls,'stackBelow':sp-min([a for a,b in writes]+[sp]),'stackAbove':max([b for a,b in writes]+[sp])-sp,
     'heapHex':bytes(uc.mem_read(0x1800000,heap_at[0]-0x1800000)).hex() if heap_at[0]>0x1800000 else '',
     'performanceClock':{'frequency':'10000000','counterReads':clock_reads[0],'lastCounter':str(clock_value[0]) if clock_reads[0] else None},'exceptionState':[str(p) for p in sorted(exception_state)],'onexitCallbacks':[str(callback) for table in onexit.values() for callback in table['callbacks']],'threadNames':list(thread_names.items()),
     'stdioState':{'streams':[[str(p),fd] for p,fd in stdio_state['streams'].items()],'fds':[[fd,d['channel'],str(d['handle'])] for fd,d in stdio_state['fds'].items()]},
     'pipeState':{'pipes':[{'name':p['name'],'server':str(p['server']),'clients':[str(h) for h in p['clients']],'queuedHex':p['queued'].hex(),'closed':p['closed'],'everConnected':p['everConnected']} for p in pipe_state['pipes']],'completions':pipe_state['completions'],'outputs':pipe_state['outputs']},'criticalState':[[p,e['owner'],e['recursion']] for p,e in critical_state.items()],
     'iocpState':{'ports':[{'handle':str(h),'concurrency':p['concurrency'],'queue':[{'bytes':q['bytes'],'key':str(q['key']),'ov':str(q['ov']),'error':q['error']} for q in p['queue']]} for h,p in port_state['ports'].items()],'associations':[[str(h),str(a[0]),str(a[1])] for h,a in port_state['associations'].items()]}})
   boundaries.append(boundary)
   if variant==0:
    # Execute the actual requested callback under the explicit static-TLS model.
    # The parent remains stopped; no _beginthreadex return/handle is fabricated.
    request=boundary['threadRequest'];worker_entry=int(request['entryAddress'],16);worker_argument=int(request['argument'],16)
    worker_cpu=allocate(4096,True);tib=allocate(0x4000,True);stack_base=allocate(65536,True);stack_size=65536;sp=((stack_base+stack_size-64)//16)*16-8
    current_id=2;worker_mode=True;tls_array=tib+0x1000;tls_data=tib+0x2000
    for offset,value in [(8,stack_base+stack_size),(16,stack_base),(0x30,tib),(0x40,1),(0x48,current_id),(0x58,tls_array)]:uc.mem_write(tib+offset,value.to_bytes(8,'little'))
    uc.mem_write(tls_array,tls_data.to_bytes(8,'little'));uc.mem_write(tls_data,bytes(image[tls_rva:tls_rva+tls_size]));uc.mem_write(sp,(0x120ff0).to_bytes(8,'little'))
    values=[0]*16;values[1]=worker_argument;values[4]=sp
    for reg,value in zip(REGS,values):uc.reg_write(getattr(x,'UC_X86_REG_'+reg),value)
    for i in range(16):uc.reg_write(getattr(x,'UC_X86_REG_XMM'+str(i)),0)
    uc.reg_write(x.UC_X86_REG_GS_BASE,tib);uc.reg_write(x.UC_X86_REG_EFLAGS,2)
    trace=[];boundary={};import_snapshot=[];service_calls=[];writes=[];defined_flags=[0x8d5]
    uc.emu_start(worker_entry,0,count=50001)
    if import_snapshot:
     for reg,value in import_snapshot:uc.reg_write(reg,value)
     if trace and trace[-1]==boundary['rva']:trace.pop()
    if not boundary:raise RuntimeError('Worker has no explicit boundary')
    expected=[uc.reg_read(getattr(x,'UC_X86_REG_'+r)) for r in REGS];expected_xmm=[uc.reg_read(getattr(x,'UC_X86_REG_XMM'+str(i))) for i in range(16)];expected_flags=uc.reg_read(x.UC_X86_REG_EFLAGS)
    # Materialize the independent oracle's CPU shadow for heap comparison.
    for i,value in enumerate(expected):uc.mem_write(worker_cpu+i*8,value.to_bytes(8,'little'))
    uc.mem_write(worker_cpu+192,uc.reg_read(x.UC_X86_REG_RIP).to_bytes(8,'little'));uc.mem_write(worker_cpu+2328,tib.to_bytes(8,'little'))
    for i,value in enumerate(expected_xmm):uc.mem_write(worker_cpu+512+i*16,value.to_bytes(16,'little'))
    for bit in [0,2,4,6,7,11]:uc.mem_write(worker_cpu+2560+bit,bytes([(expected_flags>>bit)&1]))
    final=bytes(uc.mem_read(image_base,size));changes=[];at=0
    while at<size:
     if final[at]==image[at]:at+=1;continue
     start=at
     while at<size and final[at]!=image[at]:at+=1
     changes.append({'rva':start,'hex':final[start:at].hex()})
    cases[-1]['worker']={'id':2,'cpu':worker_cpu,'tib':tib,'stack':stack_base,'entryRva':worker_entry-image_base,'argument':hex(worker_argument),'returnAddress':'0x120ff0','boundary':boundary,'steps':len(trace),'expected':[hex(n) for n in expected],'expectedXmm':[hex(n) for n in expected_xmm],'expectedFlags':expected_flags,'definedFlagsMask':defined_flags[0],'dllChanges':changes,'heapHex':bytes(uc.mem_read(0x1800000,heap_at[0]-0x1800000)).hex(),'serviceCalls':service_calls,'threadNames':list(thread_names.items()),'criticalState':[[p,e['owner'],e['recursion']] for p,e in critical_state.items()],'performanceClock':{'frequency':'10000000','counterReads':clock_reads[0],'lastCounter':str(clock_value[0]) if clock_reads[0] else None},'exceptionState':[str(p) for p in sorted(exception_state)]}
    print(json.dumps({'workerBoundary':boundary,'steps':len(trace),'imageBase':hex(image_base)}),flush=True)
 lifter=WideLifter(pe)
 for rva in sorted(observed):lifter.add(preferred+rva)
 source=lifter.source();(out/'deferred.c').write_text(source)
 manifest={'performanceClock':{'frequency':10000000,'initial':1000000000,'increment':10000},'dllSha256':PIN,'entryRva':0x12f200,'boundaries':boundaries,'uniqueInstructions':len(observed),'gameHeaders':game_headers,'cocos':cocos,'bootstrap':{'timestampRva':timestamp_rva,'gameTimestamp':game_timestamp},
  'instructions':[{'rva':va-preferred,'length':ins.length,'assembly':str(ins)} for va,(ins,_,_) in sorted(lifter.blocks.items())],
  'cases':cases,'gsOffset':2048+ctx.registers['GS_OFFSET'].offset,'onexitTables':[0xfb1960],
  'tls':{'templateRva':tls_rva,'templateSize':tls_size,'zeroFill':tls.SizeOfZeroFill,'indexRva':tls.AddressOfIndex-preferred,'callbacksExecuted':False},
  'generatedCsha256':hashlib.sha256(source.encode()).hexdigest(),'fullGeodeLoader':False}
 (out/'manifest.json').write_text(json.dumps(manifest,indent=2))
 print(json.dumps({k:v for k,v in manifest.items() if k not in ['instructions','cases']},indent=2))
if __name__=='__main__':main()
