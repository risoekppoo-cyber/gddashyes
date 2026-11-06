#!/usr/bin/env python3
"""Bare DLL entrypoint probe. Stops at the first required Windows import.

Unicorn executes original relocated x64 bytes; the reached instructions are
then checked against the current binary translator. No API success is faked.
PE TLS callbacks and a bounded loader model precede the entrypoint.
"""
import sys,json,hashlib,struct,time,uuid,os
from pathlib import Path
import pefile,pypcode,unicorn
from unicorn import x86_const as x
from lift import PIN,Lifter,LiftError
from guest_modules import build_modules,module_handle,resolve_export,mapped_pe
from guest_heap import GuestHeap

path=Path(sys.argv[1]);assert hashlib.sha256(path.read_bytes()).hexdigest()==PIN
pe=pefile.PE(str(path));base=0x2000000;preferred=pe.OPTIONAL_HEADER.ImageBase
image=bytearray(pe.get_memory_mapped_image());size=(pe.OPTIONAL_HEADER.SizeOfImage+4095)&~4095
for block in pe.DIRECTORY_ENTRY_BASERELOC:
 for reloc in block.entries:
  if reloc.type==0:continue
  assert reloc.type==10
  value=struct.unpack_from('<Q',image,reloc.rva)[0]
  struct.pack_into('<Q',image,reloc.rva,(value+base-preferred)&0xffffffffffffffff)
pe.OPTIONAL_HEADER.ImageBase=base
uc=unicorn.Uc(unicorn.UC_ARCH_X86,unicorn.UC_MODE_64)
uc.reg_write(x.UC_X86_REG_MXCSR,0x1f80)
uc.mem_map(base,size);uc.mem_write(base,bytes(image))
uc.mem_map(0x200000,0x100000);uc.mem_map(0x70000000,0x10000)
imports={};i=0
for desc in pe.DIRECTORY_ENTRY_IMPORT:
 for imp in desc.imports:
  target=0x70000000+i*16;i+=1
  imports[target]=desc.dll.decode()+'!'+(imp.name.decode() if imp.name else '#'+str(imp.ordinal))
  uc.mem_write(imp.address-preferred+base,target.to_bytes(8,'little'))
modules,module_images,module_gateways=build_modules(pe,base)
for module_base,module_image in module_images.items():
 uc.mem_map(module_base,len(module_image));uc.mem_write(module_base,module_image)
imports.update(module_gateways)
cocos=None;cocos_path=os.environ.get('GEODE_COCOS_IMG')
if cocos_path:
 from fetch_cocos_image import PIN as cocos_pin
 cocos_data=Path(cocos_path).read_bytes();assert hashlib.sha256(cocos_data).hexdigest()==cocos_pin
 cocos_pe=mapped_pe(cocos_data);cocos_base=0x10000000
 assert len(cocos_data)==cocos_pe.OPTIONAL_HEADER.SizeOfImage and cocos_pe.FILE_HEADER.Machine==0x8664
 uc.mem_map(cocos_base,len(cocos_data));uc.mem_write(cocos_base,cocos_data)
 for desc in cocos_pe.DIRECTORY_ENTRY_IMPORT:
  for imp in desc.imports:
   name=desc.dll.decode()+'!'+(imp.name.decode() if imp.name else '#'+str(imp.ordinal))
   target=next((p for p,n in imports.items() if n.lower()==name.lower()),None)
   if target is None:
    target=0x70000000+i*16;i+=1;assert target<0x70010000;imports[target]=name
   uc.mem_write(cocos_base+imp.address-cocos_pe.OPTIONAL_HEADER.ImageBase,struct.pack('<Q',target))
 cocos={'name':'libcocos2d.dll','base':cocos_base,'size':len(cocos_data),'complete':True,'shim':False,'initialized':False,
  'sha256':cocos_pin,'entry':cocos_base+cocos_pe.OPTIONAL_HEADER.AddressOfEntryPoint,'staticTls':True,'exportCount':len(cocos_pe.DIRECTORY_ENTRY_EXPORT.symbols)}
 modules.append(cocos);module_images[cocos_base]=bytes(uc.mem_read(cocos_base,len(cocos_data)))
uc.reg_write(x.UC_X86_REG_RCX,base);uc.reg_write(x.UC_X86_REG_RDX,1)
uc.reg_write(x.UC_X86_REG_R8,0);uc.reg_write(x.UC_X86_REG_RSP,0x2fff08)
uc.mem_write(0x2fff08,(0x1234fedc).to_bytes(8,'little'))
initial_image=bytes(uc.mem_read(base,size))
profile=json.loads((Path(__file__).parent/'cpu-profile.json').read_text())
windows_profile=json.loads((Path(__file__).parent/'windows-profile.json').read_text())
tib=0x400000;tib_size=0x10000;uc.mem_map(tib,tib_size);uc.reg_write(x.UC_X86_REG_GS_BASE,tib)
uc.mem_write(tib+8,struct.pack('<QQ',0x300000,0x200000))
uc.mem_write(tib+0x30,struct.pack('<Q',tib))
tls_directory=pe.OPTIONAL_HEADER.DATA_DIRECTORY[9].VirtualAddress
tls_start,tls_end,tls_index,tls_callbacks,tls_zero,tls_flags=struct.unpack('<QQQQII',uc.mem_read(base+tls_directory,40))
tls_block=0x700000;tls_size=0x10000;assert tls_end-tls_start+tls_zero<=tls_size
uc.mem_map(tls_block,tls_size)
uc.mem_write(tls_block,bytes(uc.mem_read(tls_start,tls_end-tls_start)))
uc.mem_write(tls_index,struct.pack('<I',0))
uc.mem_write(tib+0x58,struct.pack('<Q',tib+0x2000));uc.mem_write(tib+0x2000,struct.pack('<Q',tls_block))
callbacks=[]
for i in range(64):
 target=int.from_bytes(uc.mem_read(tls_callbacks+i*8,8),'little')
 if not target:break
 callbacks.append(target)
