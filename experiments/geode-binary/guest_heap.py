"""Bounded CRT allocator for the serialized guest, never host pointers."""
class GuestHeap:
 def __init__(self,read,write,base=0x3400000,size=0x800000,errno=0xc00000):
  self.read,self.write,self.base,self.size,self.errno=read,write,base,size,errno
  self.available=[(base,size)];self.allocations={};self.calls=0
 def fail(self):self.write(self.errno,(12).to_bytes(4,'little'));return 0
 def malloc(self,n):
  if n>self.size:return self.fail()
  size=(max(1,n)+15)&~15
  for i,(p,capacity) in enumerate(self.available):
   if capacity<size:continue
   self.available[i:i+1]=[(p+size,capacity-size)] if capacity>size else []
   self.allocations[p]=(n,size);return p
  return self.fail()
 def free(self,p):
  if not p:return
  if p not in self.allocations:raise RuntimeError('INVALID_CRT_FREE: '+hex(p))
  _,size=self.allocations.pop(p);self.available.append((p,size));self.available.sort();merged=[]
  for at,n in self.available:
   if merged and merged[-1][0]+merged[-1][1]==at:merged[-1]=(merged[-1][0],merged[-1][1]+n)
   else:merged.append((at,n))
  self.available=merged
 def invoke(self,symbol,a,b=0):
  self.calls+=1
  if symbol=='malloc':return self.malloc(a)
  if symbol=='free':self.free(a);return None
  if symbol=='calloc':
   n=a*b
   if n>0xffffffffffffffff:return self.fail()
   p=self.malloc(n)
   if p and n:self.write(p,b'\0'*n)
   return p
  if symbol=='realloc':
   if not a:return self.malloc(b)
   if a not in self.allocations:raise RuntimeError('INVALID_CRT_REALLOC')
   if not b:self.free(a);return 0
   old_n,capacity=self.allocations[a]
   if b<=capacity:self.allocations[a]=(b,capacity);return a
   p=self.malloc(b)
   if p:self.write(p,bytes(self.read(a,min(old_n,b))));self.free(a)
   return p
  if symbol=='_msize':
   if a not in self.allocations:raise RuntimeError('INVALID_CRT_MSIZE')
   return self.allocations[a][1]
  if symbol=='_errno':return self.errno
  raise RuntimeError('UNKNOWN_CRT_HEAP_API: '+symbol)
