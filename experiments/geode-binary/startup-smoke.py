#!/usr/bin/env python3
"""Bare DLL entrypoint probe. Stops at the first required Windows import.

Unicorn executes original relocated x64 bytes; the reached instructions are
then checked against the current binary translator. No API success is faked.
PE TLS callbacks and a bounded loader model precede the entrypoint.
"""
import sys,json,hashlib,struct,time,uuid,os,math,secrets
from pathlib import Path
import pefile,pypcode,unicorn
from unicorn import x86_const as x
from lift import PIN,Lifter,LiftError
from guest_modules import build_modules,module_handle,resolve_export,mapped_pe,load_system_contract
from guest_heap import GuestHeap
from guest_critical_sections import CriticalSections
from guest_crt_runtime import CrtRuntime
from guest_fls import FiberLocalStorage
from guest_slist import SLists
from guest_windows_time import systemtime_ticks
from guest_windows_text import convert_utf8
from guest_windows_paths import full_path
from guest_directories import GuestDirectories
from executable_memory import ExecutableMemory,BASE as EXECUTABLE_BASE,SIZE as EXECUTABLE_SIZE
from native_fmod_bridge import provider as fmod_provider,OwnedBridgeWriteRequired
from code_protection import CodeProtection
from native_fp_reference import NativeFpReference

trace_limit=int(os.environ.get('GEODE_INSTRUCTION_LIMIT','20000'));assert 1<=trace_limit<=5000000
stop_before_path=os.environ.get('GEODE_STOP_BEFORE_IMPORT_READ');stop_before=json.loads(Path(stop_before_path).read_text())['firstRuntimeDependency'] if stop_before_path else None
stop_before_hits=0;import_memory_reads=[]
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
primary=None;primary_path=os.environ.get('GEODE_PRIMARY_IMG')
if primary_path:
 from fetch_primary_image import PIN as primary_pin
 raw=Path(primary_path).read_bytes();assert hashlib.sha256(raw).hexdigest()==primary_pin
 primary_pe=mapped_pe(raw);primary_base=0x8000000;old_base=0x400000
 assert len(raw)==primary_pe.OPTIONAL_HEADER.SizeOfImage and primary_pe.FILE_HEADER.Machine==0x8664
 relocated=bytearray(raw);relocation_count=0
 for block in primary_pe.DIRECTORY_ENTRY_BASERELOC:
  for relocation in block.entries:
   if relocation.type==0:continue
   assert relocation.type==10;value=struct.unpack_from('<Q',relocated,relocation.rva)[0]
   assert old_base<=value<old_base+len(raw),'Unexpected already-rebased primary pointer'
   struct.pack_into('<Q',relocated,relocation.rva,value+primary_base-old_base);relocation_count+=1
 primary_pe=mapped_pe(relocated);uc.mem_map(primary_base,len(relocated));uc.mem_write(primary_base,bytes(relocated))
 cocos_exports={symbol.name:0x10000000+symbol.address for symbol in cocos_pe.DIRECTORY_ENTRY_EXPORT.symbols if symbol.name and not symbol.forwarder} if cocos else {}
 primary_cocos_bindings=0
 for desc in primary_pe.DIRECTORY_ENTRY_IMPORT:
  for imp in desc.imports:
   name=desc.dll.decode()+'!'+(imp.name.decode() if imp.name else '#'+str(imp.ordinal))
   if desc.dll.decode().lower()=='libcocos2d.dll' and imp.name in cocos_exports:target=cocos_exports[imp.name];primary_cocos_bindings+=1
   else:
    target=next((p for p,n in imports.items() if n.lower()==name.lower()),None)
    if target is None:target=0x70000000+i*16;i+=1;assert target<0x70010000;imports[target]=name
   uc.mem_write(primary_base+imp.address-primary_pe.OPTIONAL_HEADER.ImageBase,struct.pack('<Q',target))
 primary={'name':'GeometryDash.exe','base':primary_base,'size':len(raw),'complete':True,'shim':False,'primary':True,
  'sha256':primary_pin,'sourceGuestBase':old_base,'relocationsApplied':relocation_count,'cocosImportsBound':primary_cocos_bindings,
  'staticTls':bool(primary_pe.OPTIONAL_HEADER.DATA_DIRECTORY[9].VirtualAddress),'primaryEntrypointExecuted':False}
 if primary['staticTls']:
  t=primary_pe.DIRECTORY_ENTRY_TLS.struct;start=t.StartAddressOfRawData-primary_base;end=t.EndAddressOfRawData-primary_base
  template=bytes(relocated[start:end]);assert len(template)+t.SizeOfZeroFill<=65536
  uc.mem_map(0xe00000,65536);uc.mem_write(0xe00000,template);uc.mem_write(t.AddressOfIndex,struct.pack('<I',2))
  primary['primaryTls']={'base':0xe00000,'size':65536,'index':2,'templateBytes':len(template),'callbacksExecuted':False}
 modules.append(primary);module_images[primary_base]=bytes(uc.mem_read(primary_base,len(raw)))
msvc=None;msvc_path=os.environ.get('GEODE_MSVCP_DLL');msvc_boot=os.environ.get('GEODE_MSVCP_BOOT','');assert msvc_boot in ['', '1','only']
if msvc_path:
 from fetch_msvc_slice import PIN as msvc_pin
 msvc_bytes=Path(msvc_path).read_bytes();assert hashlib.sha256(msvc_bytes).hexdigest()==msvc_pin
 msvc_pe=pefile.PE(data=msvc_bytes);msvc_base=0x12000000;msvc_preferred=msvc_pe.OPTIONAL_HEADER.ImageBase
 mapped=bytearray(msvc_pe.get_memory_mapped_image());msvc_size=msvc_pe.OPTIONAL_HEADER.SizeOfImage
 assert len(mapped)<=msvc_size;mapped.extend(bytes(msvc_size-len(mapped)))
 for block in msvc_pe.DIRECTORY_ENTRY_BASERELOC:
  for relocation in block.entries:
   if relocation.type==0:continue
   assert relocation.type==10;value=struct.unpack_from('<Q',mapped,relocation.rva)[0]
   assert msvc_preferred<=value<msvc_preferred+msvc_size
   struct.pack_into('<Q',mapped,relocation.rva,value+msvc_base-msvc_preferred)
 if msvc_boot:
  for desc in msvc_pe.DIRECTORY_ENTRY_IMPORT:
   for imp in desc.imports:
    name=desc.dll.decode()+'!'+(imp.name.decode() if imp.name else '#'+str(imp.ordinal))
    target=next((address for address,existing in imports.items() if existing.lower()==name.lower()),None)
    if target is None:target=0x70000000+i*16;i+=1;assert target<0x70010000;imports[target]=name
    struct.pack_into('<Q',mapped,imp.address-msvc_preferred,target)
 ctor_name='??0ios_base@std@@IEAA@XZ';symbol=next(s for s in msvc_pe.DIRECTORY_ENTRY_EXPORT.symbols if s.name==ctor_name.encode())
 assert symbol.address==0x4930 and mapped[0x495e]==0xc3
 uc.mem_map(msvc_base,msvc_size);uc.mem_write(msvc_base,bytes(mapped))
 bound=0
 for desc in pe.DIRECTORY_ENTRY_IMPORT:
  if desc.dll.decode().lower()!='msvcp140.dll':continue
  for imp in desc.imports:
   target_symbol=next((s for s in msvc_pe.DIRECTORY_ENTRY_EXPORT.symbols if s.name==imp.name and not s.forwarder),None) if msvc_boot else symbol if imp.name==ctor_name.encode() else None
   if target_symbol:uc.mem_write(imp.address-preferred+base,struct.pack('<Q',msvc_base+target_symbol.address));bound+=int(imp.name==ctor_name.encode())
 assert bound==1
 msvc={'name':'MSVCP140.dll','base':msvc_base,'size':msvc_size,'complete':True,'shim':False,'sliceOnly':not bool(msvc_boot),'initializing':bool(msvc_boot),
  'runtimeInitialized':False,'entry':msvc_base+msvc_pe.OPTIONAL_HEADER.AddressOfEntryPoint,'sha256':msvc_pin,'constructor':msvc_base+0x4930,'constructorEnd':msvc_base+0x495f,
  'constructorExport':ctor_name,'constructorOrdinal':symbol.ordinal,'constructorBytesSha256':hashlib.sha256(mapped[0x4930:0x495f]).hexdigest()}
 modules.append(msvc);module_images[msvc_base]=bytes(mapped)
