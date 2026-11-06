#!/usr/bin/env python3
"""Bounded x64 PE -> SLEIGH p-code -> C translator. Not a general DLL loader.

Fails on unsupported instructions/IR. No Geode C++ source is used as input.
"""
import argparse, collections, hashlib, json, re
from pathlib import Path
import pefile, pypcode

PIN = 'ccedc2f1c86baf342f6720b9685991ca31fba246453efe2a1daf609dc40b6499'
ROOTS = ['getAddress', 'isEnabled', 'getAutoEnable', 'setAutoEnable', 'getPriority']
REGS = ['RAX','RCX','RDX','RBX','RSP','RBP','RSI','RDI','R8','R9','R10','R11','R12','R13','R14','R15']

class LiftError(Exception): pass

class Lifter:
    def __init__(self, pe, limit, allow_indirect=False, yield_unknown=False, single_threaded=False, wide_mode=False):
        self.pe, self.limit = pe, limit
        self.allow_indirect, self.yield_unknown = allow_indirect, yield_unknown
        self.single_threaded=single_threaded
        self.wide_mode=wide_mode
        self.base = pe.OPTIONAL_HEADER.ImageBase
        self.allowed_images=[(self.base,self.base+pe.OPTIONAL_HEADER.SizeOfImage)]
        self.ctx = pypcode.Context('x86:LE:64:default')
        self.reg_roots = [(self.ctx.registers[n].offset, i*8, 8) for i,n in enumerate(REGS)]
        self.reg_roots.append((self.ctx.registers['RIP'].offset, 192, 8))
        self.reg_roots.append((self.ctx.registers['MXCSR'].offset,1536,4))
        self.blocks = {}
        self.instruction_overrides = {}
        self.opcodes = collections.Counter()
        self.reg_roots.append((self.ctx.registers['GS_OFFSET'].offset,128,8))
        self.reg_roots += [(self.ctx.registers[f'XMM{i}'].offset,256+i*16,16) for i in range(16)]
        self.unique_groups={}
        self.current_instruction=None
    def prepare_uniques(self,ops):
        intervals=sorted({(v.offset,v.offset+v.size) for op in ops for v in ([op.output] if op.output else [])+list(op.inputs) if v.space.name=='unique'})
        groups=[]
        for start,end in intervals:
            if groups and start<groups[-1][1]:groups[-1]=(groups[-1][0],max(end,groups[-1][1]))
            else:groups.append((start,end))
        if any(end-start>(16 if self.wide_mode else 8) for start,end in groups):raise LiftError('Unique overlap group wider than configured word size')
        self.unique_groups={start:(lo,(start-lo)*8) for start,end in intervals for lo,hi in groups if lo<=start and end<=hi}
        return sorted({lo for lo,shift in self.unique_groups.values()})
    def reg_offset(self, v):
        for source, target, size in self.reg_roots:
            if source <= v.offset and v.offset+v.size <= source+size:
                return target+v.offset-source
        # Additional SLEIGH flags/state live in this experiment's CPU shadow.
        # No claim is made that the game's complete SIMD/TLS layout is mapped.
        if v.offset < 1024: return 2048+v.offset
        raise LiftError(f'Unmapped register {v}')
    def expr(self, v):
        if v.size > (16 if self.wide_mode else 8): raise LiftError(f'IR value wider than configured word size: {v}')
        if v.space.name == 'const': return f'((wide_t)UINT64_C({v.offset}))'
        if v.space.name == 'register': return f'raw_read(cpu+{self.reg_offset(v)}u,{v.size}u)'
        if v.space.name == 'unique':
            base,shift=self.unique_groups.get(v.offset,(v.offset,0))
            return f'((u_{base:x}>>{shift}u)&mask({v.size}u))'
        if v.space.name == 'ram':
            if not any(start<=v.offset and v.offset+v.size<=end for start,end in self.allowed_images):
                raise LiftError(f'Absolute memory reference outside image: {v}')
            return f'guest_read(image_base+UINT64_C({v.offset-self.base}),{v.size}u,guest_base)'
        raise LiftError(f'Unsupported input space {v.space.name}')
    def assign(self, v, expression):
        if v.size > (16 if self.wide_mode else 8): raise LiftError(f'IR result wider than configured word size: {v}')
        if v.space.name == 'register': return f'raw_write(cpu+{self.reg_offset(v)}u,({expression}),{v.size}u);'
        if v.space.name == 'unique':
            base,shift=self.unique_groups.get(v.offset,(v.offset,0))
            return f'u_{base:x}=(u_{base:x}&~(mask({v.size}u)<<{shift}u))|((({expression})&mask({v.size}u))<<{shift}u);'
        if v.space.name == 'ram':
            if not any(start<=v.offset and v.offset+v.size<=end for start,end in self.allowed_images):
                raise LiftError(f'Absolute memory write outside image: {v}')
            return f'guest_write(image_base+UINT64_C({v.offset-self.base}),({expression}),{v.size}u,guest_base);'
        raise LiftError(f'Unsupported output space {v.space.name}')
    def emit_op(self, op, index, count):
        code, a = op.opcode.name, op.inputs
        self.opcodes[code] += 1
        x = [self.expr(v) for v in a] if code not in ['IMARK','LOAD','STORE','BRANCH','CBRANCH','CALL','RETURN'] else []
        if code == 'IMARK': return ''
        if code=='CALLOTHER' and self.single_threaded and str(op) in ['LOCK()','UNLOCK()']:
            return '/* Serialized single-thread guest: complete the following atomic instruction without yielding. */'
        if code in ['CALLIND','BRANCHIND'] and self.allow_indirect:
            return f'raw_write(cpu+192u,{self.expr(a[0])},8u); goto next_instruction;'
        if code == 'COPY': e=x[0]
        elif code == 'LOAD':
            if '*[ram]' not in str(op): raise LiftError('Non-ram LOAD')
            e=f'guest_read({self.expr(a[1])},{op.output.size}u,guest_base)'
        elif code == 'STORE':
            if '*[ram]' not in str(op): raise LiftError('Non-ram STORE')
            return f'guest_write({self.expr(a[1])},{self.expr(a[2])},{a[2].size}u,guest_base);'
        elif code in ['BRANCH','CBRANCH','CALL']:
            target=a[0]
            cond=f'if({self.expr(a[1])}) ' if code=='CBRANCH' else ''
            if target.space.name=='ram':
                rva=target.offset-self.base
                return cond+f'{{ raw_write(cpu+192u,image_base+UINT64_C({rva}),8u); goto next_instruction; }}'
            if target.space.name=='const' and code!='CALL':
                delta=target.offset
                bits=target.size*8
                if delta >= 1 << (bits-1): delta-=1<<bits
                to=index+delta
                if not 0<=to<=count: raise LiftError('Out-of-range internal p-code branch')
                return cond+f'goto op_{to};'
            raise LiftError(f'Unsupported branch target {target}')
        elif code=='RETURN': return f'raw_write(cpu+192u,{self.expr(a[0])},8u); goto next_instruction;'
        elif code=='FLOAT_NAN':
            if a[0].size not in [4,8]:raise LiftError('Unsupported float predicate width')
            e=f'(!finite_compare({x[0]},{x[0]},{a[0].size}u,2u,cpu,image_base+UINT64_C({self.current_instruction.addr.offset-self.base})))'
        elif code=='FLOAT_DIV':
            if a[0].size!=4 or a[1].size!=4 or op.output.size!=4:raise LiftError('Only bounded binary32 division is implemented')
            e=f'finite_divide32({x[0]},{x[1]},cpu,image_base+UINT64_C({self.current_instruction.addr.offset-self.base}))'
        elif code=='FLOAT_INT2FLOAT':
            if a[0].size not in [4,8] or op.output.size not in [4,8]:raise LiftError('Unsupported int-to-float width')
            e=f'int_to_ieee({x[0]},{a[0].size}u,{op.output.size}u,cpu,image_base+UINT64_C({self.current_instruction.addr.offset-self.base}))'
        elif code in ['FLOAT_LESS','FLOAT_LESSEQUAL','FLOAT_EQUAL','FLOAT_NOTEQUAL']:
            if a[0].size not in [4,8] or a[1].size!=a[0].size:raise LiftError('Unsupported float comparison width')
            predicate={'FLOAT_LESS':0,'FLOAT_LESSEQUAL':1,'FLOAT_EQUAL':2,'FLOAT_NOTEQUAL':3}[code]
            e=f'finite_compare({x[0]},{x[1]},{a[0].size}u,{predicate}u,cpu,image_base+UINT64_C({self.current_instruction.addr.offset-self.base}))'
        elif code in ['INT_ZEXT','CAST']: e=x[0]
        elif code=='INT_SEXT': e=f'sext({x[0]},{a[0].size}u)'
        elif code in ['INT_ADD','INT_SUB','INT_MULT','INT_AND','INT_OR','INT_XOR']:
            operator={'INT_ADD':'+','INT_SUB':'-','INT_MULT':'*','INT_AND':'&','INT_OR':'|','INT_XOR':'^'}[code]
            e=f'({x[0]} {operator} {x[1]})'
        elif code in ['INT_DIV','INT_REM','INT_SDIV','INT_SREM']:
            signed=code in ['INT_SDIV','INT_SREM'];remainder=code in ['INT_REM','INT_SREM']
            fail='raw_write(cpu+192u,pc,8u);lift_fault(5u,pc,pc);__builtin_trap();'
            lines=['{',f'if(!{x[1]}){{{fail}}}']
            if signed:
                left=f'(__int128)(signed_wide_t)sext({x[0]},{a[0].size}u)';right=f'(__int128)(signed_wide_t)sext({x[1]},{a[1].size}u)'
                lines.append(f'if((unsigned __int128)({left})==((unsigned __int128)1<<127u)&&({right})==-1){{{fail}}}')
                lines.append(f'__int128 quotient=({left})/({right});')
            else:lines.append(f'wide_t quotient={x[0]}/{x[1]};')
            if self.current_instruction and self.current_instruction.mnem in ['DIV','IDIV']:
                bits=op.output.size*4
                condition=f'quotient<-((__int128)1<<{bits-1}u)||quotient>(((__int128)1<<{bits-1}u)-1)' if signed else f'quotient>mask({op.output.size//2}u)'
                lines.append(f'if({condition}){{{fail}}}')
            expression=f'({left})%({right})' if signed and remainder else f'{x[0]}%{x[1]}' if remainder else 'quotient'
            lines += [self.assign(op.output,expression),'}']
            return '\n'.join(lines)
        elif code=='INT_LEFT': e=f'({x[1]}>={a[0].size*8}u?0:({x[0]}<<{x[1]}))'
        elif code=='INT_RIGHT': e=f'({x[1]}>={a[0].size*8}u?0:({x[0]}>>{x[1]}))'
        elif code=='INT_SRIGHT': e=f'({x[1]}>={a[0].size*8}u?(((signed_wide_t)sext({x[0]},{a[0].size}u)<0)?mask({a[0].size}u):0):(wide_t)((signed_wide_t)sext({x[0]},{a[0].size}u)>>{x[1]}))'
        elif code=='INT_NEGATE': e=f'~{x[0]}'
        elif code=='INT_2COMP': e=f'(UINT64_C(0)-{x[0]})'
        elif code in ['INT_EQUAL','INT_NOTEQUAL','INT_LESS','INT_LESSEQUAL']:
            operator={'INT_EQUAL':'==','INT_NOTEQUAL':'!=','INT_LESS':'<','INT_LESSEQUAL':'<='}[code]
            e=f'({x[0]} {operator} {x[1]})'
        elif code in ['INT_SLESS','INT_SLESSEQUAL']:
            operator='<' if code=='INT_SLESS' else '<='
            e=f'((signed_wide_t)sext({x[0]},{a[0].size}u) {operator} (signed_wide_t)sext({x[1]},{a[1].size}u))'
        elif code=='INT_CARRY': e=f'(({x[0]}+{x[1]})&mask({a[0].size}u))<{x[0]}'
        elif code=='INT_SCARRY': e=f'((~({x[0]}^{x[1]})&({x[0]}^({x[0]}+{x[1]})))>>{a[0].size*8-1})&1u'
        elif code=='INT_SBORROW': e=f'((({x[0]}^{x[1]})&({x[0]}^({x[0]}-{x[1]})))>>{a[0].size*8-1})&1u'
        elif code=='BOOL_NEGATE': e=f'!{x[0]}'
        elif code in ['BOOL_AND','BOOL_OR','BOOL_XOR']:
            operator={'BOOL_AND':'&','BOOL_OR':'|','BOOL_XOR':'^'}[code]; e=f'((!!{x[0]}){operator}(!!{x[1]}))'
        elif code=='POPCOUNT': e=f'(__builtin_popcountll((uint64_t){x[0]})+__builtin_popcountll((uint64_t)({x[0]}>>64u)))' if self.wide_mode else f'__builtin_popcountll({x[0]})'
        elif code=='SUBPIECE': e=f'({x[0]}>>({x[1]}*8u))'
        elif code=='PIECE':
            if sum(v.size for v in a)>16: raise LiftError('PIECE wider than 128 bits')
            e=f'({x[0]}<<{a[1].size*8})|{x[1]}'
        else: raise LiftError(f'Unsupported p-code {code}: {op}')
        return self.assign(op.output,e)
    def discover(self, roots):
        queue=list(roots)
        while queue:
            va=queue.pop()
            if va in self.blocks: continue
            if len(self.blocks)>=self.limit: raise LiftError(f'Instruction discovery limit {self.limit} reached at {va:#x}')
            section=self.pe.get_section_by_rva(va-self.base)
            if not section or not section.Characteristics & 0x20000000:
                raise LiftError(f'Branch leaves executable image at {va:#x}')
            data=self.pe.get_data(va-self.base,32)
            instruction=self.ctx.disassemble(data,base_address=va,max_instructions=1).instructions[0]
            self.current_instruction=instruction
            ops=self.ctx.translate(data[:instruction.length],base_address=va,max_instructions=1).ops
            self.prepare_uniques(ops)
            emitted=[]
            for i,op in enumerate(ops):
                try: emitted.append(self.emit_op(op,i,len(ops)))
                except LiftError as error: raise LiftError(f'{error}; instruction {instruction}; operation {op}') from error
            self.blocks[va]=(instruction,ops,emitted)
            terminal=False
            for op in ops:
                if op.opcode.name in ['BRANCH','CBRANCH','CALL'] and op.inputs[0].space.name=='ram':
                    queue.append(op.inputs[0].offset)
                if op.opcode.name in ['BRANCH','RETURN','BRANCHIND'] and (op.opcode.name in ['RETURN','BRANCHIND'] or op.inputs[0].space.name=='ram'): terminal=True
            if not terminal: queue.append(va+instruction.length)
    def source(self):
        cases=[]
        for va,(ins,ops,emitted) in sorted(self.blocks.items()):
            unique=self.prepare_uniques(ops)
            lines=[f'case UINT64_C({va-self.base}): {{ /* {ins} */']
            lines += [f'wide_t u_{n:x}=0;' for n in unique]
            lines += [f'raw_write(cpu+192u,image_base+UINT64_C({va-self.base+ins.length}),8u);']
            if va in self.instruction_overrides:
                lines += [self.instruction_overrides[va], 'goto next_instruction; }']
                cases.append('\n'.join(lines));continue
            for i,line in enumerate(emitted):
                line=re.sub(r'\bop_(\d+)\b',lambda m:f'pc_{va:x}_op_{m[1]}',line)
                lines += [f'pc_{va:x}_op_{i}: ; '+line]
            lines += [f'pc_{va:x}_op_{len(ops)}: ; goto next_instruction; }}']
            cases.append('\n'.join(lines))
        default='return 0x80000000u|step;' if self.yield_unknown else 'lift_fault(1u,pc,pc); __builtin_trap();'
        prelude=PRELUDE if self.wide_mode else PRELUDE.replace('typedef unsigned __int128 wide_t;','typedef uint64_t wide_t;').replace('typedef __int128 signed_wide_t;','typedef int64_t signed_wide_t;')
        return prelude+'\n'.join(cases)+'\n default: '+default+'''
      }
      next_instruction: ;
    }
    lift_fault(4u,raw_read(cpu+192u,8u),entry); __builtin_trap();
}
'''

