"""Bounded UTF-8 Win32 NLS provider. Other code pages remain unsupported."""
import struct

def convert_utf8(read,write,name,codepage,flags,source,count,out,capacity,default=0,used_default=0):
 wide=name.lower().endswith('widechartomultibyte');codepage&=0xffffffff;flags&=0xffffffff
 if codepage!=65001:raise RuntimeError('UNMODELED_NLS_CODE_PAGE')
 count=struct.unpack('<i',struct.pack('<I',count&0xffffffff))[0];capacity=struct.unpack('<i',struct.pack('<I',capacity&0xffffffff))[0]
 if flags not in [0,128 if wide else 8]:return 0,1004
 if not source or not count or count<-1 or capacity<0 or (wide and (default or used_default)) or (capacity and not out):return 0,87
 width=2 if wide else 1
 if count==-1:
  data=bytearray()
  for i in range(0x100000):
   ch=bytes(read(source+i*width,width));data+=ch
   if not any(ch):break
  else:raise RuntimeError('UNMODELED_NLS_INPUT_SIZE')
 else:
  if count>0x100000:raise RuntimeError('UNMODELED_NLS_INPUT_SIZE')
  data=bytes(read(source,count*width))
 try:
  text=data.decode('utf-16le' if wide else 'utf-8',errors='strict' if flags else 'replace');converted=text.encode('utf-8' if wide else 'utf-16le')
 except UnicodeError:return 0,1113
 units=len(converted)//(1 if wide else 2)
 if not capacity:return units,None
 if capacity<units:return 0,122
 if out<source+len(data) and source<out+len(converted):return 0,87
 if converted:write(out,converted)
 return units,None