vcruntime=None;vcruntime_path=os.environ.get('GEODE_VCRUNTIME_DLL');vcruntime_only=os.environ.get('GEODE_VCRUNTIME_ONLY','');assert vcruntime_only in ['', '1']
if vcruntime_only:assert vcruntime_path,'VCRUNTIME-only mode requires the pinned DLL'
if vcruntime_path:
 from fetch_vcruntime import PIN as vcruntime_pin
 raw=Path(vcruntime_path).read_bytes();assert hashlib.sha256(raw).hexdigest()==vcruntime_pin
 runtime_pe=pefile.PE(data=raw);runtime_base=0x13000000;runtime_preferred=runtime_pe.OPTIONAL_HEADER.ImageBase;runtime_size=runtime_pe.OPTIONAL_HEADER.SizeOfImage
 assert runtime_pe.FILE_HEADER.Machine==0x8664 and not runtime_pe.OPTIONAL_HEADER.DATA_DIRECTORY[9].VirtualAddress
 mapped=bytearray(runtime_pe.get_memory_mapped_image());mapped.extend(bytes(runtime_size-len(mapped)))
 for block in runtime_pe.DIRECTORY_ENTRY_BASERELOC:
  for relocation in block.entries:
   if relocation.type==0:continue
   assert relocation.type==10;value=struct.unpack_from('<Q',mapped,relocation.rva)[0]
   assert runtime_preferred<=value<runtime_preferred+runtime_size
   struct.pack_into('<Q',mapped,relocation.rva,value+runtime_base-runtime_preferred)
 for desc in runtime_pe.DIRECTORY_ENTRY_IMPORT:
  for imp in desc.imports:
   name=desc.dll.decode()+'!'+(imp.name.decode() if imp.name else '#'+str(imp.ordinal))
   target=next((address for address,existing in imports.items() if existing.lower()==name.lower()),None)
   if target is None:target=0x70000000+i*16;i+=1;assert target<0x70010000;imports[target]=name
   struct.pack_into('<Q',mapped,imp.address-runtime_preferred,target)
 uc.mem_map(runtime_base,runtime_size);uc.mem_write(runtime_base,bytes(mapped))
 # Route only the actually required RTTI export. Other imports retain explicit providers or fail closed.
 names={symbol.name:runtime_base+symbol.address for symbol in runtime_pe.DIRECTORY_ENTRY_EXPORT.symbols if symbol.name and not symbol.forwarder}
 bound=0
 for client,client_base,client_preferred in [(pe,base,preferred)]+([(msvc_pe,msvc['base'],msvc_preferred)] if msvc and msvc_boot else []):
  for desc in client.DIRECTORY_ENTRY_IMPORT:
   if desc.dll.decode().lower()!='vcruntime140.dll':continue
   for imp in desc.imports:
    if imp.name==b'__std_type_info_name':
     uc.mem_write(client_base+imp.address-client_preferred,struct.pack('<Q',names[imp.name]));bound+=1
 if msvc:module_images[msvc['base']]=bytes(uc.mem_read(msvc['base'],msvc['size']))
 vcruntime={'name':'VCRUNTIME140.dll','base':runtime_base,'size':runtime_size,'complete':True,'shim':False,'initializing':True,'runtimeInitialized':False,
  'entry':runtime_base+runtime_pe.OPTIONAL_HEADER.AddressOfEntryPoint,'sha256':vcruntime_pin,'typeInfoAddress':names[b'__std_type_info_name'],'typeInfoBindings':bound,'staticTls':False}
 modules.append(vcruntime);module_images[runtime_base]=bytes(mapped)
fmod_code_reads=[];protected_code_regions=[];executable_memory=None
fmod=None;bridge_mode=os.environ.get('GEODE_FMOD_BRIDGE','');assert bridge_mode in ['', '1']
generated_mode=os.environ.get('GEODE_GENERATED_CODE','');assert generated_mode in ['', '1'];assert not generated_mode or bridge_mode
if bridge_mode:
 fmod,fmod_image=fmod_provider(imports);uc.mem_map(fmod['base'],fmod['size']);uc.mem_write(fmod['base'],fmod_image)
 modules.append(fmod);module_images[fmod['base']]=fmod_image;bindings=0
 clients=[(pe,base,preferred)]+([(primary_pe,primary['base'],primary_pe.OPTIONAL_HEADER.ImageBase)] if primary else [])
 for client,client_base,client_preferred in clients:
  for desc in client.DIRECTORY_ENTRY_IMPORT:
   if desc.dll.decode().lower()!='fmod.dll':continue
   for imp in desc.imports:
    if imp.name and imp.name.decode() in fmod['entries']:
     uc.mem_write(client_base+imp.address-client_preferred,struct.pack('<Q',fmod['entries'][imp.name.decode()]['address']));bindings+=1
 if primary:module_images[primary['base']]=bytes(uc.mem_read(primary['base'],primary['size']))
 fmod['bindings']=bindings;assert bindings>=1
 # Freeze executable sections until patch-to-dispatch invalidation is implemented.
 protected_code_regions=[(fmod['base'],fmod['base']+fmod['size'],fmod['name'])]
 for loaded in modules:
  if loaded is fmod:continue
  loaded_pe=mapped_pe(bytes(uc.mem_read(loaded['base'],loaded['size'])))
  for section in loaded_pe.sections:
   if section.Characteristics&0x20000000:
    start=loaded['base']+section.VirtualAddress;end=min(loaded['base']+loaded['size'],start+((max(section.Misc_VirtualSize,section.SizeOfRawData)+4095)&~4095))
    protected_code_regions.append((start,end,loaded['name']))
 for start,end,owner in protected_code_regions:uc.mem_protect(start,end-start,unicorn.UC_PROT_READ|unicorn.UC_PROT_EXEC)

protected_code_regions.append((0x70000000,0x70010000,'unresolved import gateways'))
uc.mem_protect(0x70000000,0x10000,unicorn.UC_PROT_READ|unicorn.UC_PROT_EXEC)
code_protection=CodeProtection(uc,protected_code_regions) if generated_mode else None
if code_protection:uc.hook_add(unicorn.UC_HOOK_MEM_WRITE,code_protection.observe)
instruction_bytes={}
original_mem_write=uc.mem_write
def guarded_mem_write(address,data):
 owner=next((owner for start,end,owner in protected_code_regions if len(data) and address<end and address+len(data)>start),None)
 if owner and not (code_protection and code_protection.writable(address,len(data))):
  pc=uc.reg_read(x.UC_X86_REG_RIP);occurrence=1+sum(int(call['address'],16)==pc for call in host_calls) if pc in imports else trace.count(pc)+1
  raise OwnedBridgeWriteRequired({'reason':'NATIVE_CODE_WRITE_REQUIRES_ROUTING','ownerModule':owner,'instructionPc':hex(pc),'occurrence':occurrence,'writeAddress':hex(address),'writeSize':len(data),'writeBytesHex':bytes(data[:128]).hex(),'writeBytesTruncated':len(data)>128,'hostApi':imports.get(pc)})
 original_mem_write(address,data)
