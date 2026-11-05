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
    def __init__(self, pe, limit, allow_indirect=False, yield_unknown=False):
        self.pe, self.limit = pe, limit
        self.allow_indirect, self.yield_unknown = allow_indirect, yield_unknown
        self.base = pe.OPTIONAL_HEADER.ImageBase
        self.ctx = pypcode.Context('x86:LE:64:default')
        self.reg_roots = [(self.ctx.registers[n].offset, i*8, 8) for i,n in enumerate(REGS)]
        self.reg_roots.append((self.ctx.registers['RIP'].offset, 192, 8))
        self.blocks = {}
        self.opcodes = collections.Counter()
    def reg_offset(self, v):
        for source, target, size in self.reg_roots:
            if source <= v.offset and v.offset+v.size <= source+size:
                return target+v.offset-source
        # Additional SLEIGH flags/state live in this experiment's CPU shadow.
        # No claim is made that the game's complete SIMD/TLS layout is mapped.
        if v.offset < 1024: return 2048+v.offset
        raise LiftError(f'Unmapped register {v}')
    def expr(self, v):
        if v.size > 8: raise LiftError(f'IR value wider than 64 bits: {v}')
        if v.space.name == 'const': return f'UINT64_C({v.offset})'
        if v.space.name == 'register': return f'raw_read(cpu+{self.reg_offset(v)}u,{v.size}u)'
        if v.space.name == 'unique': return f'(u_{v.offset:x}&mask({v.size}u))'
        if v.space.name == 'ram':
            if not self.base <= v.offset < self.base+self.pe.OPTIONAL_HEADER.SizeOfImage:
                raise LiftError(f'Absolute memory reference outside image: {v}')
            return f'guest_read(image_base+UINT64_C({v.offset-self.base}),{v.size}u,guest_base)'
        raise LiftError(f'Unsupported input space {v.space.name}')
    def assign(self, v, expression):
        if v.size > 8: raise LiftError(f'IR result wider than 64 bits: {v}')
        if v.space.name == 'register': return f'raw_write(cpu+{self.reg_offset(v)}u,({expression}),{v.size}u);'
        if v.space.name == 'unique': return f'u_{v.offset:x}=({expression})&mask({v.size}u);'
        if v.space.name == 'ram':
            if not self.base <= v.offset < self.base+self.pe.OPTIONAL_HEADER.SizeOfImage:
                raise LiftError(f'Absolute memory write outside image: {v}')
            return f'guest_write(image_base+UINT64_C({v.offset-self.base}),({expression}),{v.size}u,guest_base);'
        raise LiftError(f'Unsupported output space {v.space.name}')
    def emit_op(self, op, index, count):
        code, a = op.opcode.name, op.inputs
        self.opcodes[code] += 1
        x = [self.expr(v) for v in a] if code not in ['IMARK','LOAD','STORE','BRANCH','CBRANCH','CALL','RETURN'] else []
        if code == 'IMARK': return ''
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
        elif code in ['INT_ZEXT','CAST']: e=x[0]
        elif code=='INT_SEXT': e=f'sext({x[0]},{a[0].size}u)'
        elif code in ['INT_ADD','INT_SUB','INT_MULT','INT_AND','INT_OR','INT_XOR']:
            operator={'INT_ADD':'+','INT_SUB':'-','INT_MULT':'*','INT_AND':'&','INT_OR':'|','INT_XOR':'^'}[code]
            e=f'({x[0]} {operator} {x[1]})'
        elif code=='INT_LEFT': e=f'({x[1]}>=64u?0:({x[0]}<<{x[1]}))'
        elif code=='INT_RIGHT': e=f'({x[1]}>=64u?0:({x[0]}>>{x[1]}))'
        elif code=='INT_NEGATE': e=f'~{x[0]}'
        elif code=='INT_2COMP': e=f'(UINT64_C(0)-{x[0]})'
        elif code in ['INT_EQUAL','INT_NOTEQUAL','INT_LESS','INT_LESSEQUAL']:
            operator={'INT_EQUAL':'==','INT_NOTEQUAL':'!=','INT_LESS':'<','INT_LESSEQUAL':'<='}[code]
            e=f'({x[0]} {operator} {x[1]})'
        elif code in ['INT_SLESS','INT_SLESSEQUAL']:
            operator='<' if code=='INT_SLESS' else '<='
            e=f'((int64_t)sext({x[0]},{a[0].size}u) {operator} (int64_t)sext({x[1]},{a[1].size}u))'
        elif code=='INT_CARRY': e=f'(({x[0]}+{x[1]})&mask({a[0].size}u))<{x[0]}'
        elif code=='INT_SCARRY': e=f'((~({x[0]}^{x[1]})&({x[0]}^({x[0]}+{x[1]})))>>{a[0].size*8-1})&1u'
        elif code=='INT_SBORROW': e=f'((({x[0]}^{x[1]})&({x[0]}^({x[0]}-{x[1]})))>>{a[0].size*8-1})&1u'
        elif code=='BOOL_NEGATE': e=f'!{x[0]}'
        elif code in ['BOOL_AND','BOOL_OR','BOOL_XOR']:
            operator={'BOOL_AND':'&','BOOL_OR':'|','BOOL_XOR':'^'}[code]; e=f'((!!{x[0]}){operator}(!!{x[1]}))'
        elif code=='POPCOUNT': e=f'__builtin_popcountll({x[0]})'
        elif code=='SUBPIECE': e=f'({x[0]}>>({x[1]}*8u))'
        elif code=='PIECE':
            if sum(v.size for v in a)>8: raise LiftError('PIECE wider than 64 bits')
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
            ops=self.ctx.translate(data[:instruction.length],base_address=va,max_instructions=1).ops
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
            unique=sorted({v.offset for op in ops for v in ([op.output] if op.output else [])+list(op.inputs) if v.space.name=='unique'})
            lines=[f'case UINT64_C({va-self.base}): {{ /* {ins} */']
            lines += [f'uint64_t u_{n:x}=0;' for n in unique]
            lines += [f'raw_write(cpu+192u,image_base+UINT64_C({va-self.base+ins.length}),8u);']
            for i,line in enumerate(emitted):
                line=re.sub(r'\bop_(\d+)\b',lambda m:f'pc_{va:x}_op_{m[1]}',line)
                lines += [f'pc_{va:x}_op_{i}: ; '+line]
            lines += [f'pc_{va:x}_op_{len(ops)}: ; goto next_instruction; }}']
            cases.append('\n'.join(lines))
        default='return 0x80000000u|step;' if self.yield_unknown else 'lift_fault(1u,pc,pc); __builtin_trap();'
        return PRELUDE+'\n'.join(cases)+'\n default: '+default+'''
      }
      next_instruction: ;
    }
    lift_fault(4u,raw_read(cpu+192u,8u),entry); __builtin_trap();
}
'''