else:raise RuntimeError('TLS callback table limit')
bootstrap=0x72000000;uc.mem_map(bootstrap,4096);loader=bytearray(bytes.fromhex('4883ec28'))
callback_returns={}
for target in callbacks+[base+pe.OPTIONAL_HEADER.AddressOfEntryPoint]:
 loader+=b'\x48\xb9'+struct.pack('<Q',base)+bytes.fromhex('ba010000004531c0')
 loader+=b'\x48\xb8'+struct.pack('<Q',target)+bytes.fromhex('ffd0')
 if target in callbacks:callback_returns[bootstrap+len(loader)]=target
loader+=bytes.fromhex('4883c428c3');uc.mem_write(bootstrap,bytes(loader))
initial_image=bytes(uc.mem_read(base,size));initial_tib=bytes(uc.mem_read(tib,tib_size));initial_tls=bytes(uc.mem_read(tls_block,tls_size))
completed_tls=[]
load_frame=None;load_events=[];uc.mem_map(0x73000000,4096)
if cocos:
 t=cocos_pe.DIRECTORY_ENTRY_TLS.struct;targets=[]
 for index in range(64):
  target=struct.unpack_from('<Q',cocos_data,t.AddressOfCallBacks-cocos['base']+index*8)[0]
  if not target:break
  targets.append(target)
 else:raise RuntimeError('Cocos TLS callback table limit')
 template=cocos_data[t.StartAddressOfRawData-cocos['base']:t.EndAddressOfRawData-cocos['base']]
 cocos['tls']={'base':0xd00000,'size':0x10000,'indexAddress':t.AddressOfIndex,'index':1,'templateHex':template.hex(),'callbacks':targets}
 uc.mem_map(0xd00000,0x10000)
trace=[];stop={};host_calls=[];cpu_calls=[]
uc.mem_map(0x71000000,4096)
arena=0x500000;arena_size=0x100000;uc.mem_map(arena,arena_size);next_allocation=arena
initializer_frames=[];initializer_events=[];control_events=[]
uc.mem_map(0x3400000,0x800000);uc.mem_map(0xc00000,0x10000)
heap=GuestHeap(uc.mem_read,uc.mem_write)
def advance_load():
 global load_frame
 f=load_frame
 if f['next']==len(f['targets']):
  f['module']['initialized']=True;uc.reg_write(x.UC_X86_REG_RAX,f['module']['base']);uc.reg_write(x.UC_X86_REG_RSP,f['sp']+8);uc.reg_write(x.UC_X86_REG_RIP,f['ret'])
  load_events.append({'kind':'loaded','module':f['module']['name']});load_frame=None;return
 target=f['targets'][f['next']];f['next']+=1;sp=f['sp']-48;f['callbackSp']=sp
 uc.mem_write(sp,struct.pack('<Q',0x73000000));uc.reg_write(x.UC_X86_REG_RSP,sp);uc.reg_write(x.UC_X86_REG_RIP,target)
 for reg,value in [(x.UC_X86_REG_RCX,f['module']['base']),(x.UC_X86_REG_RDX,1),(x.UC_X86_REG_R8,0)]:uc.reg_write(reg,value)
 load_events.append({'kind':'entry' if f['next']==len(f['targets']) else 'tls','target':hex(target)})
def finish_initializer(result):
 f=initializer_frames.pop()
 if f['error']:uc.reg_write(x.UC_X86_REG_RAX,result&0xffffffff)
 uc.reg_write(x.UC_X86_REG_RSP,f['sp']+8);uc.reg_write(x.UC_X86_REG_RIP,f['ret'])
 initializer_events.append({'kind':'complete','result':result})
def advance_initializer():
 f=initializer_frames[-1]
 while f['next']<f['end']:
  target=int.from_bytes(uc.mem_read(f['next'],8),'little');f['next']+=8
  if not target:continue
  sp=f['sp']-48;f['callbackSp']=sp
  uc.mem_write(sp,struct.pack('<Q',f['sentinel']))
  uc.reg_write(x.UC_X86_REG_RSP,sp);uc.reg_write(x.UC_X86_REG_RIP,target)
  initializer_events.append({'kind':'callback','target':hex(target)});return
 finish_initializer(0)
clock_ms=time.time_ns()//1_000_000
last_error=0;environment={};thread_description=None
local_heap=0xa00000;local_heap_size=0x100000;uc.mem_map(local_heap,local_heap_size);local_next=local_heap;local_allocations={}
srw_states={};tib_reads=[]
def read_wide(p):
 chars=[]
 for i in range(32768):
  ch=int.from_bytes(uc.mem_read(p+i*2,2),'little')
  if not ch:return bytes(b''.join(struct.pack('<H',c) for c in chars)).decode('utf-16le')
  chars.append(ch)
 raise RuntimeError('Unterminated environment string')
