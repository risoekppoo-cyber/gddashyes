"""Serialized opaque Win64 SList provider; no concurrent guest execution."""
import struct
class SLists:
 def __init__(self,read,write):self.read=read;self.write=write;self.heads={};self.pushes=0
 def invoke(self,name,a,b=0):
  if not 0<a<=0xffffffff or a%16:raise RuntimeError('SLIST_HEADER_ALIGNMENT_OR_BOUNDS')
  key=name.split('!')[-1].lower()
  if key=='initializeslisthead':
   if self.heads.get(a,{}).get('depth',0):raise RuntimeError('SLIST_REINIT_REQUIRES_CLEANUP')
   self.write(a,bytes(16));self.heads[a]={'head':0,'depth':0,'sequence':0};return None
  if key!='interlockedpushentryslist':raise RuntimeError('UNMODELED_SLIST_API')
  if a not in self.heads:raise RuntimeError('SLIST_INITIALIZATION_REQUIRED')
  if not 0<b<=0xffffffff or b%16:raise RuntimeError('SLIST_ENTRY_ALIGNMENT_OR_BOUNDS')
  state=self.heads[a];old=state['head'];encoded=struct.pack('<QQ',state['depth']|(state['sequence']<<16),old)
  if bytes(self.read(a,16))!=encoded:raise RuntimeError('UNMODELED_SLIST_NATIVE_HEADER_WRITE')
  if state['depth']==65535:raise RuntimeError('SLIST_PROVIDER_CAPACITY')
  # Opaque provider layout: public depth at low 16 bits, native next pointers.
  self.write(b,struct.pack('<Q',old));state['head']=b;state['depth']+=1;state['sequence']=(state['sequence']+1)&((1<<48)-1)
  self.write(a,struct.pack('<QQ',state['depth']|(state['sequence']<<16),b));self.pushes+=1;return old
 def snapshot(self):return {'heads':self.heads,'pushes':self.pushes}
