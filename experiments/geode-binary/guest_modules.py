"""Declared PE shim modules. Gateways dispatch only explicitly implemented APIs."""
import struct
import pefile
KERNEL_EXPORTS='GetCurrentThread SetThreadDescription GetThreadDescription LocalFree GetModuleHandleA GetModuleHandleW GetProcAddress GetSystemTimeAsFileTime GetCurrentThreadId GetCurrentProcessId QueryPerformanceCounter QueryPerformanceFrequency GetSystemInfo GetNativeSystemInfo InitializeSListHead GetEnvironmentVariableW GetLastError SetLastError InitializeSRWLock AcquireSRWLockExclusive ReleaseSRWLockExclusive TryAcquireSRWLockExclusive AcquireSRWLockShared ReleaseSRWLockShared TryAcquireSRWLockShared InitializeConditionVariable WakeConditionVariable WakeAllConditionVariable'.split()

def shim(name,base,exports):
 # Loaded PE32+ image: headers, executable gateway section, real export tables.
 image=bytearray(65536);image[:2]=b'MZ';struct.pack_into('<I',image,0x3c,0x80)
 image[0x80:0x84]=b'PE\0\0';struct.pack_into('<HHIIIHH',image,0x84,0x8664,2,0,0,0,240,0x2022)
 o=0x98;struct.pack_into('<H',image,o,0x20b);struct.pack_into('<Q',image,o+24,base)
 struct.pack_into('<II',image,o+32,4096,512);struct.pack_into('<II',image,o+56,65536,4096)
 struct.pack_into('<I',image,o+108,16);struct.pack_into('<II',image,o+112,0x2000,0x4000)
 section=o+240
 for i,(label,rva,characteristics) in enumerate([(b'.text',0x1000,0x60000020),(b'.edata',0x2000,0x40000040)]):
  off=section+i*40;image[off:off+len(label)]=label
  struct.pack_into('<IIII',image,off+8,4096 if i==0 else 0x4000,rva,4096 if i==0 else 0x4000,rva)
  struct.pack_into('<I',image,off+36,characteristics)
 names=sorted(exports);count=len(names);eat=0x2100;name_table=eat+count*4;ord_table=name_table+count*4;cursor=ord_table+count*2
 def string(value):
  nonlocal cursor
  p=cursor;data=value.encode('ascii')+b'\0';image[p:p+len(data)]=data;cursor+=len(data);return p
 dll_name=string(name)
 struct.pack_into('<IIHHIIIIIII',image,0x2000,0,0,0,0,dll_name,1,count,count,eat,name_table,ord_table)
 gates={}
 for index,symbol in enumerate(names):
  rva=0x1000+index*16;image[rva:rva+2]=b'\x0f\x0b'
  struct.pack_into('<I',image,eat+index*4,rva);struct.pack_into('<I',image,name_table+index*4,string(symbol));struct.pack_into('<H',image,ord_table+index*2,index)
  gates[base+rva]=name+'!'+symbol
 assert cursor<0x6000
 # Independent parser checks the emitted PE directory, names and addresses.
 parsed=pefile.PE(data=bytes(image))
 assert {s.name.decode():base+s.address for s in parsed.DIRECTORY_ENTRY_EXPORT.symbols}=={n:address for address,full in gates.items() for n in [full.split('!')[1]]}
 return {'name':name,'base':base,'size':len(image),'complete':False,'shim':True,'knownAbsent':['wine_get_version'] if name=='ntdll.dll' else []},bytes(image),gates

def build_modules(pe,base):
 modules=[{'name':'Geode.dll','base':base,'size':pe.OPTIONAL_HEADER.SizeOfImage,'complete':True,'shim':False}];images={};gates={}
 for index,(name,exports) in enumerate([('kernel32.dll',KERNEL_EXPORTS),('ntdll.dll',['RtlGetVersion'])]):
  item,image,targets=shim(name,0x1000000+index*65536,exports);modules.append(item);images[item['base']]=image;gates.update(targets)
 return modules,images,gates

def module_handle(modules,name):
 if name is None:raise RuntimeError('PRIMARY_EXECUTABLE_REQUIRED')
 key=name.replace('\\','/').lower()
 if '/' in key:
  if not key.startswith('c:/windows/system32/'):raise RuntimeError('UNMODELED_MODULE_PATH: '+name)
  key=key.rsplit('/',1)[-1]
 if key.endswith('.'):key=key[:-1]
 elif '.' not in key:key+='.dll'
 for module in modules:
  if module['name'].lower()==key:return module['base']
 raise RuntimeError('UNMODELED_MODULE: '+name)

def resolve_export(modules,read,handle,symbol):
 module=next((m for m in modules if m['base']==handle),None)
 if module is None:raise RuntimeError('UNMODELED_MODULE_HANDLE: '+hex(handle))
 if isinstance(symbol,int) and module['shim']:raise RuntimeError('UNMODELED_SHIM_ORDINAL: '+str(symbol))
 data=bytes(read(handle,module['size']));pe=pefile.PE(data=data)
 for entry in pe.DIRECTORY_ENTRY_EXPORT.symbols:
  if (isinstance(symbol,int) and entry.ordinal==symbol) or (entry.name is not None and entry.name.decode('ascii')==symbol):
   if entry.forwarder:raise RuntimeError('UNMODELED_EXPORT_FORWARDER: '+entry.forwarder.decode())
   return handle+entry.address
 if symbol in module.get('knownAbsent',[]):return 0
 if not module['complete']:raise RuntimeError('UNMODELED_EXPORT: '+module['name']+'!'+str(symbol))
 return 0