def read_ansi(p):
 text=bytearray()
 for i in range(32768):
  value=bytes(uc.mem_read(p+i,1))
  if value==b'\0':return text.decode('latin1')
  text+=value
 raise RuntimeError('Unterminated ANSI string')
def code(uc,pc,length,_):
 global next_allocation,last_error,thread_description,local_next,load_frame
 if pc in callback_returns:completed_tls.append(callback_returns[pc])
 if load_frame and pc==0x73000000:
  f=load_frame;assert uc.reg_read(x.UC_X86_REG_RSP)==f['callbackSp']+8
  if f['next']==len(f['targets']) and uc.reg_read(x.UC_X86_REG_RAX)&0xffffffff==0:stop.update(reason='MODULE_ATTACH_FAILED_DETACH_REQUIRED');uc.emu_stop();return
  load_events.append({'kind':'entryComplete' if f['next']==len(f['targets']) else 'tlsComplete'})
  advance_load();control_events.append(pc);uc.emu_stop();return
 if initializer_frames and pc==initializer_frames[-1]['sentinel']:
  f=initializer_frames[-1];assert uc.reg_read(x.UC_X86_REG_RSP)==f['callbackSp']+8
  result=uc.reg_read(x.UC_X86_REG_RAX)&0xffffffff
  if f['error'] and result:finish_initializer(result)
  else:advance_initializer()
  control_events.append(pc);uc.emu_stop();return
 if pc in imports and imports[pc].lower()=='kernel32.dll!getsystemtimeasfiletime':
  output=uc.reg_read(x.UC_X86_REG_RCX)
  timestamp=(clock_ms+11644473600000)*10000
  uc.mem_write(output,struct.pack('<Q',timestamp))
  sp=uc.reg_read(x.UC_X86_REG_RSP);ret=int.from_bytes(uc.mem_read(sp,8),'little')
  host_calls.append({'address':hex(pc),'name':imports[pc],'unixMilliseconds':clock_ms,'output':hex(output)})
  uc.reg_write(x.UC_X86_REG_RSP,sp+8);uc.reg_write(x.UC_X86_REG_RIP,ret)
  uc.emu_stop();return
 if pc in imports and imports[pc].lower()=='kernel32.dll!getcurrentthreadid':
  # The one registered guest execution context is main, with stable ID 1.
  thread_id=1
  sp=uc.reg_read(x.UC_X86_REG_RSP);ret=int.from_bytes(uc.mem_read(sp,8),'little')
  host_calls.append({'address':hex(pc),'name':imports[pc],'threadId':thread_id})
  uc.reg_write(x.UC_X86_REG_RAX,thread_id)
  uc.reg_write(x.UC_X86_REG_RSP,sp+8);uc.reg_write(x.UC_X86_REG_RIP,ret)
  uc.emu_stop();return
 if pc in imports:
  name=imports[pc].lower()
  if name=='kernel32.dll!disablethreadlibrarycalls':
   handle=uc.reg_read(x.UC_X86_REG_RCX);module=next((m for m in modules if m['base']==handle),None)
   if module is None:stop.update(reason='UNMODELED_MODULE_HANDLE',address=hex(handle));uc.emu_stop();return
   if module.get('staticTls'):result=0;last_error=126;uc.mem_write(tib+0x68,struct.pack('<I',last_error))
   else:result=1;module['threadCalloutsDisabled']=True
   host_calls.append({'address':hex(pc),'name':imports[pc],'module':hex(handle),'result':hex(result)});sp=uc.reg_read(x.UC_X86_REG_RSP);ret=int.from_bytes(uc.mem_read(sp,8),'little')
   uc.reg_write(x.UC_X86_REG_RAX,result);uc.reg_write(x.UC_X86_REG_RSP,sp+8);uc.reg_write(x.UC_X86_REG_RIP,ret);uc.emu_stop();return
  if (name.startswith('api-ms-win-crt-string-') or name.startswith('vcruntime140.dll!')) and name.split('!')[-1] in ['strlen','wcslen','memcpy','memmove','memset','memcmp']:
   symbol=name.split('!')[-1];a=uc.reg_read(x.UC_X86_REG_RCX);b=uc.reg_read(x.UC_X86_REG_RDX);n=uc.reg_read(x.UC_X86_REG_R8)
   if symbol in ['strlen','wcslen']:
    result=0;width=2 if symbol=='wcslen' else 1
    while result<0x800000//width and int.from_bytes(uc.mem_read(a+result*width,width),'little')!=0:result+=1
    assert result<0x800000//width
   else:
    assert n<=0x800000;result=a
    if symbol=='memset':
     if n:uc.mem_write(a,bytes([b&255])*n)
    elif symbol in ['memcpy','memmove']:
     if n:
      if symbol=='memcpy':assert not(a<b+n and b<a+n)
      uc.mem_write(a,bytes(uc.mem_read(b,n)))
    else:
     result=0
     if n:
      left,right=bytes(uc.mem_read(a,n)),bytes(uc.mem_read(b,n))
      for l,r in zip(left,right):
       if l!=r:result=(l-r)&0xffffffff;break
   host_calls.append({'address':hex(pc),'name':imports[pc],'result':hex(result)});sp=uc.reg_read(x.UC_X86_REG_RSP);ret=int.from_bytes(uc.mem_read(sp,8),'little')
   uc.reg_write(x.UC_X86_REG_RAX,result);uc.reg_write(x.UC_X86_REG_RSP,sp+8);uc.reg_write(x.UC_X86_REG_RIP,ret);uc.emu_stop();return
  if name=='kernel32.dll!loadlibraryexa' and cocos:
   requested=read_ansi(uc.reg_read(x.UC_X86_REG_RCX));flags=uc.reg_read(x.UC_X86_REG_R8);file=uc.reg_read(x.UC_X86_REG_RDX)
   if requested.lower()!='libcocos2d.dll' or flags or file:stop.update(reason='UNMODELED_LOAD_LIBRARY',requestedModule=requested,flags=hex(flags),file=hex(file));uc.emu_stop();return
   if load_frame:stop.update(reason='NESTED_DEPENDENCY_LOAD_UNSUPPORTED');uc.emu_stop();return
   if cocos['initialized']:stop.update(reason='MODULE_REFERENCE_COUNT_REQUIRED');uc.emu_stop();return
   sp=uc.reg_read(x.UC_X86_REG_RSP);assert sp%16==8;tls=cocos['tls']
   uc.mem_write(tls['indexAddress'],struct.pack('<I',tls['index']));uc.mem_write(tib+0x2000+tls['index']*8,struct.pack('<Q',tls['base']))
   uc.mem_write(tls['base'],b'\0'*tls['size']);uc.mem_write(tls['base'],bytes.fromhex(tls['templateHex']))
   host_calls.append({'address':hex(pc),'name':imports[pc],'module':requested,'action':'initializeDependency','base':cocos['base']})
   load_frame={'module':cocos,'sp':sp,'ret':int.from_bytes(uc.mem_read(sp,8),'little'),'next':0,'targets':tls['callbacks']+[cocos['entry']]};advance_load();uc.emu_stop();return
  if (name.startswith('api-ms-win-crt-heap-') and name.split('!')[-1] in ['malloc','free','realloc','calloc','_msize']) or name=='api-ms-win-crt-runtime-l1-1-0.dll!_errno':
   a=uc.reg_read(x.UC_X86_REG_RCX);b=uc.reg_read(x.UC_X86_REG_RDX)
   result=heap.invoke(name.split('!')[-1],a,b)
   call={'address':hex(pc),'name':imports[pc],'a':hex(a),'b':hex(b),'result':hex(result) if result is not None else None};host_calls.append(call)
   sp=uc.reg_read(x.UC_X86_REG_RSP);ret=int.from_bytes(uc.mem_read(sp,8),'little')
   if result is not None:uc.reg_write(x.UC_X86_REG_RAX,result)
   uc.reg_write(x.UC_X86_REG_RSP,sp+8);uc.reg_write(x.UC_X86_REG_RIP,ret);uc.emu_stop();return
  if name in ['kernel32.dll!getcurrentthread','kernel32.dll!setthreaddescription','kernel32.dll!getthreaddescription','kernel32.dll!localfree']:
   call={'address':hex(pc),'name':imports[pc]}
   if name.endswith('getcurrentthread'):result=0xfffffffffffffffe
   elif name.endswith('localfree'):
    p=uc.reg_read(x.UC_X86_REG_RCX)
    if p:assert p in local_allocations;del local_allocations[p]
    result=0
   else:
    handle=uc.reg_read(x.UC_X86_REG_RCX);p=uc.reg_read(x.UC_X86_REG_RDX)
    if handle!=0xfffffffffffffffe:stop.update(reason='UNMODELED_THREAD_HANDLE',address=hex(pc),handle=hex(handle));uc.emu_stop();return
    if name.endswith('setthreaddescription'):thread_description=read_wide(p);call['description']=thread_description;result=0
    else:
     data=(thread_description or '').encode('utf-16le')+b'\0\0';allocation=local_next;local_next+=(len(data)+15)&~15
     assert local_next<=local_heap+local_heap_size
     uc.mem_write(allocation,data);local_allocations[allocation]=len(data);uc.mem_write(p,struct.pack('<Q',allocation));result=0
   host_calls.append(call);sp=uc.reg_read(x.UC_X86_REG_RSP);ret=int.from_bytes(uc.mem_read(sp,8),'little')
   uc.reg_write(x.UC_X86_REG_RAX,result);uc.reg_write(x.UC_X86_REG_RSP,sp+8);uc.reg_write(x.UC_X86_REG_RIP,ret);uc.emu_stop();return
  if name in ['kernel32.dll!getmodulehandlea','kernel32.dll!getmodulehandlew','kernel32.dll!getprocaddress']:
   call={'address':hex(pc),'name':imports[pc]};arg=uc.reg_read(x.UC_X86_REG_RCX)
   try:
    if name.endswith('getprocaddress'):
     p=uc.reg_read(x.UC_X86_REG_RDX);symbol=p if p<=65535 else read_ansi(p);call['symbol']=symbol
     result=resolve_export(modules,uc.mem_read,arg,symbol)
     if not result:last_error=127;uc.mem_write(tib+0x68,struct.pack('<I',last_error))
    else:
     text=(read_wide(arg) if name.endswith('w') else read_ansi(arg)) if arg else None
     call['module']=text;result=module_handle(modules,text)
   except RuntimeError as error:
    stop.update(reason=str(error).split(':')[0],detail=str(error),importName=imports[pc],address=hex(pc),**{k:v for k,v in call.items() if k not in ['name','address']});uc.emu_stop();return
   call['result']=hex(result);host_calls.append(call)
   sp=uc.reg_read(x.UC_X86_REG_RSP);ret=int.from_bytes(uc.mem_read(sp,8),'little')
   uc.reg_write(x.UC_X86_REG_RAX,result);uc.reg_write(x.UC_X86_REG_RSP,sp+8);uc.reg_write(x.UC_X86_REG_RIP,ret);uc.emu_stop();return
  if name in ['kernel32.dll!getsysteminfo','kernel32.dll!getnativesysteminfo']:
   p=uc.reg_read(x.UC_X86_REG_RCX)
   data=struct.pack('<HHIQQQIIIHH',9,0,4096,65536,0xffffffff,1,1,8664,65536,6,0);uc.mem_write(p,data)
   sp=uc.reg_read(x.UC_X86_REG_RSP);ret=int.from_bytes(uc.mem_read(sp,8),'little')
   host_calls.append({'address':hex(pc),'name':imports[pc],'output':hex(p)})
   uc.reg_write(x.UC_X86_REG_RSP,sp+8);uc.reg_write(x.UC_X86_REG_RIP,ret);uc.emu_stop();return
  if name=='ntdll.dll!rtlgetversion':
   p=uc.reg_read(x.UC_X86_REG_RCX);length=int.from_bytes(uc.mem_read(p,4),'little');result=0
   if length not in [276,284]:result=0xc000000d
   else:
    data=bytearray(length);struct.pack_into('<IIIII',data,0,length,windows_profile['major'],windows_profile['minor'],windows_profile['build'],windows_profile['platform'])
    if length==284:data[282]=windows_profile['productType']
    uc.mem_write(p,bytes(data))
   sp=uc.reg_read(x.UC_X86_REG_RSP);ret=int.from_bytes(uc.mem_read(sp,8),'little')
   host_calls.append({'address':hex(pc),'name':imports[pc],'structureSize':length})
   uc.reg_write(x.UC_X86_REG_RAX,result);uc.reg_write(x.UC_X86_REG_RSP,sp+8);uc.reg_write(x.UC_X86_REG_RIP,ret);uc.emu_stop();return
  if name in ['kernel32.dll!wakeallconditionvariable','kernel32.dll!wakeconditionvariable','kernel32.dll!initializeconditionvariable']:
   p=uc.reg_read(x.UC_X86_REG_RCX);assert p and int.from_bytes(uc.mem_read(p,8),'little')==0
   sp=uc.reg_read(x.UC_X86_REG_RSP);ret=int.from_bytes(uc.mem_read(sp,8),'little')
   host_calls.append({'address':hex(pc),'name':imports[pc],'condition':hex(p)})
   uc.reg_write(x.UC_X86_REG_RSP,sp+8);uc.reg_write(x.UC_X86_REG_RIP,ret);uc.emu_stop();return
  if name.split('!')[-1] in ['initializesrwlock','acquiresrwlockexclusive','releasesrwlockexclusive','tryacquiresrwlockexclusive','acquiresrwlockshared','releasesrwlockshared','tryacquiresrwlockshared']:
   p=uc.reg_read(x.UC_X86_REG_RCX);operation=name.split('!')[-1];state=srw_states.setdefault(p,{'writer':None,'readers':set()});thread=1;result=None
   shared=operation.endswith('shared');trying=operation.startswith('tryacquire')
   if operation=='initializesrwlock':assert state['writer'] is None and not state['readers']
   elif operation.startswith('release'):
    if shared:assert thread in state['readers'];state['readers'].remove(thread)
    else:assert state['writer']==thread;state['writer']=None
   else:
    unavailable=state['writer'] is not None or (not shared and bool(state['readers']))
    if unavailable:
     if not trying:stop.update(reason='UNSUPPORTED_SRW_CONTENTION',address=hex(pc));uc.emu_stop();return
     result=0
    else:
     if shared:assert thread not in state['readers'];state['readers'].add(thread)
     else:state['writer']=thread
     if trying:result=1
   word=1 if state['writer'] is not None else len(state['readers'])*16+1 if state['readers'] else 0
   uc.mem_write(p,struct.pack('<Q',word));sp=uc.reg_read(x.UC_X86_REG_RSP);ret=int.from_bytes(uc.mem_read(sp,8),'little')
   host_calls.append({'address':hex(pc),'name':imports[pc],'lock':hex(p)})
   if result is not None:uc.reg_write(x.UC_X86_REG_RAX,result)
   uc.reg_write(x.UC_X86_REG_RSP,sp+8);uc.reg_write(x.UC_X86_REG_RIP,ret);uc.emu_stop();return
  if name in ['kernel32.dll!getenvironmentvariablew','kernel32.dll!getlasterror','kernel32.dll!setlasterror']:
   call={'address':hex(pc),'name':imports[pc]};result=None
   if name.endswith('getenvironmentvariablew'):
    key=read_wide(uc.reg_read(x.UC_X86_REG_RCX));value=environment.get(key.upper());call['variable']=key
    if value is None:last_error=203;uc.mem_write(tib+0x68,struct.pack('<I',last_error));result=0
    else:
     encoded=value.encode('utf-16le');capacity=uc.reg_read(x.UC_X86_REG_R8)&0xffffffff
     result=len(encoded)//2+1
     if capacity>=result:uc.mem_write(uc.reg_read(x.UC_X86_REG_RDX),encoded+b'\0\0');result-=1
   elif name.endswith('getlasterror'):result=last_error
   else:last_error=uc.reg_read(x.UC_X86_REG_RCX)&0xffffffff;uc.mem_write(tib+0x68,struct.pack('<I',last_error))
   sp=uc.reg_read(x.UC_X86_REG_RSP);ret=int.from_bytes(uc.mem_read(sp,8),'little');host_calls.append(call)
   if result is not None:uc.reg_write(x.UC_X86_REG_RAX,result)
   uc.reg_write(x.UC_X86_REG_RSP,sp+8);uc.reg_write(x.UC_X86_REG_RIP,ret);uc.emu_stop();return
  if name=='api-ms-win-crt-runtime-l1-1-0.dll!_register_onexit_function':
   p=uc.reg_read(x.UC_X86_REG_RCX);fn=uc.reg_read(x.UC_X86_REG_RDX);result=0
   if not p:result=0xffffffff
   else:
    first,last,end=struct.unpack('<QQQ',uc.mem_read(p,24));assert first<=last<=end and (last-first)%8==0
    if last==end:
     count=(last-first)//8;capacity=max(8,count*2+1);size_bytes=capacity*8
     if capacity>10000 or next_allocation+size_bytes>arena+arena_size:result=0xffffffff
     else:
      old=bytes(uc.mem_read(first,count*8)) if count else b''
      first=next_allocation;last=first+count*8;end=first+size_bytes;next_allocation=end
      uc.mem_write(first,b'\0'*size_bytes)
      if old:uc.mem_write(first,old)
    if not result:uc.mem_write(last,struct.pack('<Q',fn));last+=8;uc.mem_write(p,struct.pack('<QQQ',first,last,end))
   sp=uc.reg_read(x.UC_X86_REG_RSP);ret=int.from_bytes(uc.mem_read(sp,8),'little')
   host_calls.append({'address':hex(pc),'name':imports[pc],'table':hex(p),'function':hex(fn)})
   uc.reg_write(x.UC_X86_REG_RAX,result);uc.reg_write(x.UC_X86_REG_RSP,sp+8);uc.reg_write(x.UC_X86_REG_RIP,ret)
   uc.emu_stop();return
  if name in ['api-ms-win-crt-runtime-l1-1-0.dll!_initterm_e','api-ms-win-crt-runtime-l1-1-0.dll!_initterm']:
   first=uc.reg_read(x.UC_X86_REG_RCX);end=uc.reg_read(x.UC_X86_REG_RDX);sp=uc.reg_read(x.UC_X86_REG_RSP)
   assert first<=end and first%8==0 and end%8==0 and end-first<=80000
   host_calls.append({'address':hex(pc),'name':imports[pc],'first':hex(first),'end':hex(end)})
   f={'next':first,'end':end,'sp':sp,'ret':int.from_bytes(uc.mem_read(sp,8),'little'),'error':name.endswith('_initterm_e'),'sentinel':0x71000000+len(initializer_frames)*16}
   initializer_frames.append(f);advance_initializer();uc.emu_stop();return
  if name=='kernel32.dll!initializeslisthead':
   p=uc.reg_read(x.UC_X86_REG_RCX);assert p%16==0
   uc.mem_write(p,b'\0'*16)
   sp=uc.reg_read(x.UC_X86_REG_RSP);ret=int.from_bytes(uc.mem_read(sp,8),'little')
   host_calls.append({'address':hex(pc),'name':imports[pc],'head':hex(p)})
   uc.reg_write(x.UC_X86_REG_RSP,sp+8);uc.reg_write(x.UC_X86_REG_RIP,ret)
   uc.emu_stop();return
  if name=='api-ms-win-crt-runtime-l1-1-0.dll!_initialize_onexit_table':
   p=uc.reg_read(x.UC_X86_REG_RCX);result=0
   if p==0:result=0xffffffff
   else:
    values=struct.unpack('<QQQ',uc.mem_read(p,24))
    if values[0]==values[2]:uc.mem_write(p,b'\0'*24)
   sp=uc.reg_read(x.UC_X86_REG_RSP);ret=int.from_bytes(uc.mem_read(sp,8),'little')
   host_calls.append({'address':hex(pc),'name':imports[pc],'table':hex(p)})
   uc.reg_write(x.UC_X86_REG_RAX,result);uc.reg_write(x.UC_X86_REG_RSP,sp+8);uc.reg_write(x.UC_X86_REG_RIP,ret)
   uc.emu_stop();return
  if name in ['kernel32.dll!getcurrentprocess','kernel32.dll!getcurrentprocessid','kernel32.dll!queryperformancecounter','kernel32.dll!queryperformancefrequency']:
   call={'address':hex(pc),'name':imports[pc]}
   result=1
   if name.endswith('getcurrentprocess'):result=0xffffffffffffffff
   elif name.endswith('getcurrentprocessid'):call['processId']=1
   else:
    value=time.perf_counter_ns() if name.endswith('queryperformancecounter') else 1000000000
    output=uc.reg_read(x.UC_X86_REG_RCX);uc.mem_write(output,struct.pack('<Q',value))
    call.update(counter=str(value),output=hex(output))
   sp=uc.reg_read(x.UC_X86_REG_RSP);ret=int.from_bytes(uc.mem_read(sp,8),'little')
   uc.reg_write(x.UC_X86_REG_RAX,result);uc.reg_write(x.UC_X86_REG_RSP,sp+8);uc.reg_write(x.UC_X86_REG_RIP,ret)
   host_calls.append(call);uc.emu_stop();return
  stop.update(reason='WINDOWS_IMPORT_REQUIRED',importName=imports[pc],address=hex(pc));uc.emu_stop();return
 if len(trace)>=10000:stop.update(reason='INSTRUCTION_LIMIT');uc.emu_stop();return
 trace.append(pc)
 if bytes(uc.mem_read(pc,2))==b'\x0f\xa2':
  leaf=uc.reg_read(x.UC_X86_REG_EAX);subleaf=uc.reg_read(x.UC_X86_REG_ECX)
  values=profile['leaves'].get(str(leaf),[0,0,0,0])
  for reg,value in zip([x.UC_X86_REG_RAX,x.UC_X86_REG_RBX,x.UC_X86_REG_RCX,x.UC_X86_REG_RDX],values):uc.reg_write(reg,value)
  cpu_calls.append({'pc':hex(pc),'leaf':leaf,'subleaf':subleaf,'results':values})
  uc.reg_write(x.UC_X86_REG_RIP,pc+2);uc.emu_stop();return
