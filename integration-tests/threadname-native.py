"""Isolated Windows oracle: a handler consumes the MSVC naming notification.

This tests continuable event handling, not general guest SEH or stack unwinding.
https://learn.microsoft.com/en-us/visualstudio/debugger/how-to-set-a-thread-name-in-native-code
"""
import ctypes,json,sys
if sys.platform!='win32':raise SystemExit('Requires Windows; not run')
u32=ctypes.c_uint32;ptr=ctypes.c_void_p;word=ctypes.c_size_t
class Record(ctypes.Structure):
 _fields_=[('code',u32),('flags',u32),('nested',ptr),('address',ptr),('count',u32),('info',word*15)]
class Pointers(ctypes.Structure):
 _fields_=[('record',ctypes.POINTER(Record)),('context',ptr)]
class ThreadInfo(ctypes.Structure):
 _pack_=8
 _fields_=[('type',u32),('name',ptr),('thread',u32),('flags',u32)]
assert ctypes.sizeof(ThreadInfo)==24 and Record.info.offset==32
k=ctypes.WinDLL('kernel32',use_last_error=True)
k.SetErrorMode(0x8002) # Child process only; suppress a dialog if an assertion fails.
k.GetCurrentThreadId.restype=u32
callback_type=ctypes.WINFUNCTYPE(ctypes.c_long,ptr)
k.AddVectoredExceptionHandler.argtypes=[u32,callback_type];k.AddVectoredExceptionHandler.restype=ptr
k.RemoveVectoredExceptionHandler.argtypes=[ptr];k.RemoveVectoredExceptionHandler.restype=u32
k.RaiseException.argtypes=[u32,u32,u32,ctypes.POINTER(word)];k.RaiseException.restype=None
events=[];observed=[];tid=k.GetCurrentThreadId();name=ctypes.create_string_buffer(b'GeodeProbe')
@callback_type
def handler(raw):
 r=ctypes.cast(raw,ctypes.POINTER(Pointers)).contents.record.contents
 observed.append({'code':hex(r.code),'flags':r.flags,'count':r.count,'info':list(r.info)[:r.count]})
 # Windows adds EXCEPTION_SOFTWARE_ORIGINATE (0x80) to its native record.
 if r.code!=0x406d1388 or r.flags&~0x80 or r.count!=3:return 0
 if r.info[0]!=0x1000 or r.info[1]!=ctypes.addressof(name) or r.info[2]!=tid:return 0
 events.append({'threadId':int(r.info[2]),'name':ctypes.string_at(r.info[1]).decode('ascii')})
 return -1 # EXCEPTION_CONTINUE_EXECUTION, only for this known event.
token=k.AddVectoredExceptionHandler(1,handler)
assert token,ctypes.get_last_error()
try:
 info=ThreadInfo(0x1000,ctypes.addressof(name),tid,0)
 k.RaiseException(0x406d1388,0,3,ctypes.cast(ctypes.byref(info),ctypes.POINTER(word)))
 assert events==[{'threadId':tid,'name':'GeodeProbe'}]
 print(json.dumps({'status':'NATIVE_THREAD_NAME_EVENT_PASS','code':'0x406d1388','resumed':True,'events':events}))
except OSError:
 print(json.dumps({'status':'NATIVE_PROBE_FAILED','observed':observed,'tid':tid,'namePointer':ctypes.addressof(name)}));raise
finally:assert k.RemoveVectoredExceptionHandler(token)
