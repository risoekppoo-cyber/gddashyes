"""Reached current-process VirtualProtectEx subset; unknown memory stops."""
import unicorn
from unicorn import x86_const as x
class CodeProtection:
 def __init__(self,uc,regions):
  self.uc=uc;self.regions=[r for r in regions if r[2]!='unresolved import gateways'];self.pages={};self.calls=[];self.writes=[]
 def owner(self,p,n):return next((name for lo,hi,name in self.regions if lo<=p and p+n<=hi),None)
 def writable(self,p,n):
  return bool(self.owner(p,n)) and all(self.pages.get(page,0x20)==0x40 for page in range(p&~4095,(p+n+4095)&~4095,4096))
 def protect(self,process,p,n,protection,output):
  if process!=0xffffffffffffffff or protection not in [0x20,0x40]:raise RuntimeError('UNMODELED_CODE_PROTECTION')
  if not n or not output:return 0,87
  first=p&~4095;end=(p+n+4095)&~4095
  if not self.owner(first,end-first):raise RuntimeError('UNOWNED_CODE_PROTECTION')
  old=self.pages.get(first,0x20)
  self.uc.mem_write(output,old.to_bytes(4,'little'))
  self.uc.mem_protect(first,end-first,unicorn.UC_PROT_READ|unicorn.UC_PROT_EXEC|(unicorn.UC_PROT_WRITE if protection==0x40 else 0))
  for page in range(first,end,4096):self.pages[page]=protection
  self.calls.append({'address':p,'size':n,'protection':protection,'old':old});return 1,None
 def observe(self,uc,access,p,n,value,data):
  if self.owner(p,n):
   self.writes.append({'pc':hex(uc.reg_read(x.UC_X86_REG_RIP)),'address':p,'size':n})
   uc.ctl_remove_cache(p,p+n)
 def snapshot(self):return {'pages':{str(k):v for k,v in self.pages.items()},'calls':self.calls}