def memory_error(uc,access,address,size,value,_):
 stop.update(reason='UNMAPPED_MEMORY',address=hex(address),access=access,instruction=hex(uc.reg_read(x.UC_X86_REG_RIP)));return False
uc.hook_add(unicorn.UC_HOOK_CODE,code);uc.hook_add(unicorn.UC_HOOK_MEM_INVALID,memory_error)
uc.hook_add(unicorn.UC_HOOK_MEM_READ,lambda uc,access,address,size,value,data:tib_reads.append((address-tib,size)),begin=tib,end=tib+tib_size-1)
entry=bootstrap
try:
 resume=entry
 for attempt in range(4096):
  count_before=(len(host_calls),len(cpu_calls),len(control_events))
  uc.emu_start(resume,0x1234fedc,count=10001)
  if stop or (len(host_calls),len(cpu_calls),len(control_events))==count_before:break
  resume=uc.reg_read(x.UC_X86_REG_RIP)
 else:stop['reason']='HOST_CALL_LIMIT'
except unicorn.UcError as error:stop.setdefault('error',str(error))
if not stop:stop['reason']='ENTRYPOINT_RETURNED'
if stop.get('importName','').lower() in ['kernel32.dll!getmodulehandlea','kernel32.dll!loadlibraryexa','kernel32.dll!loadlibrarya']:
 p=uc.reg_read(x.UC_X86_REG_RCX);text=bytearray()
 if p:
  for i in range(32768):
   value=bytes(uc.mem_read(p+i,1))
   if value==b'\0':break
   text+=value
 stop['requestedModule']=text.decode('latin1') if p else None
 if stop['importName'].lower().endswith('loadlibraryexa'):stop.update(flags=hex(uc.reg_read(x.UC_X86_REG_R8)),file=hex(uc.reg_read(x.UC_X86_REG_RDX)))
