"""Independent reference state for one serialized context's recursive locks."""
import struct
class CriticalSections:
 def __init__(self,write):self.write=write;self.states={};self.acquisitions=0
 def invoke(self,name,p,spin=0,flags=0,thread=1):
  key=name.split('!')[-1].lower();state=self.states.get(p);result=None
  if not p or p%8:raise RuntimeError('Critical section bounds/alignment')
  if key.startswith('initializecriticalsection'):
   if state:raise RuntimeError('Critical section already initialized')
   if key=='initializecriticalsection':spin=0
   if key!='initializecriticalsectionex':flags=0
   if flags:raise RuntimeError('UNMODELED_CRITICAL_SECTION_FLAGS')
   state={'owner':None,'depth':0,'spin':spin&0xffffffff};self.states[p]=state
   self.write(p,bytes(40));self.write(p+8,struct.pack('<i',-1));self.write(p+32,struct.pack('<Q',state['spin']))
   if key!='initializecriticalsection':result=1
  else:
   if state is None:raise RuntimeError('Critical section not initialized')
   if key=='deletecriticalsection':
    if state['owner'] is not None:raise RuntimeError('Cannot delete owned critical section')
    del self.states[p];self.write(p,bytes(40))
   elif key=='leavecriticalsection':
    if state['owner']!=thread or state['depth']==0:raise RuntimeError('Critical section non-owner release')
    state['depth']-=1
    if not state['depth']:state['owner']=None
   elif key in ['entercriticalsection','tryentercriticalsection']:
    if state['owner'] not in [None,thread]:
     if key=='entercriticalsection':raise RuntimeError('Critical section contention requires scheduler')
     result=0
    else:
     if state['depth']==0x7fffffff:raise RuntimeError('Critical section recursion overflow')
     state['owner']=thread;state['depth']+=1;self.acquisitions+=1
     if key=='tryentercriticalsection':result=1
   else:raise RuntimeError('Unknown critical section API')
   if p in self.states:self.write(p+8,struct.pack('<iiQ',state['depth']-1,state['depth'],state['owner'] or 0))
  return result
