"""Metadata-only handles for declared guest directories; no host filesystem access."""
import ntpath
from guest_windows_paths import full_path
class GuestDirectories:
 def __init__(self,modules):
  self.dirs={};self.images=set();self.handles={};self.next=0x50000000
  for module in modules:
   path=module['path'];self.images.add(path.lower());parent=ntpath.dirname(path)
   while parent:
    self.dirs.setdefault(parent.lower(),parent);above=ntpath.dirname(parent)
    if above==parent:break
    parent=above
 def canonical(self,path):
  if path.startswith('\\\\?\\'):
   path=path[4:]
   if any(p in ['.','..'] for p in path.split('\\')):raise RuntimeError('UNMODELED_EXTENDED_PATH')
  result=full_path(path)
  return result.rstrip('\\') if len(result)>3 else result
 def open(self,path,access,share,security,disposition,flags,template):
  if access or share&~7 or security or disposition!=3 or flags&~0x2000080 or template:raise RuntimeError('FILE_CONTENT_OR_OPEN_MODE_REQUIRED')
  path=self.canonical(path);key=path.lower()
  if key in self.images:raise RuntimeError('IMAGE_FILE_METADATA_REQUIRED')
  if key not in self.dirs:return 0xffffffffffffffff,2 if ntpath.dirname(path).lower() in self.dirs else 3
  if not flags&0x2000000:return 0xffffffffffffffff,5
  handle=self.next;self.next+=4;self.handles[handle]=self.dirs[key];return handle,None
 def path(self,handle,flags):
  if handle not in self.handles:return None,6
  if flags!=0:raise RuntimeError('UNMODELED_FINAL_PATH_FLAGS')
  return '\\\\?\\'+self.handles[handle],None
 def close(self,handle):
  if handle not in self.handles:return 0,6
  del self.handles[handle];return 1,None
 def snapshot(self):return {'directories':self.dirs,'images':sorted(self.images),'handles':self.handles,'next':self.next}