if stop.get('reason')=='UNMAPPED_MEMORY' and trace and trace[-1]==uc.reg_read(x.UC_X86_REG_RIP):trace.pop()
lifter=Lifter(pe,10000,allow_indirect=True,yield_unknown=True,single_threaded=True,wide_mode=True);blocked=None;translated=0
if cocos:lifter.allowed_images.append((cocos['base'],cocos['base']+cocos['size']))
for pc in dict.fromkeys(trace):
 data=bytes(uc.mem_read(pc,32));ins=lifter.ctx.disassemble(data,base_address=pc,max_instructions=1).instructions[0]
 ops=lifter.ctx.translate(data[:ins.length],base_address=pc,max_instructions=1).ops
 lifter.current_instruction=ins
 try:
  lifter.prepare_uniques(ops)
  if ins.mnem=='CPUID':
   code=['switch((uint32_t)raw_read(cpu,8u)){']
   for leaf,values in profile['leaves'].items():
    code.append(f'case {leaf}u:')
    for offset,value in zip([0,24,8,16],values):code.append(f'raw_write(cpu+{offset}u,UINT64_C({value}),8u);')
    code.append('break;')
   code.append('default:')
   for offset in [0,24,8,16]:code.append(f'raw_write(cpu+{offset}u,0,8u);')
   code.append('break;}')
   lifter.instruction_overrides[pc]='\n'.join(code);lifter.blocks[pc]=(ins,ops,[]);translated+=1;continue
  emitted=[]
  for n,op in enumerate(ops):emitted.append(lifter.emit_op(op,n,len(ops)))
  lifter.blocks[pc]=(ins,ops,emitted)
  translated+=1
 except LiftError as error:
  blocked={'instruction':str(ins),'reason':str(error),'pcode':str(op)};break