PRELUDE='''/* Generated from the pinned Windows DLL's instruction semantics. */
#include <stdint.h>
__attribute__((import_module("env"),import_name("lift_fault")))
void lift_fault(uint32_t code,uint64_t address,uint64_t pc);
static inline uint64_t mask(uint32_t n) {return n==8u?UINT64_MAX:((UINT64_C(1)<<(n*8u))-1u);}
static inline uint64_t sext(uint64_t v,uint32_t n) {uint32_t s=64u-n*8u;return (uint64_t)((int64_t)(v<<s)>>s);}
static inline uint64_t raw_read(uint64_t p,uint32_t n) {
  if(p+n>(uint64_t)__builtin_wasm_memory_size(0)*65536u){lift_fault(2u,p,0);__builtin_trap();}
  uint64_t v=0;for(uint32_t i=0;i<n;i++)v|=(uint64_t)(*(uint8_t*)(uintptr_t)(p+i))<<(i*8u);return v;
}
static inline void raw_write(uint64_t p,uint64_t v,uint32_t n) {
  if(p+n>(uint64_t)__builtin_wasm_memory_size(0)*65536u){lift_fault(2u,p,0);__builtin_trap();}
  for(uint32_t i=0;i<n;i++)*(uint8_t*)(uintptr_t)(p+i)=(uint8_t)(v>>(i*8u));
}
static inline uint64_t guest_read(uint64_t p,uint32_t n,uint32_t base) {
  if(p>UINT32_MAX){lift_fault(3u,p,0);__builtin_trap();}return raw_read(p+base,n);
}
static inline void guest_write(uint64_t p,uint64_t v,uint32_t n,uint32_t base) {
  if(p>UINT32_MAX){lift_fault(3u,p,0);__builtin_trap();}raw_write(p+base,v,n);
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
