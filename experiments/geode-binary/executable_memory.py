"""Bounded private executable allocations, stopped before unsupported code writes."""
import unicorn
BASE=0x15000000
SIZE=0x200000
class ExecutableMemory:
 def __init__(self,uc,guarded_regions):
  self.uc=uc;self.guarded_regions=guarded_regions;self.cursor=BASE;self.allocations=[]
  uc.mem_map(BASE,SIZE,unicorn.UC_PROT_NONE)
 def allocate(self,address,size,kind,protection):
  if address or kind!=0x3000 or protection!=0x40:raise RuntimeError('UNMODELED_EXECUTABLE_ALLOCATION')
  if not size:return 0,87
  committed=(size+4095)&~4095;reserved=(size+65535)&~65535
  if self.cursor+reserved>BASE+SIZE:return 0,8
  result=self.cursor;self.cursor+=reserved
  self.uc.mem_protect(result,committed,unicorn.UC_PROT_READ|unicorn.UC_PROT_EXEC)
  self.guarded_regions.append((result,result+committed,'VirtualAlloc executable allocation'))
  self.allocations.append({'base':result,'requested':size,'committed':committed,'reserved':reserved,'protection':protection,'writeRoutingPending':True})
  return result,None
 def snapshot(self):return {'base':BASE,'size':SIZE,'cursor':self.cursor,'allocations':self.allocations}
