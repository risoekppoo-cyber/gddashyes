"""Independent native-reference implementation of the declared opaque CRT services."""
import struct
class CrtRuntime:
 def __init__(self,write,read=None,base=0xf00000,size=65536):
  self.read=read;self.write=write;self.base=base;self.size=size;self.callbacks=[];self.file_locks={};self.new_handler=0;self.locale_lock={'owner':None,'depth':0};self.locale_queries=0;self.locale_conv_queries=0
  self.write(base,bytes(size));self.write(base+0x100,b'C\0');self.files=[base+0x1000+i*64 for i in range(3)]
  self.write(base+0x110,b'.\0');self.write(base+0x120,b'.\0')
  for index in range(10):self.write(base+0x400+index*8,struct.pack('<Q',base+(0x110 if index==0 else 0x113)))
  self.write(base+0x450,bytes([127])*8)
  for index in range(8):self.write(base+0x458+index*8,struct.pack('<Q',base+(0x120 if index==0 else 0x124)))
  for ch in range(-128,256):
   flags=0
   if 0<=ch<32 or ch==127:flags|=32
   if 9<=ch<=13 or ch==32:flags|=8
   if ch==32:flags|=64
   if 48<=ch<=57:flags|=4|128
   elif 65<=ch<=90:flags|=1|(128 if ch<=70 else 0)
   elif 97<=ch<=122:flags|=2|(128 if ch<=102 else 0)
   elif 33<=ch<=126:flags|=16
   self.write(base+0x800+(ch+128)*2,struct.pack('<H',flags))
  for i,p in enumerate(self.files):self.write(p+32,struct.pack('<I',i))
 def invoke(self,name,a,b=0,c=0,d=0,thread=1):
  key=name.split('!')[-1].lower()
  if key=='tolower':
   ch=a&0xffffffff
   if ch==0xffffffff:return ch
   if ch>255:raise RuntimeError('UNMODELED_CRT_CTYPE_ARGUMENT')
   return ch+32 if 65<=ch<=90 else ch
  if key=='isspace':
   ch=a&0xffffffff
   if ch==0xffffffff:return 0
   if ch>255:raise RuntimeError('UNMODELED_CRT_CTYPE_ARGUMENT')
   return int.from_bytes(self.read(self.base+0x900+ch*2,2),'little')&8
  if key=='localeconv':self.locale_conv_queries+=1;return self.base+0x400
  if key=='__pctype_func':return self.base+0x900
  if key in ['___lc_codepage_func','___lc_collate_cp_func']:return 0
  if key=='___mb_cur_max_func':return 1
  if key=='___lc_locale_name_func':return self.base+0x300
  if key in ['_lock_locales','_unlock_locales']:
   lock=self.locale_lock
   if key=='_lock_locales':
    if lock['owner'] not in [None,thread]:raise RuntimeError('CRT locale contention requires scheduler')
    lock['owner']=thread;lock['depth']+=1
   else:
    if lock['owner']!=thread or not lock['depth']:raise RuntimeError('CRT locale non-owner release')
    lock['depth']-=1
    if not lock['depth']:lock['owner']=None
   return None
  if key=='setlocale':
   if a>5:raise RuntimeError('UNMODELED_CRT_LOCALE_CATEGORY')
   if b:
    data=bytearray()
    for index in range(256):
     ch=bytes(self.read(b+index,1))
     if ch==b'\0':break
     data+=ch
    if data!=b'C':raise RuntimeError('UNMODELED_CRT_LOCALE')
   self.locale_queries+=1;return self.base+0x100
  if key=='__acrt_iob_func':
   index=a&0xffffffff
   if index>2:raise RuntimeError('UNMODELED_CRT_STREAM_INDEX')
   return self.files[index]
  if key=='_get_stream_buffer_pointers':
   if a not in self.files:raise RuntimeError('UNMODELED_CRT_STREAM')
   for out,slot in [(b,a+8),(c,a+16),(d,a+24)]:
    if out:self.write(out,struct.pack('<Q',slot))
   return 0
  if key in ['_lock_file','_unlock_file']:
   if a not in self.files:raise RuntimeError('UNMODELED_CRT_STREAM')
   lock=self.file_locks.setdefault(a,{'owner':None,'depth':0})
   if key=='_lock_file':
    if lock['owner'] not in [None,thread]:raise RuntimeError('CRT stream contention requires scheduler')
    lock['owner']=thread;lock['depth']+=1
   else:
    if lock['owner']!=thread or not lock['depth']:raise RuntimeError('CRT stream non-owner release')
    lock['depth']-=1
    if not lock['depth']:lock['owner']=None
   return None
  if key=='_crt_atexit':
   if not 0<a<=0xffffffff:raise RuntimeError('UNMODELED_CRT_EXIT_CALLBACK')
   if len(self.callbacks)==1024:return 0xffffffff
   self.write(self.base+0x2000+len(self.callbacks)*8,struct.pack('<Q',a));self.callbacks.append(a);return 0
  if key=='_set_new_handler':
   if a>0xffffffff:raise RuntimeError('UNMODELED_CRT_NEW_HANDLER')
   old=self.new_handler;self.new_handler=a;return old
  raise RuntimeError('Unimplemented CRT process API '+name)
 def snapshot(self):return {'base':self.base,'size':self.size,'callbacks':[str(p) for p in self.callbacks],'fileLocks':self.file_locks,'newHandler':str(self.new_handler),'localeLock':self.locale_lock,'localeQueries':self.locale_queries,'localeConvQueries':self.locale_conv_queries}
