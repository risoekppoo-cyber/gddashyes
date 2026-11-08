"""Probe the x64 MSVC in-situ mutex ABI in a private, timeout-limited process."""
import ctypes,json,struct,subprocess,sys,threading
from pathlib import Path

def probe():
 dll=ctypes.CDLL('msvcp140.dll');kernel=ctypes.WinDLL('kernel32')
 kernel.GetCurrentThreadId.restype=ctypes.c_uint32;root_id=kernel.GetCurrentThreadId()
 names=['_Mtx_init_in_situ','_Mtx_destroy_in_situ','_Mtx_lock','_Mtx_trylock','_Mtx_unlock','_Mtx_current_owns'];f={}
 for name in names:
  fn=getattr(dll,name);fn.argtypes=[ctypes.c_void_p,ctypes.c_int] if name=='_Mtx_init_in_situ' else [ctypes.c_void_p]
  fn.restype=None if name in names[:2] else ctypes.c_int;f[name]=fn
 class Guard(ctypes.Structure):
  _fields_=[('before',ctypes.c_uint64*2),('body',ctypes.c_uint64*10),('after',ctypes.c_uint64*2)]
 def make():
  g=Guard();ctypes.memset(ctypes.addressof(g),0xa5,ctypes.sizeof(g));return g
 def address(g):return ctypes.addressof(g)+16
 def snapshot(g,label):
  raw=bytearray(ctypes.string_at(address(g),80));owner=struct.unpack_from('<i',raw,72)[0];count=struct.unpack_from('<i',raw,76)[0]
  assert bytes(g.before)==bytes([0xa5])*16 and bytes(g.after)==bytes([0xa5])*16
  assert struct.unpack_from('<Q',raw,8)[0]==0
  assert struct.unpack_from('<Q',raw,16)[0]==(1 if count else 0)
  normalized=1 if owner==root_id else owner;struct.pack_into('<i',raw,72,normalized)
  return {'label':label,'type':struct.unpack_from('<i',raw)[0],'owner':normalized,'count':count,'srw':struct.unpack_from('<Q',raw,16)[0],'hex':raw.hex()}
 results=[]
 for kind in [2,0x102]:
  g=make();p=address(g);f['_Mtx_init_in_situ'](p,kind);states=[snapshot(g,'initialized')]
  assert states[-1]['owner']==-1 and states[-1]['count']==0
  assert f['_Mtx_current_owns'](p)==0
  assert f['_Mtx_lock'](p)==0;states.append(snapshot(g,'locked'));assert f['_Mtx_current_owns'](p)==1
  thread_result=[]
  def other():
   thread_result.append({'tryResult':f['_Mtx_trylock'](p),'owns':f['_Mtx_current_owns'](p)})
  t=threading.Thread(target=other);t.start();t.join(3);assert not t.is_alive() and thread_result==[{'tryResult':3,'owns':0}]
  states.append(snapshot(g,'other-thread-try'));assert states[-1]['hex']==states[-2]['hex']
  repeated=f['_Mtx_lock'](p);tried=f['_Mtx_trylock'](p)
  assert (repeated,tried)==((0,0) if kind==0x102 else (3,3))
  states.append(snapshot(g,'same-thread-lock-and-try'))
  assert states[-1]['count']==(3 if kind==0x102 else 1)
  for _ in range(states[-1]['count']):assert f['_Mtx_unlock'](p)==0
  states.append(snapshot(g,'unlocked'));assert states[-1]['owner']==-1 and states[-1]['count']==0
  f['_Mtx_destroy_in_situ'](p);states.append(snapshot(g,'destroyed'));assert states[-1]['hex']==states[-2]['hex']
  results.append({'type':kind,'states':states,'otherThread':thread_result[0],'sameThreadLock':repeated,'sameThreadTry':tried})
 return {'status':'MSVC_MUTEX_NATIVE_PASS','pointerBytes':ctypes.sizeof(ctypes.c_void_p),'storageBytes':80,'offsets':{'type':0,'unused':8,'srw':16,'owner':72,'count':76},'success':0,'busy':3,'guardsPreserved':True,'profiles':results,'blockingContentionTested':False}

if __name__=='__main__':
 if '--child' in sys.argv:print(json.dumps(probe(),separators=(',',':')))
 else:
  run=subprocess.run([sys.executable,__file__,'--child'],capture_output=True,text=True,timeout=20)
  if run.returncode:raise RuntimeError(run.stderr or run.stdout)
  result=json.loads(run.stdout);assert result['status']=='MSVC_MUTEX_NATIVE_PASS'
  print(json.dumps(result,separators=(',',':')))
  if len(sys.argv)>1:Path(sys.argv[1]).write_text(json.dumps(result,indent=2)+'\n')
