"""Disposable Windows pipe/CRT oracle. Uses only a process-unique pipe."""
import ctypes,json,os,sys
if sys.platform!='win32':raise SystemExit('Requires Windows; not run')
k=ctypes.WinDLL('kernel32',use_last_error=True);c=ctypes.CDLL('ucrtbase');u=ctypes.c_uint32;p=ctypes.c_void_p;word=ctypes.c_size_t
class Overlapped(ctypes.Structure):
 _fields_=[('internal',word),('high',word),('offset',u),('offsetHigh',u),('event',p)]
k.CreateNamedPipeW.argtypes=[ctypes.c_wchar_p,u,u,u,u,u,u,p];k.CreateNamedPipeW.restype=p
k.ReadFile.argtypes=[p,p,u,ctypes.POINTER(u),ctypes.POINTER(Overlapped)];k.ReadFile.restype=ctypes.c_int
k.GetOverlappedResult.argtypes=[p,ctypes.POINTER(Overlapped),ctypes.POINTER(u),ctypes.c_int];k.CloseHandle.argtypes=[p]
c._dup.argtypes=[ctypes.c_int];c._dup.restype=ctypes.c_int;c._fdopen.argtypes=[ctypes.c_int,ctypes.c_char_p];c._fdopen.restype=p
c.freopen_s.argtypes=[ctypes.POINTER(p),ctypes.c_char_p,ctypes.c_char_p,p];c.freopen_s.restype=ctypes.c_int
c._fileno.argtypes=[p];c._fileno.restype=ctypes.c_int;c.fwrite.argtypes=[p,word,word,p];c.fwrite.restype=word;c.fflush.argtypes=[p];c.fclose.argtypes=[p];c._close.argtypes=[ctypes.c_int]
name='\\\\.\\pipe\\geode-probe-'+str(os.getpid());server=k.CreateNamedPipeW(name,0x40000001,8,1,0,1024,0,None)
assert server and server!=(1<<64)-1,ctypes.get_last_error()
fd=-1;stream=None
try:
 fd=c._dup(1);assert fd>=3;stream=c._fdopen(fd,b'w');assert stream
 original=stream;out=p();error=c.freopen_s(ctypes.byref(out),name.encode(),b'w',stream)
 assert error==0 and out.value and out.value==original,(error,out.value)
 stream=out.value;assert c._fileno(stream)==fd
 buffer=ctypes.create_string_buffer(16);read=u(0xa5a5a5a5);ov=Overlapped()
 ok=k.ReadFile(server,buffer,16,ctypes.byref(read),ctypes.byref(ov));error=ctypes.get_last_error()
 assert not ok and error==997 and read.value==0,(ok,error,read.value)
 pending=int(ov.internal);assert pending==0x103
 message=ctypes.create_string_buffer(b'pipe\n');assert c.fwrite(message,1,5,stream)==5 and c.fflush(stream)==0
 assert k.GetOverlappedResult(server,ctypes.byref(ov),ctypes.byref(read),1)
 assert buffer.raw[:read.value]==b'pipe\r\n' and ov.internal==0 and ov.high==6
 cancelled=Overlapped();read.value=123
 assert not k.ReadFile(server,buffer,16,ctypes.byref(read),ctypes.byref(cancelled)) and ctypes.get_last_error()==997
 c.fclose(stream);stream=None;fd=-1
 assert not k.GetOverlappedResult(server,ctypes.byref(cancelled),ctypes.byref(read),1) and ctypes.get_last_error()==109
 eof=Overlapped();read.value=123
 assert not k.ReadFile(server,buffer,16,ctypes.byref(read),ctypes.byref(eof))
 assert ctypes.get_last_error()==109 and read.value==0
 print(json.dumps({'status':'NATIVE_PIPE_CRT_PASS','freopenPreservesFile':True,'freopenPreservesFd':True,'pendingError':997,'pendingStatus':pending,'dataHex':b'pipe\r\n'.hex(),'completedBytes':int(ov.high),'closedError':109,'closedStatus':int(eof.internal),'pendingClosedStatus':int(cancelled.internal)}))
finally:
 if stream:c.fclose(stream)
 elif fd>=0:c._close(fd)
 k.CloseHandle(server)