generation_id=str(uuid.uuid4())
report={'status':'DLL_STARTUP_BLOCKED','generationId':generation_id,'dllSha256':PIN,'entry':hex(entry),
 'originalX64InstructionsExecuted':len(trace),'uniqueInstructionsReached':len(set(trace)),
 'firstRuntimeDependency':stop,'reachedInstructionsSupportedBeforeBlock':translated,
 'firstTranslationBlocker':blocked,'wasmStartupExecuted':False,'windowsImportsExecuted':False,
 'guestThreadModel':'single registered main context','hostCalls':host_calls,'cpuCalls':cpu_calls,'cpuProfile':profile,
 'tibBase':tib,'tlsCallbacksExecuted':False,'fullGeodeLoader':False,'existingGeodePackagesSupported':False}
report['initializerEvents']=initializer_events
report['guestModules']=modules
report['dependencyImageInstructions']=sum(cocos['base']<=pc<cocos['base']+cocos['size'] for pc in trace) if cocos else 0
report['dependencyLoadEvents']=load_events
report['dependencyLoadInProgress']=load_frame is not None
report['nativeExportChecks']=[{'name':symbol.name.decode(),'ordinal':symbol.ordinal,'address':base+symbol.address,'module':base} for symbol in pe.DIRECTORY_ENTRY_EXPORT.symbols[::600] if symbol.name and not symbol.forwarder]
if cocos:report['nativeExportChecks'] += [{'name':symbol.name.decode(),'ordinal':symbol.ordinal,'address':cocos['base']+symbol.address,'module':cocos['base']} for symbol in cocos_pe.DIRECTORY_ENTRY_EXPORT.symbols[::1000] if symbol.name and not symbol.forwarder]
report['threadDescription']=thread_description
report['localAllocations']=local_allocations
report['crtHeap']={'base':heap.base,'size':heap.size,'errno':heap.errno,'allocations':heap.allocations,'freeBlocks':heap.available,'calls':heap.calls}
report['resolvedExports']=[c for c in host_calls if c['name'].lower().endswith('!getprocaddress')]
report['windowsCompatibilityProfile']=windows_profile
report['tibReads']=sorted(set(tib_reads))
known_tib_fields=[(8,24),(0x30,0x38),(0x58,0x60),(0x68,0x6c),(0x2000,0x2010)]
unknown_tib=[(offset,n) for offset,n in report['tibReads'] if not any(start<=offset and offset+n<=end for start,end in known_tib_fields)]
report['unmodeledTibReads']=unknown_tib
report.update(originalDllInstructionsExecuted=sum(base<=pc<base+size for pc in trace),loaderBootstrapInstructions=sum(bootstrap<=pc<bootstrap+4096 for pc in trace),
 tlsTemplateBytes=tls_end-tls_start,tlsZeroFillBytes=tls_zero,tlsCallbacksScheduled=len(callbacks),tlsCallbacksCompleted=len(completed_tls),
 tlsCallbacksExecuted=bool(completed_tls),tibSize=tib_size)
