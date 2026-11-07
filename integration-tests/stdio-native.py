"""Windows oracle for stream identity and descriptor/handle ownership only."""
import ctypes,json,sys
if sys.platform!='win32':raise SystemExit('Requires Windows; not run')
k=ctypes.WinDLL('kernel32',use_last_error=True);c=ctypes.CDLL('ucrtbase');u=ctypes.c_uint32;p=ctypes.c_void_p
k.GetStdHandle.argtypes=[u];k.GetStdHandle.restype=p;k.SetStdHandle.argtypes=[u,p]
iob=c.__acrt_iob_func;iob.argtypes=[u];iob.restype=p
c._fileno.argtypes=[p];c._fileno.restype=ctypes.c_int;c._dup.argtypes=[ctypes.c_int];c._dup.restype=ctypes.c_int
c._fdopen.argtypes=[ctypes.c_int,ctypes.c_char_p];c._fdopen.restype=p
c._get_osfhandle.argtypes=[ctypes.c_int];c._get_osfhandle.restype=ctypes.c_ssize_t;c.fclose.argtypes=[p];c._close.argtypes=[ctypes.c_int]
old=k.GetStdHandle(0xfffffff5);dup=-1;opened=None
try:
 assert k.SetStdHandle(0xfffffff5,None) and k.GetStdHandle(0xfffffff5) is None
 pointers=[iob(i) for i in range(3)];fds=[c._fileno(f) for f in pointers];assert fds==[0,1,2]
 dup=c._dup(1);assert dup>=3 and c._get_osfhandle(dup)!=c._get_osfhandle(1)
 opened=c._fdopen(dup,b'w');assert opened and c._fileno(opened)==dup
 assert c.fclose(opened)==0;opened=None;dup=-1
 result={'status':'NATIVE_STDIO_OWNERSHIP_PASS','standardFds':fds,'observedIobStride':pointers[1]-pointers[0],'dupOwnsDistinctHandle':True,'fdopenPreservesFd':True,'stdioOpenWithoutWin32StdHandle':True}
finally:
 if opened:c.fclose(opened)
 elif dup>=0:c._close(dup)
 assert k.SetStdHandle(0xfffffff5,old)
print(json.dumps(result))