uc.mem_write=guarded_mem_write
# Paths belong to this declared guest namespace; no host filesystem is implied.
for module in modules:
 directory='C:\\Windows\\System32\\' if module['name'].lower() in ['kernel32.dll','ntdll.dll','msvcp140.dll','vcruntime140.dll'] or module.get('systemContract') else 'C:\\WestminsterDash\\'
 module['path']=directory+module['name']
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
if primary and primary.get('primaryTls'):uc.mem_write(tib+0x2010,struct.pack('<Q',primary['primaryTls']['base']))
callbacks=[]
for i in range(64):
 target=int.from_bytes(uc.mem_read(tls_callbacks+i*8,8),'little')
 if not target:break
 callbacks.append(target)
else:raise RuntimeError('TLS callback table limit')
bootstrap=0x72000000;uc.mem_map(bootstrap,4096);loader=bytearray(bytes.fromhex('4883ec28'))
callback_returns={};module_boot_returns={};completed_boots=[]
isolated=bool(vcruntime_only or msvc_boot=='only')
run_callbacks=[] if isolated else callbacks
boot_modules=([vcruntime] if vcruntime else [])+([msvc] if msvc_boot and msvc and not vcruntime_only else [])
boot_targets=[module['entry'] for module in boot_modules]+run_callbacks+([] if isolated else [base+pe.OPTIONAL_HEADER.AddressOfEntryPoint])
for target in boot_targets:
 module=next((item for item in boot_modules if target==item['entry']),None)
 loader+=b'\x48\xb9'+struct.pack('<Q',module['base'] if module else base)+bytes.fromhex('ba010000004531c0')
 loader+=b'\x48\xb8'+struct.pack('<Q',target)+bytes.fromhex('ffd0')
 if module:module_boot_returns[bootstrap+len(loader)]=module
 if target in run_callbacks:callback_returns[bootstrap+len(loader)]=target