PRELUDE='''/* Generated from the pinned Windows DLL's instruction semantics. */
#include <stdint.h>
typedef unsigned __int128 wide_t;
typedef __int128 signed_wide_t;
__attribute__((import_module("env"),import_name("lift_fault")))
void lift_fault(uint32_t code,uint64_t address,uint64_t pc);
static inline wide_t mask(uint32_t n) {return n==sizeof(wide_t)?~(wide_t)0:(((wide_t)1<<(n*8u))-1u);}
static inline wide_t sext(wide_t v,uint32_t n) {uint32_t s=sizeof(wide_t)*8u-n*8u;return (wide_t)((signed_wide_t)(v<<s)>>s);}
static inline wide_t raw_read(uint64_t p,uint32_t n) {
  if(p+n>(uint64_t)__builtin_wasm_memory_size(0)*65536u){lift_fault(2u,p,0);__builtin_trap();}
  wide_t v=0;for(uint32_t i=0;i<n;i++)v|=(wide_t)(*(uint8_t*)(uintptr_t)(p+i))<<(i*8u);return v;
}
static inline void raw_write(uint64_t p,wide_t v,uint32_t n) {
  if(p+n>(uint64_t)__builtin_wasm_memory_size(0)*65536u){lift_fault(2u,p,0);__builtin_trap();}
  for(uint32_t i=0;i<n;i++)*(uint8_t*)(uintptr_t)(p+i)=(uint8_t)(v>>(i*8u));
}
static inline wide_t guest_read(uint64_t p,uint32_t n,uint32_t base) {
  if(p>UINT32_MAX){lift_fault(3u,p,0);__builtin_trap();}return raw_read(p+base,n);
}
static inline void guest_write(uint64_t p,wide_t v,uint32_t n,uint32_t base) {
  if(p>UINT32_MAX){lift_fault(3u,p,0);__builtin_trap();}raw_write(p+base,v,n);
}
/* Normal/zero binary32 division, nearest-even only; exactness from integer significands. */
static inline wide_t finite_divide32(wide_t a,wide_t b,uint32_t cpu,uint64_t pc){
 uint32_t left=(uint32_t)a,right=(uint32_t)b,ea=(left>>23u)&255u,eb=(right>>23u)&255u,csr=(uint32_t)raw_read(cpu+1536u,4u);
 if(ea==255u||eb==255u||(!ea&&(left&0x7fffffu))||!eb||(csr&0x6000u))goto unsupported;
 union {uint32_t bits;float value;} x={.bits=left},y={.bits=right},z;z.value=x.value/y.value;
 uint32_t er=(z.bits>>23u)&255u;if(er==255u||(!er&&ea)||(!er&&(z.bits&0x7fffffu)))goto unsupported;
 if(ea){
  uint64_t numerator=(left&0x7fffffu)|0x800000u,product=(uint64_t)((right&0x7fffffu)|0x800000u)*((z.bits&0x7fffffu)|0x800000u);
  int32_t en=(int32_t)ea-(int32_t)eb,ep=(int32_t)er-150;
  while(!(numerator&1u)){numerator>>=1u;en++;}while(!(product&1u)){product>>=1u;ep++;}
  if(numerator!=product||en!=ep){if(!(csr&0x1000u))goto unsupported;raw_write(cpu+1536u,csr|0x20u,4u);}
 }
 return z.bits;
 unsupported:raw_write(cpu+192u,pc,8u);lift_fault(7u,pc,pc);__builtin_trap();
}
/* Integer-only IEEE conversion: signed input, all MXCSR rounding modes, sticky precision. */
static inline wide_t int_to_ieee(wide_t input,uint32_t width,uint32_t output,uint32_t cpu,uint64_t pc){
 uint64_t mask64=width==8?UINT64_MAX:UINT32_MAX,bits=(uint64_t)input&mask64;
 uint64_t negative=bits>>(width*8u-1u),magnitude=negative?((~bits+1u)&mask64):bits;
 if(!magnitude)return 0;
 uint32_t precision=output==4?24u:53u,length=0;
 for(uint64_t v=magnitude;v;v>>=1u)length++;
 uint32_t exponent=length-1u,csr=(uint32_t)raw_read(cpu+1536u,4u);
 uint64_t significand;
 if(length>precision){
  uint32_t shift=length-precision;significand=magnitude>>shift;
  uint64_t remainder=magnitude&((UINT64_C(1)<<shift)-1u),half=UINT64_C(1)<<(shift-1u);
  uint32_t mode=(csr>>13u)&3u;
  if(remainder){
   if(!(csr&0x1000u)){raw_write(cpu+192u,pc,8u);lift_fault(7u,pc,pc);__builtin_trap();}
   raw_write(cpu+1536u,csr|0x20u,4u);
  }
  uint32_t increment=mode==0?(remainder>half||(remainder==half&&(significand&1u))):mode==1?(negative&&remainder):mode==2?(!negative&&remainder):0;
  significand+=increment;
  if(significand==(UINT64_C(1)<<precision)){significand>>=1u;exponent++;}
 }else significand=magnitude<<(precision-length);
 uint64_t result=(negative<<(output*8u-1u))|((uint64_t)(exponent+(output==4?127u:1023u))<<(precision-1u))|(significand&((UINT64_C(1)<<(precision-1u))-1u));
 return result;
}
/* Only normal finite numbers and signed zero; NaN/Inf/subnormal/FP status unsupported. */
static inline wide_t finite_compare(wide_t a,wide_t b,uint32_t n,uint32_t predicate,uint32_t cpu,uint64_t pc) {
 uint64_t exponent=n==4?UINT64_C(0x7f800000):UINT64_C(0x7ff0000000000000);
 uint64_t fraction=n==4?UINT64_C(0x007fffff):UINT64_C(0x000fffffffffffff);
 uint64_t left=(uint64_t)a,right=(uint64_t)b;
 if((left&exponent)==exponent||(right&exponent)==exponent||(!(left&exponent)&&(left&fraction))||(!(right&exponent)&&(right&fraction))){
  raw_write(cpu+192u,pc,8u);lift_fault(6u,pc,pc);__builtin_trap();
 }
 double x,y;
 if(n==4){union {uint32_t bits;float value;} l={.bits=(uint32_t)left},r={.bits=(uint32_t)right};x=l.value;y=r.value;}
 else {union {uint64_t bits;double value;} l={.bits=left},r={.bits=right};x=l.value;y=r.value;}
 return predicate==0?x<y:predicate==1?x<=y:predicate==2?x==y:x!=y;
}
__attribute__((visibility("default")))
uint32_t lift_run(uint32_t cpu,uint64_t entry,uint64_t image_base,uint32_t guest_base,uint64_t stop,uint32_t limit) {
    raw_write(cpu+192u,entry,8u);
    for(uint32_t step=0;step<limit;step++) {
      uint64_t pc=raw_read(cpu+192u,8u);
      if(pc==stop)return step;
      switch(pc-image_base) {
'''

