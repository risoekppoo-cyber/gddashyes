"""Probe only empty exception_ptr operations in an isolated Windows process.

No fabricated exception record, throw, rethrow or non-empty control block.
"""
import ctypes,json,sys
from pathlib import Path

def main():
 dll=ctypes.CDLL('msvcp140.dll')
 names={
  'create':'?__ExceptionPtrCreate@@YAXPEAX@Z',
  'destroy':'?__ExceptionPtrDestroy@@YAXPEAX@Z',
  'copy':'?__ExceptionPtrCopy@@YAXPEAXPEBX@Z',
  'assign':'?__ExceptionPtrAssign@@YAXPEAXPEBX@Z',
  'toBool':'?__ExceptionPtrToBool@@YA_NPEBX@Z'}
 functions={}
 for name,symbol in names.items():
  f=getattr(dll,symbol);f.argtypes=[ctypes.c_void_p]*(2 if name in ['copy','assign'] else 1);f.restype=ctypes.c_bool if name=='toBool' else None;functions[name]=f
 class Guarded(ctypes.Structure):
  _fields_=[('before',ctypes.c_ubyte*16),('value',ctypes.c_ubyte*16),('after',ctypes.c_ubyte*16)]
 def make():
  b=Guarded();ctypes.memset(ctypes.addressof(b),0xa5,ctypes.sizeof(b));return b
 def pointer(b):return ctypes.addressof(b)+16
 def check(b):
  assert bytes(b.before)==bytes([0xa5])*16 and bytes(b.after)==bytes([0xa5])*16,'guard overwritten'
  return bytes(b.value).hex()
 a,b=make(),make();observed={}
 functions['create'](pointer(a));observed['createHex']=check(a);assert observed['createHex']=='00'*16
 observed['emptyBool']=bool(functions['toBool'](pointer(a)));assert observed['emptyBool'] is False
 functions['copy'](pointer(b),pointer(a));observed['copyHex']=check(b);assert observed['copyHex']=='00'*16
 functions['assign'](pointer(a),pointer(b));observed['assignHex']=check(a)
 functions['assign'](pointer(a),pointer(a));observed['selfAssignHex']=check(a)
 functions['destroy'](pointer(b));observed['destroyHex']=check(b)
 functions['destroy'](pointer(a));check(a)
 result={'status':'EMPTY_EXCEPTION_PTR_NATIVE_PASS','pointerBytes':ctypes.sizeof(ctypes.c_void_p),'storageBytes':16,'symbols':names,'observed':observed,'guardsPreserved':True,'nonEmptyExceptionsTested':False}
 print(json.dumps(result,indent=2))
 if len(sys.argv)>1:Path(sys.argv[1]).write_text(json.dumps(result,indent=2)+'\n')
if __name__=='__main__':main()