loader+=bytes.fromhex('4883c428c3');uc.mem_write(bootstrap,bytes(loader))
initial_image=bytes(uc.mem_read(base,size));initial_tib=bytes(uc.mem_read(tib,tib_size));initial_tls=bytes(uc.mem_read(tls_block,tls_size))
initial_primary_tls=bytes(uc.mem_read(primary['primaryTls']['base'],65536)) if primary and primary.get('primaryTls') else None
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
initial_modules=json.loads(json.dumps(modules));directories=GuestDirectories(modules)
trace=[];stop={};host_calls=[];cpu_calls=[]
native_fp=NativeFpReference();native_disasm=pypcode.Context('x86:LE:64:default');fp_instructions={}
uc.mem_map(0x71000000,4096)
arena=0x500000;arena_size=0x100000;uc.mem_map(arena,arena_size);next_allocation=arena
initializer_frames=[];initializer_events=[];control_events=[]
uc.mem_map(0x3400000,0x800000);uc.mem_map(0xc00000,0x10000)
heap=GuestHeap(uc.mem_read,uc.mem_write)
critical=CriticalSections(uc.mem_write)
uc.mem_map(0xf00000,65536);crt_runtime=CrtRuntime(uc.mem_write,uc.mem_read)
initial_crt_runtime=bytes(uc.mem_read(0xf00000,65536))
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
fls=FiberLocalStorage();slists=SLists(uc.mem_read,uc.mem_write)
last_error=0;environment={};thread_description=None
pointer_key=secrets.randbits(64) or 1;pointer_encodes=0;pointer_decodes=0
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
 global next_allocation,last_error,thread_description,local_next,load_frame,pointer_encodes,pointer_decodes,stop_before_hits,executable_memory
 if stop_before and pc==int(stop_before['instructionPc'],16):
  stop_before_hits+=1
  if stop_before_hits==stop_before['occurrence']:
   stop.update(stop_before);stop.pop('error',None);stop['stoppedBeforeInstruction']=True;uc.emu_stop();return
 if pc in module_boot_returns and pc not in completed_boots:
  module=module_boot_returns[pc]
  if uc.reg_read(x.UC_X86_REG_RAX)&0xffffffff==0:stop.update(reason='MODULE_ATTACH_FAILED_DETACH_REQUIRED',module=module['name']);uc.emu_stop();return
  assert uc.reg_read(x.UC_X86_REG_RSP)==0x2ffee0
  module['runtimeInitialized']=True;module['initializing']=False;completed_boots.append(pc);control_events.append(pc);uc.emu_stop();return
 if msvc and not msvc_boot and msvc['base']<=pc<msvc['base']+msvc['size'] and not msvc['constructor']<=pc<msvc['constructorEnd']:
  stop.update(reason='MSVCP_RUNTIME_INITIALIZATION_REQUIRED',address=hex(pc));uc.emu_stop();return
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
 if pc in imports and imports[pc].lower() in ['kernel32.dll!getsystemtimeasfiletime','kernel32.dll!getsystemtimepreciseasfiletime']:
  output=uc.reg_read(x.UC_X86_REG_RCX)
  precise=imports[pc].lower().endswith('preciseasfiletime');nanoseconds=time.time_ns() if precise else None
  timestamp=(nanoseconds+11644473600000000000)//100 if precise else (clock_ms+11644473600000)*10000
  uc.mem_write(output,struct.pack('<Q',timestamp))
  sp=uc.reg_read(x.UC_X86_REG_RSP);ret=int.from_bytes(uc.mem_read(sp,8),'little')
  host_calls.append({'address':hex(pc),'name':imports[pc],**({'unixNanoseconds':str(nanoseconds)} if precise else {'unixMilliseconds':clock_ms}),'output':hex(output)})
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
  if name=='kernel32.dll!systemtimetofiletime':
   fields=struct.unpack('<8H',uc.mem_read(uc.reg_read(x.UC_X86_REG_RCX),16));ticks=systemtime_ticks(fields);result=int(ticks is not None)
   if ticks is not None:uc.mem_write(uc.reg_read(x.UC_X86_REG_RDX),struct.pack('<Q',ticks))
   else:last_error=87;uc.mem_write(tib+0x68,struct.pack('<I',last_error))
   host_calls.append({'address':hex(pc),'name':imports[pc],'fields':list(fields),'ticks':hex(ticks) if ticks is not None else None});sp=uc.reg_read(x.UC_X86_REG_RSP);ret=int.from_bytes(uc.mem_read(sp,8),'little')
   uc.reg_write(x.UC_X86_REG_RAX,result);uc.reg_write(x.UC_X86_REG_RSP,sp+8);uc.reg_write(x.UC_X86_REG_RIP,ret);uc.emu_stop();return
  if name.split('!')[-1] in ['flsalloc','flsgetvalue','flssetvalue','flsfree']:
   try:result,error=fls.invoke(name,uc.reg_read(x.UC_X86_REG_RCX),uc.reg_read(x.UC_X86_REG_RDX))
   except RuntimeError as error:stop.update(reason=str(error),importName=imports[pc]);uc.emu_stop();return
   if error is not None:last_error=error;uc.mem_write(tib+0x68,struct.pack('<I',error))
   host_calls.append({'address':hex(pc),'name':imports[pc]});sp=uc.reg_read(x.UC_X86_REG_RSP);ret=int.from_bytes(uc.mem_read(sp,8),'little')
   uc.reg_write(x.UC_X86_REG_RAX,result);uc.reg_write(x.UC_X86_REG_RSP,sp+8);uc.reg_write(x.UC_X86_REG_RIP,ret);uc.emu_stop();return
  if name in ['kernel32.dll!encodepointer','kernel32.dll!decodepointer']:
   value=uc.reg_read(x.UC_X86_REG_RCX);mask=0xffffffffffffffff
   if name.endswith('encodepointer'):bits=value^pointer_key;result=((bits<<17)|(bits>>47))&mask;pointer_encodes+=1
   else:result=(((value>>17)|(value<<47))&mask)^pointer_key;pointer_decodes+=1
   host_calls.append({'address':hex(pc),'name':imports[pc]});sp=uc.reg_read(x.UC_X86_REG_RSP);ret=int.from_bytes(uc.mem_read(sp,8),'little')
   uc.reg_write(x.UC_X86_REG_RAX,result);uc.reg_write(x.UC_X86_REG_RSP,sp+8);uc.reg_write(x.UC_X86_REG_RIP,ret);uc.emu_stop();return
  if name.split('!')[-1] in ['__acrt_iob_func','_get_stream_buffer_pointers','_lock_file','_unlock_file','_crt_atexit','_set_new_handler','_lock_locales','_unlock_locales','setlocale','___lc_codepage_func','___lc_collate_cp_func','___mb_cur_max_func','___lc_locale_name_func','__pctype_func','localeconv','isspace','tolower','isalpha']:
   args=[uc.reg_read(register) for register in [x.UC_X86_REG_RCX,x.UC_X86_REG_RDX,x.UC_X86_REG_R8,x.UC_X86_REG_R9]]
   try:result=crt_runtime.invoke(name,*args)
   except RuntimeError as error:stop.update(reason=str(error),importName=imports[pc]);uc.emu_stop();return
   host_calls.append({'address':hex(pc),'name':imports[pc]});sp=uc.reg_read(x.UC_X86_REG_RSP);ret=int.from_bytes(uc.mem_read(sp,8),'little')
   if result is not None:uc.reg_write(x.UC_X86_REG_RAX,result)
   uc.reg_write(x.UC_X86_REG_RSP,sp+8);uc.reg_write(x.UC_X86_REG_RIP,ret);uc.emu_stop();return
  if name.startswith('kernel32.dll!') and name.split('!')[-1] in ['initializecriticalsection','initializecriticalsectionex','initializecriticalsectionandspincount','entercriticalsection','tryentercriticalsection','leavecriticalsection','deletecriticalsection']:
   p=uc.reg_read(x.UC_X86_REG_RCX);result=critical.invoke(name,p,uc.reg_read(x.UC_X86_REG_RDX)&0xffffffff,uc.reg_read(x.UC_X86_REG_R8)&0xffffffff)
   host_calls.append({'address':hex(pc),'name':imports[pc],'criticalSection':hex(p)});sp=uc.reg_read(x.UC_X86_REG_RSP);ret=int.from_bytes(uc.mem_read(sp,8),'little')
   if result is not None:uc.reg_write(x.UC_X86_REG_RAX,result)
   uc.reg_write(x.UC_X86_REG_RSP,sp+8);uc.reg_write(x.UC_X86_REG_RIP,ret);uc.emu_stop();return
  if name in ['kernel32.dll!gettemppathw','kernel32.dll!gettemppath2w']:
   path=environment.get('TMP') or environment.get('TEMP') or environment.get('USERPROFILE') or 'C:\\Windows\\'
   if not path.endswith('\\'):path+='\\'
   capacity=uc.reg_read(x.UC_X86_REG_RCX)&0xffffffff;data=path.encode('utf-16le');result=len(data)//2+1
   if capacity>=result:uc.mem_write(uc.reg_read(x.UC_X86_REG_RDX),data+b'\0\0');result-=1
   host_calls.append({'address':hex(pc),'name':imports[pc],'path':path});sp=uc.reg_read(x.UC_X86_REG_RSP);ret=int.from_bytes(uc.mem_read(sp,8),'little')
   uc.reg_write(x.UC_X86_REG_RAX,result);uc.reg_write(x.UC_X86_REG_RSP,sp+8);uc.reg_write(x.UC_X86_REG_RIP,ret);uc.emu_stop();return
  if name=='api-ms-win-crt-math-l1-1-0.dll!ceilf':
   xmm=uc.reg_read(x.UC_X86_REG_XMM0);bits=xmm&0xffffffff;value=struct.unpack('<f',struct.pack('<I',bits))[0]
   if not math.isfinite(value):stop.update(reason='UNMODELED_CRT_NONFINITE');uc.emu_stop();return
   rounded=math.ceil(value);result=struct.unpack('<I',struct.pack('<f',-0.0 if rounded==0 and bits>>31 else rounded))[0]
   uc.reg_write(x.UC_X86_REG_XMM0,(xmm&~0xffffffff)|result);host_calls.append({'address':hex(pc),'name':imports[pc],'inputBits':hex(bits),'outputBits':hex(result)})
   sp=uc.reg_read(x.UC_X86_REG_RSP);ret=int.from_bytes(uc.mem_read(sp,8),'little');uc.reg_write(x.UC_X86_REG_RSP,sp+8);uc.reg_write(x.UC_X86_REG_RIP,ret);uc.emu_stop();return
  if name=='kernel32.dll!disablethreadlibrarycalls':
   handle=uc.reg_read(x.UC_X86_REG_RCX);module=next((m for m in modules if m['base']==handle),None)
   if module is None:stop.update(reason='UNMODELED_MODULE_HANDLE',address=hex(handle));uc.emu_stop();return
   if module.get('staticTls'):result=0;last_error=126;uc.mem_write(tib+0x68,struct.pack('<I',last_error))
   else:result=1;module['threadCalloutsDisabled']=True
   host_calls.append({'address':hex(pc),'name':imports[pc],'module':hex(handle),'result':hex(result)});sp=uc.reg_read(x.UC_X86_REG_RSP);ret=int.from_bytes(uc.mem_read(sp,8),'little')
   uc.reg_write(x.UC_X86_REG_RAX,result);uc.reg_write(x.UC_X86_REG_RSP,sp+8);uc.reg_write(x.UC_X86_REG_RIP,ret);uc.emu_stop();return
  if (name.startswith('api-ms-win-crt-string-') or name.startswith('vcruntime140.dll!')) and name.split('!')[-1] in ['strlen','wcslen','memcpy','memmove','memset','memcmp','memchr','strcpy_s','strcmp']:
   symbol=name.split('!')[-1];a=uc.reg_read(x.UC_X86_REG_RCX);b=uc.reg_read(x.UC_X86_REG_RDX);n=uc.reg_read(x.UC_X86_REG_R8)
   if symbol=='strcmp':
    result=0
    for offset in range(0x800000):
     left,right=uc.mem_read(a+offset,1)[0],uc.mem_read(b+offset,1)[0]
     if left!=right:result=(left-right)&0xffffffff;break
     if not left:break
    else:raise RuntimeError('CRT unterminated string')
   elif symbol=='strcpy_s':
    if not a or not n or not 0<b<=0x800000:stop.update(reason='CRT_INVALID_PARAMETER_HANDLER_REQUIRED',importName=imports[pc]);uc.emu_stop();return
    data=bytearray()
    for offset in range(b):
     value=bytes(uc.mem_read(n+offset,1));data+=value
     if value==b'\0':break
    if data[-1:]!=b'\0':stop.update(reason='CRT_INVALID_PARAMETER_HANDLER_REQUIRED',importName=imports[pc]);uc.emu_stop();return
    if a<n+len(data) and n<a+len(data):stop.update(reason='CRT_STRING_OVERLAP_UNSUPPORTED',importName=imports[pc]);uc.emu_stop();return
    uc.mem_read(a,b);uc.mem_write(a,bytes(data));result=0
   elif symbol in ['strlen','wcslen']:
    result=0;width=2 if symbol=='wcslen' else 1
    while result<0x800000//width and int.from_bytes(uc.mem_read(a+result*width,width),'little')!=0:result+=1
    assert result<0x800000//width
   else:
    assert n<=0x800000;result=a
    if symbol=='memset':
     if n:uc.mem_write(a,bytes([b&255])*n)
    elif symbol=='memchr':
     found=bytes(uc.mem_read(a,n)).find(bytes([b&255])) if n else -1
     result=a+found if found>=0 else 0
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
  if name in ['kernel32.dll!widechartomultibyte','kernel32.dll!multibytetowidechar']:
   sp=uc.reg_read(x.UC_X86_REG_RSP);args=[uc.reg_read(r) for r in [x.UC_X86_REG_RCX,x.UC_X86_REG_RDX,x.UC_X86_REG_R8,x.UC_X86_REG_R9]]
   extra=struct.unpack('<4Q',uc.mem_read(sp+40,32)) if name.endswith('widechartomultibyte') else struct.unpack('<2Q',uc.mem_read(sp+40,16))
   try:result,error=convert_utf8(uc.mem_read,uc.mem_write,name,*args,*extra)
   except RuntimeError as error:stop.update(reason=str(error),importName=imports[pc]);uc.emu_stop();return
   if error is not None:last_error=error;uc.mem_write(tib+0x68,struct.pack('<I',last_error))
   host_calls.append({'address':hex(pc),'name':imports[pc],'codePage':args[0]&0xffffffff,'flags':args[1]&0xffffffff,'result':result})
   ret=int.from_bytes(uc.mem_read(sp,8),'little');uc.reg_write(x.UC_X86_REG_RAX,result);uc.reg_write(x.UC_X86_REG_RSP,sp+8);uc.reg_write(x.UC_X86_REG_RIP,ret);uc.emu_stop();return
  if name=='kernel32.dll!virtualalloc':
   if executable_memory is None:executable_memory=ExecutableMemory(uc,protected_code_regions,generated=bool(generated_mode))
   args=[uc.reg_read(r) for r in [x.UC_X86_REG_RCX,x.UC_X86_REG_RDX,x.UC_X86_REG_R8,x.UC_X86_REG_R9]]
   try:result,error=executable_memory.allocate(args[0],args[1],args[2]&0xffffffff,args[3]&0xffffffff)
   except RuntimeError as error:stop.update(reason=str(error),importName=imports[pc]);uc.emu_stop();return
   if error is not None:last_error=error;uc.mem_write(tib+0x68,struct.pack('<I',error))
   host_calls.append({'address':hex(pc),'name':imports[pc],'result':hex(result)});sp=uc.reg_read(x.UC_X86_REG_RSP);ret=int.from_bytes(uc.mem_read(sp,8),'little')
   uc.reg_write(x.UC_X86_REG_RAX,result);uc.reg_write(x.UC_X86_REG_RSP,sp+8);uc.reg_write(x.UC_X86_REG_RIP,ret);uc.emu_stop();return
  if name=='kernel32.dll!virtualprotectex' and code_protection:
   args=[uc.reg_read(r) for r in [x.UC_X86_REG_RCX,x.UC_X86_REG_RDX,x.UC_X86_REG_R8,x.UC_X86_REG_R9]];sp=uc.reg_read(x.UC_X86_REG_RSP);output=int.from_bytes(uc.mem_read(sp+40,8),'little')
   try:result,error=code_protection.protect(*args,output)
   except RuntimeError as error:stop.update(reason=str(error),importName=imports[pc]);uc.emu_stop();return
   if error is not None:last_error=error;uc.mem_write(tib+0x68,struct.pack('<I',error))
   host_calls.append({'address':hex(pc),'name':imports[pc],'result':result});ret=int.from_bytes(uc.mem_read(sp,8),'little')
   uc.reg_write(x.UC_X86_REG_RAX,result);uc.reg_write(x.UC_X86_REG_RSP,sp+8);uc.reg_write(x.UC_X86_REG_RIP,ret);uc.emu_stop();return
  if name in ['kernel32.dll!createfilew','kernel32.dll!getfinalpathnamebyhandlew','kernel32.dll!closehandle']:
   sp=uc.reg_read(x.UC_X86_REG_RSP);args=[uc.reg_read(r) for r in [x.UC_X86_REG_RCX,x.UC_X86_REG_RDX,x.UC_X86_REG_R8,x.UC_X86_REG_R9]];error=None
   try:
    if name.endswith('createfilew'):
     path=read_wide(args[0]);extra=struct.unpack('<3Q',uc.mem_read(sp+40,24));result,error=directories.open(path,args[1]&0xffffffff,args[2]&0xffffffff,args[3],extra[0]&0xffffffff,extra[1]&0xffffffff,extra[2])
    elif name.endswith('closehandle'):result,error=directories.close(args[0])
    else:
     path,error=directories.path(args[0],args[3]&0xffffffff);result=0
     if path is not None:
      data=path.encode('utf-16le','surrogatepass');length=len(data)//2;capacity=args[2]&0xffffffff;result=length+1
      if capacity>length:uc.mem_write(args[1],data+b'\0\0');result=length
   except RuntimeError as error:stop.update(reason=str(error),importName=imports[pc]);uc.emu_stop();return
   if error is not None:last_error=error;uc.mem_write(tib+0x68,struct.pack('<I',error))
   host_calls.append({'address':hex(pc),'name':imports[pc],'result':hex(result)});ret=int.from_bytes(uc.mem_read(sp,8),'little');uc.reg_write(x.UC_X86_REG_RAX,result);uc.reg_write(x.UC_X86_REG_RSP,sp+8);uc.reg_write(x.UC_X86_REG_RIP,ret);uc.emu_stop();return
  if name=='kernel32.dll!getfullpathnamew':
   value=read_wide(uc.reg_read(x.UC_X86_REG_RCX));capacity=uc.reg_read(x.UC_X86_REG_RDX)&0xffffffff;out=uc.reg_read(x.UC_X86_REG_R8);part=uc.reg_read(x.UC_X86_REG_R9)
   try:path=full_path(value)
   except RuntimeError as error:stop.update(reason=str(error),importName=imports[pc],path=value);uc.emu_stop();return
   data=path.encode('utf-16le','surrogatepass');length=len(data)//2;result=length+1
   if capacity>length:
    uc.mem_write(out,data+b'\0\0');result=length
    if part:uc.mem_write(part,struct.pack('<Q',0 if path.endswith('\\') else out+len(path[:path.rfind('\\')+1].encode('utf-16le','surrogatepass'))))
   host_calls.append({'address':hex(pc),'name':imports[pc],'path':path,'result':result});sp=uc.reg_read(x.UC_X86_REG_RSP);ret=int.from_bytes(uc.mem_read(sp,8),'little')
   uc.reg_write(x.UC_X86_REG_RAX,result);uc.reg_write(x.UC_X86_REG_RSP,sp+8);uc.reg_write(x.UC_X86_REG_RIP,ret);uc.emu_stop();return
  if name=='kernel32.dll!getmodulefilenamew':
   handle=uc.reg_read(x.UC_X86_REG_RCX);module=next((m for m in modules if m['base']==handle),None) if handle else next((m for m in modules if m.get('primary')),None)
   if module is None:stop.update(reason='UNMODELED_MODULE_HANDLE',importName=imports[pc]);uc.emu_stop();return
   out=uc.reg_read(x.UC_X86_REG_RDX);capacity=uc.reg_read(x.UC_X86_REG_R8)&0xffffffff;data=module['path'].encode('utf-16le');length=len(data)//2
   if capacity:
    copied=data[:max(0,capacity-1)*2]+b'\0\0';uc.mem_write(out,copied)
   result=min(length,capacity)
   if capacity<=length:last_error=122;uc.mem_write(tib+0x68,struct.pack('<I',last_error))
   host_calls.append({'address':hex(pc),'name':imports[pc],'module':module['name'],'result':hex(result)});sp=uc.reg_read(x.UC_X86_REG_RSP);ret=int.from_bytes(uc.mem_read(sp,8),'little')
   uc.reg_write(x.UC_X86_REG_RAX,result);uc.reg_write(x.UC_X86_REG_RSP,sp+8);uc.reg_write(x.UC_X86_REG_RIP,ret);uc.emu_stop();return
  if name=='kernel32.dll!loadlibraryexw':
   requested=read_wide(uc.reg_read(x.UC_X86_REG_RCX));flags=uc.reg_read(x.UC_X86_REG_R8)&0xffffffff;file=uc.reg_read(x.UC_X86_REG_RDX)
   try:result=load_system_contract(modules,requested,flags,file)
   except RuntimeError as error:stop.update(reason=str(error),importName=imports[pc]);uc.emu_stop();return
   host_calls.append({'address':hex(pc),'name':imports[pc],'module':requested,'result':hex(result)});sp=uc.reg_read(x.UC_X86_REG_RSP);ret=int.from_bytes(uc.mem_read(sp,8),'little')
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
  if name in ['kernel32.dll!getmodulehandlea','kernel32.dll!getmodulehandlew','kernel32.dll!getprocaddress','kernel32.dll!rtlpctofileheader','ntdll.dll!rtlpctofileheader']:
   call={'address':hex(pc),'name':imports[pc]};arg=uc.reg_read(x.UC_X86_REG_RCX)
   try:
    if name.endswith('getprocaddress'):
     p=uc.reg_read(x.UC_X86_REG_RDX);symbol=p if p<=65535 else read_ansi(p);call['symbol']=symbol
     result=resolve_export(modules,uc.mem_read,arg,symbol)
     if not result:last_error=127;uc.mem_write(tib+0x68,struct.pack('<I',last_error))
    elif name.endswith('rtlpctofileheader'):
     module=next((m for m in modules if m['base']<=arg<m['base']+m['size']),None);result=module['base'] if module else 0
     uc.mem_write(uc.reg_read(x.UC_X86_REG_RDX),struct.pack('<Q',result))
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
  if name in ['kernel32.dll!initializeslisthead','kernel32.dll!interlockedpushentryslist']:
   try:result=slists.invoke(name,uc.reg_read(x.UC_X86_REG_RCX),uc.reg_read(x.UC_X86_REG_RDX))
   except RuntimeError as error:stop.update(reason=str(error),importName=imports[pc]);uc.emu_stop();return
   host_calls.append({'address':hex(pc),'name':imports[pc]});sp=uc.reg_read(x.UC_X86_REG_RSP);ret=int.from_bytes(uc.mem_read(sp,8),'little')
   if result is not None:uc.reg_write(x.UC_X86_REG_RAX,result)
   uc.reg_write(x.UC_X86_REG_RSP,sp+8);uc.reg_write(x.UC_X86_REG_RIP,ret);uc.emu_stop();return

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
 if len(trace)>=trace_limit:stop.update(reason='INSTRUCTION_LIMIT');uc.emu_stop();return
 if executable_memory:
  try:executable_memory.capture(pc,length)
  except RuntimeError as error:stop.update(reason=str(error),instructionPc=hex(pc));uc.emu_stop();return
 data=bytes(uc.mem_read(pc,length))
 if generated_mode:
  if pc in instruction_bytes and instruction_bytes[pc]!=data:stop.update(reason='NATIVE_CODE_VERSION_RETRANSLATION_REQUIRED',instructionPc=hex(pc));uc.emu_stop();return
  instruction_bytes[pc]=data
 if data[0] in [0xf2,0xf3]:
  if pc not in fp_instructions:fp_instructions[pc]=native_disasm.disassemble(data,base_address=pc,max_instructions=1).instructions[0]
  ins=fp_instructions[pc]
  try:
   handled=native_fp.apply(uc,x,ins,data)
  except RuntimeError as error:stop.update(reason=str(error),instruction=str(ins));uc.emu_stop();return
  if handled:
   if native_fp.last_memory:
    address,n=native_fp.last_memory
    if tib<=address<tib+tib_size:tib_reads.append((address-tib,n))
   trace.append(pc);control_events.append(pc);uc.emu_stop();return
 trace.append(pc)
 if bytes(uc.mem_read(pc,2))==b'\x0f\xa2':
  leaf=uc.reg_read(x.UC_X86_REG_EAX);subleaf=uc.reg_read(x.UC_X86_REG_ECX)
  values=profile['leaves'].get(str(leaf),[0,0,0,0])
  for reg,value in zip([x.UC_X86_REG_RAX,x.UC_X86_REG_RBX,x.UC_X86_REG_RCX,x.UC_X86_REG_RDX],values):uc.reg_write(reg,value)
  cpu_calls.append({'pc':hex(pc),'leaf':leaf,'subleaf':subleaf,'results':values})
  uc.reg_write(x.UC_X86_REG_RIP,pc+2);uc.emu_stop();return
