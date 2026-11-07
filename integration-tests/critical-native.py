"""Check the bounded critical-section profile against this Windows host."""
import ctypes,json,struct,sys
if sys.platform!='win32':raise SystemExit('Requires Windows; not run')
k=ctypes.WinDLL('kernel32');p=ctypes.c_void_p
for name in ['InitializeCriticalSection','EnterCriticalSection','LeaveCriticalSection','DeleteCriticalSection','TryEnterCriticalSection']:getattr(k,name).argtypes=[p]
b=ctypes.create_string_buffer(40)
def state():
 raw=b.raw
 return {'debug':hex(struct.unpack_from('<Q',raw)[0]),'lock':struct.unpack_from('<i',raw,8)[0],'recursion':struct.unpack_from('<I',raw,12)[0],'owner':struct.unpack_from('<Q',raw,16)[0],'semaphore':struct.unpack_from('<Q',raw,24)[0],'spin':hex(struct.unpack_from('<Q',raw,32)[0])}
k.InitializeCriticalSection(b);states=[state()];k.EnterCriticalSection(b);states.append(state())
assert k.TryEnterCriticalSection(b);states.append(state());k.LeaveCriticalSection(b);states.append(state());k.LeaveCriticalSection(b);states.append(state());k.DeleteCriticalSection(b)
assert [s['recursion'] for s in states]==[0,1,2,1,0] and [s['lock'] for s in states]==[-1,-2,-2,-2,-1]
c=ctypes.CDLL('ucrtbase');f=c.powf;f.argtypes=[ctypes.c_float,ctypes.c_float];f.restype=ctypes.c_float
assert f(4,.8999999761581421)==3.4822020530700684
print(json.dumps({'status':'NATIVE_CRITICAL_SECTION_PASS','states':states,'observedPowf':f(4,.8999999761581421)}))
