#!/usr/bin/env python3
"""Cross-module Win64 CFG-call reference, using original x64 machine bytes."""
import sys,hashlib,json,random,struct
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from lift import Lifter,PIN,REGS
import pefile,pypcode,unicorn
from unicorn import x86_const as xc
here=Path(__file__).resolve().parent
geode_path=Path(sys.argv[1]);assert hashlib.sha256(geode_path.read_bytes()).hexdigest()==PIN
geode=pefile.PE(str(geode_path));fixture=pefile.PE(str(here/'fixture.dll'))
base=fixture.OPTIONAL_HEADER.ImageBase
assert base==0x1000000
exports={s.name.decode():base+s.address for s in fixture.DIRECTORY_ENTRY_EXPORT.symbols if s.name}
get_address=next(s.address+geode.OPTIONAL_HEADER.ImageBase for s in geode.DIRECTORY_ENTRY_EXPORT.symbols if s.name and s.name.decode().startswith('?getAddress@Hook@geode@@'))
guard=0x180a527b0
fixture_lift=Lifter(fixture,256,allow_indirect=True,yield_unknown=True)
fixture_lift.discover(exports.values())
geode_lift=Lifter(geode,64,allow_indirect=True,yield_unknown=True)
geode_lift.discover([get_address,guard])
for name,lifter in [('fixture',fixture_lift),('geode',geode_lift)]:
 (here/(name+'.c')).write_text(lifter.source())
ctx=pypcode.Context('x86:LE:64:default')
flags={n:2048+ctx.registers[n].offset for n in ['CF','PF','ZF','SF','OF']}
registers=[getattr(xc,'UC_X86_REG_'+r) for r in REGS]
uc=unicorn.Uc(unicorn.UC_ARCH_X86,unicorn.UC_MODE_64)
uc.mem_map(0x10000,0xf0000)
image=fixture.get_memory_mapped_image();uc.mem_map(base,(len(image)+4095)&~4095);uc.mem_write(base,image)
pages={(va&~4095) for va in geode_lift.blocks}
for page in pages:uc.mem_map(page,4096)
for va,(ins,_,_) in geode_lift.blocks.items():uc.mem_write(va,geode.get_data(va-geode.OPTIONAL_HEADER.ImageBase,ins.length))
rng=random.Random(0xcfa110);cases=[]
for trial in range(64):
 initial=[rng.getrandbits(64) for _ in REGS]
 initial[1]=0x40000;initial[2]=get_address;initial[4]=0x60008
 edges=[0,1,0xffffffffffffffff,0x8000000000000000,0xffffffffffffff5a,0xffffffffffffff5b]
 value=edges[trial] if trial<len(edges) else rng.getrandbits(64)
 uc.mem_write(0x40000,struct.pack('<Q',0x40100));obj=bytearray(256)
 struct.pack_into('<Q',obj,0x20,exports['callback']);struct.pack_into('<Q',obj,0x28,value)
 uc.mem_write(0x40100,bytes(obj));uc.mem_write(0x5ff80,b'\0'*256)
 uc.mem_write(0x60008,struct.pack('<Q',0x1234fedc))
 for reg,value_reg in zip(registers,initial):uc.reg_write(reg,value_reg)
 uc.reg_write(xc.UC_X86_REG_EFLAGS,2)
 uc.emu_start(exports['entry'],0x1234fedc,count=256)
 assert uc.reg_read(xc.UC_X86_REG_RIP)==0x1234fedc
 result=uc.reg_read(xc.UC_X86_REG_RAX)
 assert result==((value^0xa5)+7)&0xffffffffffffffff
 rf=uc.reg_read(xc.UC_X86_REG_EFLAGS)
 cases.append({'initial':[hex(x) for x in initial],'value':hex(value),'expected':[hex(uc.reg_read(r)) for r in registers],
   'flags':{n:(rf>>bit)&1 for n,bit in [('CF',0),('PF',2),('ZF',6),('SF',7),('OF',11)]},
   'stackAfter':bytes(uc.mem_read(0x5ff80,256)).hex()})
metadata={'dllSha256':PIN,'fixtureSha256':hashlib.sha256((here/'fixture.dll').read_bytes()).hexdigest(),
 'fixtureBase':hex(base),'fixtureSize':fixture.OPTIONAL_HEADER.SizeOfImage,'fixtureImageHex':image.hex(),
 'geodeBase':hex(geode.OPTIONAL_HEADER.ImageBase),'entry':hex(exports['entry']),'callback':hex(exports['callback']),
 'getAddress':hex(get_address),'guard':hex(guard),'flags':flags,
 'modules':{name:{'instructions':len(lifter.blocks),'rvas':[hex(va-lifter.base) for va in lifter.blocks],
   'opcodes':dict(lifter.opcodes)} for name,lifter in [('fixture',fixture_lift),('geode',geode_lift)]},
 'reference':'Unicorn '+unicorn.__version__,'cases':cases}
(here/'reference.json').write_text(json.dumps(metadata,separators=(',',':'))+'\n')
print(json.dumps({'cases':len(cases),'fixtureInstructions':len(fixture_lift.blocks),'geodeInstructions':len(geode_lift.blocks)}))