def memory_error(uc,access,address,size,value,_):
 owner=next((owner for start,end,owner in protected_code_regions if address<end and address+size>start),None)
 if owner and access in [unicorn.UC_MEM_WRITE_PROT,unicorn.UC_MEM_WRITE_UNMAPPED]:
  pc=uc.reg_read(x.UC_X86_REG_RIP);stop.update(reason='NATIVE_CODE_WRITE_REQUIRES_ROUTING',ownerModule=owner,instructionPc=hex(pc),occurrence=trace.count(pc),writeAddress=hex(address),writeSize=size,writeValueHex=hex(value&((1<<min(size*8,64))-1)));return False
 stop.update(reason='UNMAPPED_MEMORY',address=hex(address),access=access,instruction=hex(uc.reg_read(x.UC_X86_REG_RIP)));return False
def import_memory_read(uc,access,address,size,value,data):
 pc=uc.reg_read(x.UC_X86_REG_RIP);gateway=address&~15
 event={'reason':'UNRESOLVED_IMPORT_MEMORY_REQUIRED','readAddress':hex(address),'readSize':size,'instructionPc':hex(pc),'occurrence':trace.count(pc),'importName':imports.get(gateway,'unknown import region')}
 import_memory_reads.append(event);stop.update(event);uc.emu_stop()