def main():
    p=argparse.ArgumentParser();p.add_argument('dll',type=Path);p.add_argument('--out',type=Path,required=True)
    p.add_argument('--startup-probe',action='store_true');p.add_argument('--limit',type=int,default=256)
    a=p.parse_args();digest=hashlib.sha256(a.dll.read_bytes()).hexdigest()
    if digest!=PIN: raise SystemExit('Refusing a DLL that does not match the pinned official Geode build')
    pe=pefile.PE(str(a.dll));lifter=Lifter(pe,a.limit)
    roots={name:next(s.address+pe.OPTIONAL_HEADER.ImageBase for s in pe.DIRECTORY_ENTRY_EXPORT.symbols if s.name and s.name.decode().startswith('?'+name+'@Hook@geode@@')) for name in ROOTS}
    if a.startup_probe: roots={'DllMainCRTStartup':pe.OPTIONAL_HEADER.ImageBase+pe.OPTIONAL_HEADER.AddressOfEntryPoint}
    a.out.mkdir(parents=True,exist_ok=True)
    try: lifter.discover(roots.values())
    except LiftError as error:
        report={'status':'BLOCKED','dllSha256':digest,'reason':str(error),'instructionsDiscovered':len(lifter.blocks),'opcodes':dict(lifter.opcodes)}
        (a.out/'blocked.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report));return
    source=lifter.source();(a.out/'lifted.c').write_text(source)
    metadata={'dllSha256':digest,'version':'6.0.0-alpha.1','imageBase':hex(lifter.base),
      'roots':{n:{'va':hex(v),'rva':hex(v-lifter.base)} for n,v in roots.items()},
      'instructions':[{'rva':hex(v-lifter.base),'length':i.length,'assembly':str(i),'pcode':[str(op) for op in ops]} for v,(i,ops,_) in sorted(lifter.blocks.items())],
      'opcodes':dict(lifter.opcodes),'cpuRegisters':{n:o for n,o in zip(REGS,range(0,128,8))}|{'RIP':192},
      'limitations':['No DLL initialization','No Windows imports','No exceptions or TLS','Only the listed instruction closure was translated'],
      'generatedCsha256':hashlib.sha256(source.encode()).hexdigest()}
    (a.out/'manifest.json').write_text(json.dumps(metadata,indent=2)+'\n')
    print(json.dumps({'status':'GENERATED','roots':list(roots),'instructions':len(lifter.blocks),'opcodes':dict(lifter.opcodes)}))
if __name__=='__main__': main()
