"""Check the detached-console profile in this disposable Windows process."""
import ctypes,json,sys
if sys.platform!='win32':raise SystemExit('Requires Windows; not run')
k=ctypes.WinDLL('kernel32',use_last_error=True);u=ctypes.c_uint32;p=ctypes.c_void_p
k.GetStdHandle.argtypes=[u];k.GetStdHandle.restype=p;k.SetStdHandle.argtypes=[u,p];k.SetStdHandle.restype=ctypes.c_int
k.GetConsoleMode.argtypes=[p,ctypes.POINTER(u)];k.SetConsoleMode.argtypes=[p,u]
for identifier in [0xfffffff6,0xfffffff5,0xfffffff4]:
 old=k.GetStdHandle(identifier)
 try:
  assert k.SetStdHandle(identifier,None);ctypes.set_last_error(123)
  assert k.GetStdHandle(identifier) is None and ctypes.get_last_error()==123
 finally:assert k.SetStdHandle(identifier,old)
assert k.GetStdHandle(0x1234)==(1<<64)-1 and ctypes.get_last_error()==6
mode=u(0xa5a5a5a5)
assert not k.GetConsoleMode(None,ctypes.byref(mode)) and ctypes.get_last_error()==6 and mode.value==0xa5a5a5a5
assert not k.SetConsoleMode(None,4) and ctypes.get_last_error()==6
print(json.dumps({'status':'NATIVE_DETACHED_CONSOLE_PASS','standardHandles':None,'invalidHandleError':6,'modeOutputPreserved':True}))