uc.hook_add(unicorn.UC_HOOK_MEM_READ,import_memory_read,begin=0x70000000,end=0x7000ffff)
if fmod:uc.hook_add(unicorn.UC_HOOK_MEM_READ,lambda uc,access,address,size,value,data:fmod_code_reads.append((uc.reg_read(x.UC_X86_REG_RIP),address,size)),begin=fmod['base']+0x1000,end=fmod['base']+0x1fff)
uc.hook_add(unicorn.UC_HOOK_CODE,code);uc.hook_add(unicorn.UC_HOOK_MEM_INVALID,memory_error)
uc.hook_add(unicorn.UC_HOOK_MEM_READ,lambda uc,access,address,size,value,data:tib_reads.append((address-tib,size)),begin=tib,end=tib+tib_size-1)
entry=bootstrap
try:
 resume=entry
 for attempt in range(16384):
  count_before=(len(host_calls),len(cpu_calls),len(control_events))
  uc.emu_start(resume,0x1234fedc,count=trace_limit+1)
  if stop or (len(host_calls),len(cpu_calls),len(control_events))==count_before:break
  resume=uc.reg_read(x.UC_X86_REG_RIP)
 else:stop['reason']='HOST_CALL_LIMIT'
except OwnedBridgeWriteRequired as error:stop.update(error.event)
except unicorn.UcError as error:stop.setdefault('error',str(error))
if not stop:stop['reason']='ENTRYPOINT_RETURNED'
if stop.get('importName','').lower().split('!')[-1] in ['createfilew','createdirectoryw','getfileattributesw','getfileattributesexw']:
 stop['requestedPath']=read_wide(uc.reg_read(x.UC_X86_REG_RCX))
