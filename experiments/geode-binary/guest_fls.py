"""Bounded FLS storage for one registered main context; callbacks never skipped."""
class FiberLocalStorage:
 def __init__(self,capacity=128):self.capacity=capacity;self.slots={};self.calls=0
 def invoke(self,name,a,b=0,context=1):
  if context!=1:raise RuntimeError('FLS context switching requires scheduler')
  key=name.split('!')[-1].lower();index=a&0xffffffff
  if key not in ['flsalloc','flsgetvalue','flssetvalue','flsfree']:raise RuntimeError('Unknown FLS service '+name)
  if key=='flsalloc' and a>0xffffffff:raise RuntimeError('FLS callback outside guest address space')
  if key=='flsfree' and index in self.slots and int(self.slots[index]['callback']) and int(self.slots[index]['value']):raise RuntimeError('FLS_CLEANUP_CALLBACK_EXECUTION_REQUIRED')
  self.calls+=1
  if key=='flsalloc':
   if a>0xffffffff:raise RuntimeError('FLS callback outside guest address space')
   index=next((i for i in range(self.capacity) if i not in self.slots),None)
   if index is None:return 0xffffffff,8
   self.slots[index]={'callback':str(a),'value':'0'};return index,None
  if index not in self.slots:return 0,87
  slot=self.slots[index]
  if key=='flsgetvalue':return int(slot['value']),None
  if key=='flssetvalue':slot['value']=str(b);return 1,None
  if key=='flsfree':
   if int(slot['callback']) and int(slot['value']):raise RuntimeError('FLS_CLEANUP_CALLBACK_EXECUTION_REQUIRED')
   del self.slots[index];return 1,None
  raise RuntimeError('Unknown FLS service '+name)
 def snapshot(self):return {'capacity':self.capacity,'slots':self.slots,'calls':self.calls}
