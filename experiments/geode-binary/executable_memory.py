"""Bounded private executable allocations, stopped before unsupported code writes."""
import unicorn
from unicorn import x86_const as x
BASE=0x15000000
SIZE=0x200000
class ExecutableMemory:
 def __init__(self,uc,guarded_regions,generated=False):
  self.uc=uc;self.guarded_regions=guarded_regions;self.cursor=BASE;self.allocations=[];self.generated=generated
  self.instructions={};self.writes=[];self.sealed=set()
  uc.mem_map(BASE,SIZE,unicorn.UC_PROT_NONE)
  if generated:uc.hook_add(unicorn.UC_HOOK_MEM_WRITE,self.observe_write,begin=BASE,end=BASE+SIZE-1)
 def observe_write(self,uc,access,address,size,value,data):
  self.writes.append({'pc':hex(uc.reg_read(x.UC_X86_REG_RIP)),'address':address,'size':size})
 def capture(self,pc,length):
  if not self.generated or not BASE<=pc<BASE+SIZE:return
  allocation=next((a for a in self.allocations if a['base']<=pc and pc+length<=a['base']+a['committed']),None)
  if allocation is None:raise RuntimeError('UNOWNED_GENERATED_CODE_FETCH')
  if allocation['base'] not in self.sealed:
   self.uc.mem_protect(allocation['base'],allocation['committed'],unicorn.UC_PROT_READ|unicorn.UC_PROT_EXEC)
   self.guarded_regions.append((allocation['base'],allocation['base']+allocation['committed'],'executed generated code'))
   self.sealed.add(allocation['base'])
  code=bytes(self.uc.mem_read(pc,length))
  if pc in self.instructions and self.instructions[pc]!=code:raise RuntimeError('GENERATED_CODE_VERSION_CHANGED')
  self.instructions[pc]=code
 def allocate(self,address,size,kind,protection):
  if address or kind!=0x3000 or protection!=0x40:raise RuntimeError('UNMODELED_EXECUTABLE_ALLOCATION')
  if not size:return 0,87
  committed=(size+4095)&~4095;reserved=(size+65535)&~65535
  if self.cursor+reserved>BASE+SIZE:return 0,8
  result=self.cursor;self.cursor+=reserved
  self.uc.mem_protect(result,committed,unicorn.UC_PROT_ALL if self.generated else unicorn.UC_PROT_READ|unicorn.UC_PROT_EXEC)
  if not self.generated:self.guarded_regions.append((result,result+committed,'VirtualAlloc executable allocation'))
  self.allocations.append({'base':result,'requested':size,'committed':committed,'reserved':reserved,'protection':protection,'writeRoutingPending':True})
  return result,None
 def snapshot(self):return {'base':BASE,'size':SIZE,'cursor':self.cursor,'allocations':self.allocations}
 def generated_snapshot(self):
  return {'enabled':self.generated,'writeEvents':self.writes,'instructionBytes':{hex(pc):data.hex() for pc,data in self.instructions.items()},'sealedAllocations':sorted(self.sealed),
   'allocations':[{'base':a['base'],'bytesHex':bytes(self.uc.mem_read(a['base'],a['requested'])).hex()} for a in self.allocations]}