if stop.get('importName'):
 sp=uc.reg_read(x.UC_X86_REG_RSP);stop['arguments']=[hex(uc.reg_read(r)) for r in [x.UC_X86_REG_RCX,x.UC_X86_REG_RDX,x.UC_X86_REG_R8,x.UC_X86_REG_R9]]+[hex(v) for v in struct.unpack('<4Q',uc.mem_read(sp+40,32))]
if stop.get('importName','').lower() in ['kernel32.dll!getmodulehandlea','kernel32.dll!loadlibraryexa','kernel32.dll!loadlibrarya','kernel32.dll!loadlibraryexw']:
 p=uc.reg_read(x.UC_X86_REG_RCX);text=bytearray()
 if p:
  for i in range(32768):
   value=bytes(uc.mem_read(p+i,1))
   if value==b'\0':break
   text+=value
 stop['requestedModule']=read_wide(p) if p and stop['importName'].lower().endswith('exw') else text.decode('latin1') if p else None
 if stop['importName'].lower().endswith(('loadlibraryexa','loadlibraryexw')):stop.update(flags=hex(uc.reg_read(x.UC_X86_REG_R8)),file=hex(uc.reg_read(x.UC_X86_REG_RDX)))
if stop.get('reason')=='UNMAPPED_MEMORY' and trace and trace[-1]==uc.reg_read(x.UC_X86_REG_RIP):trace.pop()
lifter=Lifter(pe,trace_limit,allow_indirect=True,yield_unknown=True,single_threaded=True,wide_mode=True,yield_on_budget=True);blocked=None;translated=0
if cocos:lifter.allowed_images.append((cocos['base'],cocos['base']+cocos['size']))
if primary:lifter.allowed_images.append((primary['base'],primary['base']+primary['size']))
if msvc:lifter.allowed_images.append((msvc['base'],msvc['base']+msvc['size']))
if vcruntime:lifter.allowed_images.append((vcruntime['base'],vcruntime['base']+vcruntime['size']))
if fmod:lifter.allowed_images.append((fmod['base'],fmod['base']+fmod['size']))
if executable_memory:
 lifter.allowed_images.append((EXECUTABLE_BASE,EXECUTABLE_BASE+EXECUTABLE_SIZE))
 lifter.code_guards.update(executable_memory.instructions)
if generated_mode:lifter.code_guards.update(instruction_bytes);lifter.checked_code_writes=True
for pc in dict.fromkeys(trace):
 data=instruction_bytes.get(pc,bytes(uc.mem_read(pc,32)));ins=lifter.ctx.disassemble(data,base_address=pc,max_instructions=1).instructions[0]
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
report['instructionBudget']=trace_limit
report['nativeFloatingReference']={'kind':'real host x64 SSE with normalized registers and checked memory-source decoding; MXCSR saved/restored','instructions':native_fp.count,'byPc':native_fp.by_pc}
report['primaryMappingPhase']='mapped at declared ASLR base before EXE TLS callbacks and entrypoint' if primary else 'not supplied'
report['pointerEncoding']={'key':str(pointer_key),'encodes':pointer_encodes,'decodes':pointer_decodes}
report['crtRuntime']=crt_runtime.snapshot()
report['fiberLocalStorage']=fls.snapshot()
report['slists']=slists.snapshot()
report['unresolvedImportMemoryReads']=import_memory_reads
report['stoppedBeforeUnresolvedImportRead']=bool(stop.get('stoppedBeforeInstruction') and stop.get('reason')=='UNRESOLVED_IMPORT_MEMORY_REQUIRED')
report['stoppedBeforeOwnedBridgeWrite']=bool(stop.get('stoppedBeforeInstruction') and stop.get('reason')=='OWNED_BRIDGE_WRITE_REQUIRES_ROUTING')
report['fmodBrowserAdapterProvider']=fmod
report['fmodInspectionBoundaryPassed']=any(pc==0x21a6dad for pc,address,size in fmod_code_reads)
report['fmodNativeCodeReadCount']=len(fmod_code_reads)
report['fmodNativeCodeReadSites']=[hex(pc) for pc in sorted({pc for pc,address,size in fmod_code_reads})]
report['nativePatchToLiveWasmLinked']=False
report['stoppedBeforeNativePatch']=bool(stop.get('stoppedBeforeInstruction') and stop.get('reason')=='NATIVE_CODE_WRITE_REQUIRES_ROUTING')
report['protectedExecutableRegions']=[{'start':start,'end':end,'module':owner} for start,end,owner in protected_code_regions]
report['guestDirectoryHandles']=directories.snapshot()
report['executableMemory']=executable_memory.snapshot() if executable_memory else None
report['generatedCode']=executable_memory.generated_snapshot() if executable_memory and generated_mode else None
report['codeProtection']=code_protection.snapshot() if code_protection else None
report['nativeCodeWrites']=code_protection.writes if code_protection else []
report['instructionByteGuards']=len(instruction_bytes)
report['dllProcessAttachCompleted']=bool(stop['reason']=='ENTRYPOINT_RETURNED' and uc.reg_read(x.UC_X86_REG_RIP)==0x1234fedc and uc.reg_read(x.UC_X86_REG_RAX)&0xffffffff==1 and not vcruntime_only and msvc_boot!='only')
report['dllAttachResult']=uc.reg_read(x.UC_X86_REG_RAX)&0xffffffff if stop['reason']=='ENTRYPOINT_RETURNED' else None
report['criticalSections']={'states':critical.states,'acquisitions':critical.acquisitions}
report['testedComponent']='vcruntime-dll-attach' if vcruntime_only else 'msvc-dll-attach' if msvc_boot=='only' else 'geode-startup'
report['vcruntimeDllAttachCompleted']=bool(vcruntime and vcruntime['runtimeInitialized'])
report['translationPartitionSize']=128
report['vcruntimeImageInstructions']=sum(vcruntime['base']<=pc<vcruntime['base']+vcruntime['size'] for pc in trace) if vcruntime else 0
report['msvcImageInstructions']=sum(msvc['base']<=pc<msvc['base']+msvc['size'] for pc in trace) if msvc else 0
report['msvcBootMode']=msvc_boot
report['msvcDllAttachCompleted']=bool(msvc and msvc['runtimeInitialized'])
report['msvcCtorFixtureScheduled']=bool(msvc and msvc['constructor'] in trace)
report['msvcSliceInstructions']=sum(msvc['base']<=pc<msvc['base']+msvc['size'] for pc in trace) if msvc else 0
report['primaryImageInstructions']=sum(primary['base']<=pc<primary['base']+primary['size'] for pc in trace) if primary else 0
report['dependencyImageInstructions']=sum(cocos['base']<=pc<cocos['base']+cocos['size'] for pc in trace) if cocos else 0
report['dependencyLoadEvents']=load_events
report['dependencyLoadInProgress']=load_frame is not None
report['nativeExportChecks']=[{'name':symbol.name.decode(),'ordinal':symbol.ordinal,'address':base+symbol.address,'module':base} for symbol in pe.DIRECTORY_ENTRY_EXPORT.symbols[::600] if symbol.name and not symbol.forwarder]
if msvc:report['nativeExportChecks'].append({'module':msvc['base'],'name':msvc['constructorExport'],'ordinal':msvc['constructorOrdinal'],'address':msvc['constructor']})
if cocos:report['nativeExportChecks'] += [{'name':symbol.name.decode(),'ordinal':symbol.ordinal,'address':cocos['base']+symbol.address,'module':cocos['base']} for symbol in cocos_pe.DIRECTORY_ENTRY_EXPORT.symbols[::1000] if symbol.name and not symbol.forwarder]
report['threadDescription']=thread_description
report['localAllocations']=local_allocations
report['crtHeap']={'base':heap.base,'size':heap.size,'errno':heap.errno,'allocations':heap.allocations,'freeBlocks':heap.available,'calls':heap.calls}
report['resolvedExports']=[c for c in host_calls if c['name'].lower().endswith('!getprocaddress')]
report['windowsCompatibilityProfile']=windows_profile
report['tibReads']=sorted(set(tib_reads))
known_tib_fields=[(8,24),(0x30,0x38),(0x58,0x60),(0x68,0x6c),(0x2000,0x2018)]
unknown_tib=[(offset,n) for offset,n in report['tibReads'] if not any(start<=offset and offset+n<=end for start,end in known_tib_fields)]
report['unmodeledTibReads']=unknown_tib
report.update(originalDllInstructionsExecuted=sum(base<=pc<base+size for pc in trace),loaderBootstrapInstructions=sum(bootstrap<=pc<bootstrap+4096 for pc in trace),
 tlsTemplateBytes=tls_end-tls_start,tlsZeroFillBytes=tls_zero,tlsCallbacksScheduled=len(run_callbacks),tlsCallbacksCompleted=len(completed_tls),
 tlsCallbacksExecuted=bool(completed_tls),tibSize=tib_size)
