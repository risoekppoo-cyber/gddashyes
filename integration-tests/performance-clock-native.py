"""Check valid QPF/QPC calls and guarded 64-bit output on native Windows."""
import ctypes,json,sys,time
from pathlib import Path

def main():
 kernel=ctypes.WinDLL('kernel32',use_last_error=True)
 class Guard(ctypes.Structure):
  _fields_=[('before',ctypes.c_uint64),('value',ctypes.c_int64),('after',ctypes.c_uint64)]
 def query(name):
  f=getattr(kernel,name);f.argtypes=[ctypes.POINTER(ctypes.c_int64)];f.restype=ctypes.c_int
  g=Guard(0xa5a5a5a5a5a5a5a5,-1,0x5a5a5a5a5a5a5a5a)
  pointer=ctypes.cast(ctypes.byref(g,8),ctypes.POINTER(ctypes.c_int64))
  assert f(pointer)!=0,name+' failed'
  assert g.before==0xa5a5a5a5a5a5a5a5 and g.after==0x5a5a5a5a5a5a5a5a,'output guard changed'
  return g.value
 frequencies=[query('QueryPerformanceFrequency') for _ in range(3)]
 assert frequencies[0]>0 and len(set(frequencies))==1
 ticks=[query('QueryPerformanceCounter') for _ in range(64)]
 assert all(b>=a for a,b in zip(ticks,ticks[1:]))
 before=time.perf_counter();start=query('QueryPerformanceCounter');time.sleep(0.025);end=query('QueryPerformanceCounter');elapsed=time.perf_counter()-before
 qpc_elapsed=(end-start)/frequencies[0];assert end>start and abs(qpc_elapsed-elapsed)<0.05
 result={'status':'PERFORMANCE_CLOCK_NATIVE_PASS','frequency':frequencies[0],'frequencyStable':True,'counterNondecreasing':True,'counterAdvanced':True,'outputBytes':8,'guardsPreserved':True,'elapsedSeconds':qpc_elapsed,'hostElapsedSeconds':elapsed,'invalidPointersTested':False}
 print(json.dumps(result,indent=2))
 if len(sys.argv)>1:Path(sys.argv[1]).write_text(json.dumps(result,indent=2)+'\n')
if __name__=='__main__':main()
