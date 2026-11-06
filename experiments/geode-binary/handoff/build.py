"""Pinned live startup mapping and original Geode callback prologue translation."""
import sys,json,hashlib,struct
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]));from lift import Lifter,PIN,REGS
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'tools'));import wasm_probe as w
import pefile,unicorn
from unicorn import x86_const as x
dll=Path(sys.argv[1]).read_bytes();game=Path(sys.argv[2]).read_bytes();out=Path(sys.argv[3]);out.mkdir(parents=True,exist_ok=True)
assert hashlib.sha256(dll).hexdigest()==PIN
game_pin='523d9362955eba27a8ce64ec9b4fda496c8ecc30e6ac9ca1f01cc76c89a5a15a';assert hashlib.sha256(game).hexdigest()==game_pin
assert w.table_elements(game)[10972]==10503 and w.inspect(game)['functionTypes'][10503]==0
pe=pefile.PE(data=dll);pe.OPTIONAL_HEADER.ImageBase=0x2000000;lifter=Lifter(pe,32,allow_indirect=True,yield_unknown=True,wide_mode=True,yield_on_budget=True)
entry=0x212f200;stop=0x212f22d;code=pe.get_data(entry-0x2000000,stop-entry);pos=0
while pos<len(code):
 ins=lifter.ctx.disassemble(code[pos:],base_address=entry+pos,max_instructions=1).instructions[0];ops=lifter.ctx.translate(code[pos:pos+ins.length],base_address=entry+pos,max_instructions=1).ops;lifter.current_instruction=ins;lifter.prepare_uniques(ops)
 emitted=[lifter.emit_op(op,n,len(ops)) for n,op in enumerate(ops)]
 # SLEIGH omits x86 AF here. Preserve the real SUB flags, including incoming AF=1 cases.
 if ins.addr.offset==0x212f20a:
  assert ins.mnem=='SUB' and ins.body=='RSP,0xf0'
  emitted[0]='raw_write(cpu+2564u,((raw_read(cpu+32u,8u)^UINT64_C(240)^(raw_read(cpu+32u,8u)-UINT64_C(240)))>>4u)&1u,1u);'+emitted[0]
 lifter.blocks[entry+pos]=(ins,ops,emitted);pos+=ins.length
assert len(lifter.blocks)==14 and pos==len(code)
(out/'prologue.c').write_text(lifter.source(partition_size=1))
cases=[]
for index in range(8):
 uc=unicorn.Uc(unicorn.UC_ARCH_X86,unicorn.UC_MODE_64);uc.mem_map(entry&~4095,4096);uc.mem_write(entry,code);uc.mem_map(0x10000,0x10000)
 initial=[((i+1)*0x1111111111111111+index*0x101010101)&0xffffffffffffffff for i in range(16)];initial[4]=0x1f008
 for n,v in zip(REGS,initial):uc.reg_write(getattr(x,'UC_X86_REG_'+n),v)
 flags=0x202|(0x8d5 if index&1 else 0);uc.reg_write(x.UC_X86_REG_EFLAGS,flags);uc.mem_write(0x1ee00,b'\xa5'*0x240);uc.emu_start(entry,stop,count=20)
 cases.append({'initial':[hex(v) for v in initial],'flags':flags,'expected':[hex(uc.reg_read(getattr(x,'UC_X86_REG_'+n))) for n in REGS],'expectedFlags':uc.reg_read(x.UC_X86_REG_EFLAGS),'stackHex':bytes(uc.mem_read(0x1ee00,0x240)).hex()})
manifest={'dllSha256':PIN,'gameSha256':game_pin,'gameTarget':{'id':'startup','address':0xa74a90,'table':10972,'function':10503},'functionBodySha256':hashlib.sha256(w.function_bodies(game)[10503]).hexdigest(),'entry':entry,'stop':stop,'instructions':14,'nativeBytesHex':code.hex(),'nativeReference':'Unicorn 2.1.4','cases':cases,'scope':'Prologue only, stops BEFORE the first call. No Geode DLL data or initialization is mapped into the live game.'}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({'status':'LIVE_STARTUP_MAPPING_VERIFIED','target':manifest['gameTarget'],'prologueInstructions':14,'nativeCases':len(cases)}))