if len(sys.argv)>2 and not blocked and not unknown_tib:
 out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
 for module_base,module_image in module_images.items():
  (out/f'module-{module_base:x}.bin').write_bytes(module_image)
  (out/f'module-{module_base:x}-after.bin').write_bytes(bytes(uc.mem_read(module_base,len(module_image))))
 (out/'crt-runtime.bin').write_bytes(initial_crt_runtime);(out/'crt-runtime-after.bin').write_bytes(bytes(uc.mem_read(0xf00000,65536)))
 if executable_memory:(out/'executable-arena-after.bin').write_bytes(bytes(uc.mem_read(EXECUTABLE_BASE,EXECUTABLE_SIZE)))
 (out/'startup.c').write_text(lifter.source(partition_size=128));(out/'image.bin').write_bytes(initial_image)
 (out/'stack.bin').write_bytes(bytes(uc.mem_read(0x200000,0x100000)))
 (out/'tib.bin').write_bytes(initial_tib)
 (out/'tib-after.bin').write_bytes(bytes(uc.mem_read(tib,tib_size)))
 (out/'tls.bin').write_bytes(initial_tls);(out/'tls-after.bin').write_bytes(bytes(uc.mem_read(tls_block,tls_size)))
 (out/'image-after.bin').write_bytes(bytes(uc.mem_read(base,size)))
 if cocos:(out/'dependency-tls-after.bin').write_bytes(bytes(uc.mem_read(cocos['tls']['base'],cocos['tls']['size'])))
 if primary and primary.get('primaryTls'):
  (out/'primary-tls.bin').write_bytes(initial_primary_tls)
  (out/'primary-tls-after.bin').write_bytes(bytes(uc.mem_read(primary['primaryTls']['base'],65536)))
 (out/'crt-heap-after.bin').write_bytes(bytes(uc.mem_read(heap.base,heap.size)))
 (out/'errno-after.bin').write_bytes(bytes(uc.mem_read(heap.errno,0x10000)))
 (out/'local-heap-after.bin').write_bytes(bytes(uc.mem_read(local_heap,local_heap_size)))
 (out/'arena-after.bin').write_bytes(bytes(uc.mem_read(arena,arena_size)))
 names=['RAX','RCX','RDX','RBX','RSP','RBP','RSI','RDI','R8','R9','R10','R11','R12','R13','R14','R15']
 if report['msvcCtorFixtureScheduled']:
  fixture=unicorn.Uc(unicorn.UC_ARCH_X86,unicorn.UC_MODE_64);fixture.mem_map(msvc['base'],msvc['size']);fixture.mem_write(msvc['base'],module_images[msvc['base']])
  fixture.mem_map(0x10000,0x1000);fixture.mem_map(0x100000,0x1000);fixture.mem_write(0x10000,bytes([0xa5])*128)
  initial=[(index+1)*0x101 for index in range(16)];initial[1]=0x10000;initial[4]=0x100f08
  for name,value in zip(names,initial):fixture.reg_write(getattr(x,'UC_X86_REG_'+name),value)
  fixture.mem_write(0x100f08,struct.pack('<Q',0x1234fedc));fixture.emu_start(msvc['constructor'],0x1234fedc,count=32)
  (out/'msvc-ctor-fixture.json').write_text(json.dumps({'entry':msvc['constructor'],'initial':[hex(v) for v in initial],
   'expected':[hex(fixture.reg_read(getattr(x,'UC_X86_REG_'+name))) for name in names],
   'pc':fixture.reg_read(x.UC_X86_REG_RIP),'object':bytes(fixture.mem_read(0x10000,128)).hex()}))

 (out/'expected.json').write_text(json.dumps({'generationId':generation_id,'entry':entry,'base':base,'stop':uc.reg_read(x.UC_X86_REG_RIP),
  'instructions':len(trace),'hostCalls':host_calls,'tibBase':tib,'tibSize':tib_size,'tlsBase':tls_block,'tlsSize':tls_size,
  'modules':initial_modules,'moduleBootReturns':[{'pc':pc,'base':module['base'],'stack':0x2ffee0} for pc,module in module_boot_returns.items()],'moduleGateways':{hex(k):v for k,v in module_gateways.items()},
  'bootstrap':bootstrap,'loaderHex':loader.hex(),
  'mxcsr':{'offset':lifter.reg_offset(lifter.ctx.registers['MXCSR']),'value':uc.reg_read(x.UC_X86_REG_MXCSR)},
  'xmm':[hex(uc.reg_read(getattr(x,f'UC_X86_REG_XMM{i}'))) for i in range(16)],
  'flags':{name:{'offset':2048+lifter.ctx.registers[name].offset,'value':(uc.reg_read(x.UC_X86_REG_EFLAGS)>>bit)&1} for name,bit in [('CF',0),('PF',2),('ZF',6),('SF',7),('OF',11)]},
  'registers':[hex(uc.reg_read(getattr(x,'UC_X86_REG_'+name))) for name in names]}))
print(json.dumps(report,indent=2))