if len(sys.argv)>2 and not blocked and not unknown_tib:
 out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
 for module_base,module_image in module_images.items():
  (out/f'module-{module_base:x}.bin').write_bytes(module_image)
  (out/f'module-{module_base:x}-after.bin').write_bytes(bytes(uc.mem_read(module_base,len(module_image))))
 (out/'startup.c').write_text(lifter.source());(out/'image.bin').write_bytes(initial_image)
 (out/'stack.bin').write_bytes(bytes(uc.mem_read(0x200000,0x100000)))
 (out/'tib.bin').write_bytes(initial_tib)
 (out/'tib-after.bin').write_bytes(bytes(uc.mem_read(tib,tib_size)))
 (out/'tls.bin').write_bytes(initial_tls);(out/'tls-after.bin').write_bytes(bytes(uc.mem_read(tls_block,tls_size)))
 (out/'image-after.bin').write_bytes(bytes(uc.mem_read(base,size)))
 if cocos:(out/'dependency-tls-after.bin').write_bytes(bytes(uc.mem_read(cocos['tls']['base'],cocos['tls']['size'])))
 (out/'crt-heap-after.bin').write_bytes(bytes(uc.mem_read(heap.base,heap.size)))
 (out/'errno-after.bin').write_bytes(bytes(uc.mem_read(heap.errno,0x10000)))
 (out/'local-heap-after.bin').write_bytes(bytes(uc.mem_read(local_heap,local_heap_size)))
 (out/'arena-after.bin').write_bytes(bytes(uc.mem_read(arena,arena_size)))
 names=['RAX','RCX','RDX','RBX','RSP','RBP','RSI','RDI','R8','R9','R10','R11','R12','R13','R14','R15']
 (out/'expected.json').write_text(json.dumps({'generationId':generation_id,'entry':entry,'base':base,'stop':uc.reg_read(x.UC_X86_REG_RIP),
  'instructions':len(trace),'hostCalls':host_calls,'tibBase':tib,'tibSize':tib_size,'tlsBase':tls_block,'tlsSize':tls_size,
  'modules':[{**m,'initialized':False} if m.get('tls') else m for m in modules],'moduleGateways':{hex(k):v for k,v in module_gateways.items()},
  'bootstrap':bootstrap,'loaderHex':loader.hex(),
  'mxcsr':{'offset':lifter.reg_offset(lifter.ctx.registers['MXCSR']),'value':uc.reg_read(x.UC_X86_REG_MXCSR)},
  'xmm':[hex(uc.reg_read(getattr(x,f'UC_X86_REG_XMM{i}'))) for i in range(16)],
  'flags':{name:{'offset':2048+lifter.ctx.registers[name].offset,'value':(uc.reg_read(x.UC_X86_REG_EFLAGS)>>bit)&1} for name,bit in [('CF',0),('PF',2),('ZF',6),('SF',7),('OF',11)]},
  'registers':[hex(uc.reg_read(getattr(x,'UC_X86_REG_'+name))) for name in names]}))
print(json.dumps(report,indent=2))
