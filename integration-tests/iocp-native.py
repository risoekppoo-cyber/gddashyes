"""Windows oracle for real pipe completions and manually posted IOCP packets."""
import ctypes,json,os,sys
if sys.platform!='win32':raise SystemExit('Requires Windows; not run')
k=ctypes.WinDLL('kernel32',use_last_error=True);p=ctypes.c_void_p;u=ctypes.c_uint32;q=ctypes.c_size_t
class Overlapped(ctypes.Structure):
 _fields_=[('internal',q),('high',q),('offset',u),('offsetHigh',u),('event',p)]
k.CreateNamedPipeW.argtypes=[ctypes.c_wchar_p,u,u,u,u,u,u,p];k.CreateNamedPipeW.restype=p
k.CreateFileW.argtypes=[ctypes.c_wchar_p,u,u,p,u,u,p];k.CreateFileW.restype=p
k.CreateIoCompletionPort.argtypes=[p,p,q,u];k.CreateIoCompletionPort.restype=p
k.PostQueuedCompletionStatus.argtypes=[p,u,q,p]
k.GetQueuedCompletionStatus.argtypes=[p,ctypes.POINTER(u),ctypes.POINTER(q),ctypes.POINTER(p),u]
k.ReadFile.argtypes=[p,p,u,ctypes.POINTER(u),ctypes.POINTER(Overlapped)]
k.WriteFile.argtypes=[p,p,u,ctypes.POINTER(u),p];k.CloseHandle.argtypes=[p]
name='\\\\.\\pipe\\geode-iocp-'+str(os.getpid());server=k.CreateNamedPipeW(name,0x40000001,8,1,0,1024,0,None)
assert server and server!=(1<<64)-1
port=None;client=None
try:
 port=k.CreateIoCompletionPort(server,None,0x1234,0);assert port
 assert not k.CreateIoCompletionPort(server,port,0x999,0) and ctypes.get_last_error()==87
 client=k.CreateFileW(name,0x40000000,0,None,3,0,None);assert client and client!=(1<<64)-1
 data=ctypes.create_string_buffer(16);ov=Overlapped();n=u();key=q();over=p()
 assert not k.ReadFile(server,data,16,None,ctypes.byref(ov)) and ctypes.get_last_error()==997
 message=ctypes.create_string_buffer(b'log');assert k.WriteFile(client,message,3,ctypes.byref(n),None)
 assert k.GetQueuedCompletionStatus(port,ctypes.byref(n),ctypes.byref(key),ctypes.byref(over),1000)
 assert (n.value,key.value,over.value)==(3,0x1234,ctypes.addressof(ov)) and data.raw[:3]==b'log'
 assert k.PostQueuedCompletionStatus(port,7,0xbeef,None)
 assert k.GetQueuedCompletionStatus(port,ctypes.byref(n),ctypes.byref(key),ctypes.byref(over),0) and (n.value,key.value,over.value)==(7,0xbeef,None)
 n.value=123;key.value=456;over.value=789
 assert not k.GetQueuedCompletionStatus(port,ctypes.byref(n),ctypes.byref(key),ctypes.byref(over),0)
 assert ctypes.get_last_error()==258 and n.value==123 and key.value==456 and over.value is None
 failed=Overlapped();assert not k.ReadFile(server,data,16,None,ctypes.byref(failed)) and ctypes.get_last_error()==997
 k.CloseHandle(client);client=None
 assert not k.GetQueuedCompletionStatus(port,ctypes.byref(n),ctypes.byref(key),ctypes.byref(over),1000)
 assert ctypes.get_last_error()==109 and over.value==ctypes.addressof(failed) and key.value==0x1234 and n.value==0
 print(json.dumps({'status':'NATIVE_IOCP_PIPE_PASS','deliveredDataHex':data.raw[:3].hex(),'completionKey':key.value,'postedPacket':True,'timeoutError':258,'reassociationError':87,'failedPacketError':109,'failedPacketHasOverlapped':True}))
finally:
 if client and client!=(1<<64)-1:k.CloseHandle(client)
 if port:k.CloseHandle(port)
 k.CloseHandle(server)
