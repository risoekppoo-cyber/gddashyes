#!/usr/bin/env python3
"""Independent x64 execution of the owned bridge; compares to browser fixture cases."""
import sys,json,struct,hashlib
from pathlib import Path
import unicorn
from unicorn import x86_const as x
root=Path(sys.argv[1]);data=json.loads((root/'cases.json').read_text());manifest=json.loads((root/'manifest.json').read_text())
entry=bytes.fromhex(data['nativeEntryHex']);assert entry==b'\x90'*16+bytes.fromhex('b800000000c3')
base=0x100000;hook=base+0x1000;trampoline=base+0x2000;ret=0x1234fedc
# Owned Win64 detour: increment maxchannels, invoke original, change its result.
hook_bytes=bytes.fromhex('488d5201488d6424d848b8')+struct.pack('<Q',trampoline)+bytes.fromhex('ffd0488d642428b858020000c3')
regs=[getattr(x,'UC_X86_REG_'+n) for n in ['RAX','RCX','RDX','RBX','RSP','RBP','RSI','RDI','R8','R9','R10','R11','R12','R13','R14','R15']]
uc=unicorn.Uc(unicorn.UC_ARCH_X86,unicorn.UC_MODE_64);uc.mem_map(base,0x4000);uc.mem_map(0x2000,0x10000);uc.mem_write(hook,hook_bytes);uc.mem_write(trampoline,entry)
count=0
for case in data['cases']:
 initial=list(map(int,case['registers']));assert initial[4]%16==8
 for mode in ['original','hooked','restored']:
  patch=bytes.fromhex(data['patchHex']);assert patch==b'\xe9'+struct.pack('<i',hook-base-5)+entry[5:]
  body=patch if mode=='hooked' else entry
  uc.mem_write(base,body);uc.ctl_remove_cache(base,base+len(body))
  for r,v in zip(regs,initial):uc.reg_write(r,v)
  for i in range(16):uc.reg_write(getattr(x,'UC_X86_REG_XMM'+str(i)),int.from_bytes(b'\xa5'*16,'little'))
  uc.reg_write(x.UC_X86_REG_EFLAGS,0x246);uc.mem_write(initial[4],struct.pack('<Q',ret));uc.emu_start(base,ret,count=100)
  expected=initial.copy();expected[0]=600 if mode=='hooked' else 0;expected[4]+=8
  if mode=='hooked':expected[2]+=1
  assert [uc.reg_read(r) for r in regs]==expected,mode
  assert uc.reg_read(x.UC_X86_REG_RIP)==ret and uc.reg_read(x.UC_X86_REG_EFLAGS)==0x246
  assert all(uc.reg_read(getattr(x,'UC_X86_REG_XMM'+str(i)))==int.from_bytes(b'\xa5'*16,'little') for i in range(16))
  count+=1
browser=json.loads((root/'browser-result.json').read_text())
result={**browser,'status':'FMOD_BRIDGE_CONTRACT_PASS','nativeReference':'Unicorn '+unicorn.__version__,'nativeExecutions':count,'nativeReadableEntryVerified':True,'nativeOriginalViaTrampoline':True,'nativePatchAndRestore':True,'nativePatchCacheInvalidated':True,'nativeGeneralRegistersMatchBrowserContract':True,'nativeFlagsAndXmmPreserved':True,'runtimeNativePatchToWasmLinked':False,'fullGeodeLoader':False,'existingGeodePackagesSupported':False}
(root/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
