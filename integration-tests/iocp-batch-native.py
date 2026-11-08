"""Actual Windows x64 batch IOCP oracle; private handles, bounded subprocess."""
import ctypes,json,os,struct,subprocess,sys
from pathlib import Path

def probe():
 k=ctypes.WinDLL('kernel32',use_last_error=True);p=ctypes.c_void_p;u=ctypes.c_uint32;q=ctypes.c_size_t
 class Entry(ctypes.Structure):
  _fields_=[('key',q),('ov',p),('internal',q),('bytes',u)]
 class Ov(ctypes.Structure):
  _fields_=[('internal',q),('high',q),('offset',u),('offsetHigh',u),('event',p)]
 class Guard(ctypes.Structure):
  _fields_=[('before',ctypes.c_ubyte*16),('entries',Entry*64),('after',ctypes.c_ubyte*16)]
 k.CreateIoCompletionPort.argtypes=[p,p,q,u];k.CreateIoCompletionPort.restype=p
 k.PostQueuedCompletionStatus.argtypes=[p,u,q,p];k.PostQueuedCompletionStatus.restype=ctypes.c_int
 k.GetQueuedCompletionStatusEx.argtypes=[p,ctypes.POINTER(Entry),u,ctypes.POINTER(u),u,ctypes.c_int];k.GetQueuedCompletionStatusEx.restype=ctypes.c_int
 k.CloseHandle.argtypes=[p]
 def query(port,capacity=64,timeout=0):
  g=Guard();ctypes.memset(ctypes.addressof(g),0xa5,ctypes.sizeof(g));removed=u(123);ctypes.set_last_error(0x4321)
  ok=bool(k.GetQueuedCompletionStatusEx(port,g.entries,capacity,ctypes.byref(removed),timeout,False));error=ctypes.get_last_error()
  assert bytes(g.before)==b'\xa5'*16 and bytes(g.after)==b'\xa5'*16
  raw=ctypes.string_at(ctypes.addressof(g)+16,64*ctypes.sizeof(Entry))
  assert removed.value<=64
  entries=[{'key':e.key,'ov':e.ov or 0,'internal':e.internal,'bytes':e.bytes,'hex':raw[i*32:(i+1)*32].hex()} for i,e in enumerate(g.entries[:removed.value])]
  assert raw[removed.value*32:]==b'\xa5'*(len(raw)-removed.value*32),'unused entries overwritten'
  return {'ok':ok,'error':error,'removed':removed.value,'entries':entries,'unusedEntriesPreserved':True}
 port=k.CreateIoCompletionPort(p(-1),None,0,0);assert port
 server=client=None
 try:
  empty=query(port);assert not empty['ok'] and empty['error']==258 and empty['removed']==0
  invalid=query(None);assert not invalid['ok'] and invalid['error']==6
  zero=query(port,0);assert not zero['ok'] and zero['error']==87
  packets=[(7,0xbeef,0x12345678),(11,0xface,0),(0,0xcafe,0x98765432)]
  for n,key,ov in packets:assert k.PostQueuedCompletionStatus(port,n,key,ov)
  first=query(port,2);second=query(port,64);assert first['ok'] and first['removed']==2 and second['ok'] and second['removed']==1
  actual=first['entries']+second['entries'];assert [(e['bytes'],e['key'],e['ov']) for e in actual]==packets
  assert all(e['internal']==0 for e in actual)
  after=query(port);assert not after['ok'] and after['error']==258 and after['removed']==0
  # Deliver a real successful and a real failed overlapped pipe operation.
  k.CreateNamedPipeW.argtypes=[ctypes.c_wchar_p,u,u,u,u,u,u,p];k.CreateNamedPipeW.restype=p
  k.CreateFileW.argtypes=[ctypes.c_wchar_p,u,u,p,u,u,p];k.CreateFileW.restype=p
  k.ReadFile.argtypes=[p,p,u,ctypes.POINTER(u),ctypes.POINTER(Ov)]
  k.WriteFile.argtypes=[p,p,u,ctypes.POINTER(u),p]
  name='\\\\.\\pipe\\geode-batch-'+str(os.getpid())
  server=k.CreateNamedPipeW(name,0x40000001,8,1,0,1024,0,None);assert server and server!=p(-1).value
  assert k.CreateIoCompletionPort(server,port,0x1234,0)==port
  client=k.CreateFileW(name,0x40000000,0,None,3,0,None);assert client and client!=p(-1).value
  data=ctypes.create_string_buffer(16);ov=Ov();n=u()
  assert not k.ReadFile(server,data,16,None,ctypes.byref(ov)) and ctypes.get_last_error()==997
  msg=ctypes.create_string_buffer(b'log');assert k.WriteFile(client,msg,3,ctypes.byref(n),None)
  success=query(port,64,1000);assert success['ok'] and success['removed']==1 and data.raw[:3]==b'log'
  entry=success['entries'][0];assert (entry['key'],entry['ov'],entry['bytes'],entry['internal'])==(0x1234,ctypes.addressof(ov),3,0)
  failed=Ov();assert not k.ReadFile(server,data,16,None,ctypes.byref(failed)) and ctypes.get_last_error()==997
  k.CloseHandle(client);client=None
  failure=query(port,64,1000);assert failure['ok'] and failure['removed']==1
  entry=failure['entries'][0];assert entry['key']==0x1234 and entry['ov']==ctypes.addressof(failed) and entry['bytes']==0 and entry['internal']==failed.internal and (failed.internal&0xffffffff)==0xc000014b
  # Normalize real process pointers in the evidence.
  for record,pointer in [(success,ctypes.addressof(ov)),(failure,ctypes.addressof(failed))]:
   e=record['entries'][0];e['ov']=0x10000;raw=bytearray.fromhex(e['hex']);struct.pack_into('<Q',raw,8,0x10000);e['hex']=raw.hex()
  result={'status':'IOCP_BATCH_NATIVE_PASS','pointerBytes':ctypes.sizeof(p),'entryBytes':ctypes.sizeof(Entry),'offsets':{n:getattr(Entry,n).offset for n in ['key','ov','internal','bytes']},'guardsPreserved':True,'empty':empty,'invalid':invalid,'zeroCapacity':zero,'firstBatch':first,'secondBatch':second,'afterDrain':after,'pipeSuccess':success,'pipeFailure':failure,'dataHex':data.raw[:3].hex(),'blockingAndApcSemanticsTested':False}
  return result
 finally:
  if client and client!=p(-1).value:k.CloseHandle(client)
  if server and server!=p(-1).value:k.CloseHandle(server)
  k.CloseHandle(port)

if __name__=='__main__':
 if '--child' in sys.argv:print(json.dumps(probe(),separators=(',',':')))
 else:
  run=subprocess.run([sys.executable,__file__,'--child'],capture_output=True,text=True,timeout=20)
  if run.returncode:raise RuntimeError(run.stderr or run.stdout)
  result=json.loads(run.stdout);assert result['status']=='IOCP_BATCH_NATIVE_PASS'
  print(json.dumps(result,separators=(',',':')))
  if len(sys.argv)>1:Path(sys.argv[1]).write_text(json.dumps(result,indent=2)+'\n')
