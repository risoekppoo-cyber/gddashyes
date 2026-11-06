#!/usr/bin/env python3
"""Pin all primary FMOD import-to-WASM mappings; do not copy proprietary bodies."""
import sys,json,struct,hashlib
from pathlib import Path
from build import PIN,PRIMARY_PIN,signed,w,REGISTER,BASE_GLOBAL

def catalog(module,primary):
 assert hashlib.sha256(module).hexdigest()==PIN and hashlib.sha256(primary).hexdigest()==PRIMARY_PIN
 info=w.inspect(module);bodies=w.function_bodies(module);tables=w.table_elements(module);binder=bodies[24695]
 needle=b'\x10'+w.uint(REGISTER)+b'\x21\x00\x41'+signed(BASE_GLOBAL)+b'\x28\x02\x00\x20\x00\x37\x00'
 registered={};at=0
 while True:
  at=binder.find(needle,at)
  if at<0:break
  candidates=[]
  for n in range(1,6):
   start=at-n-1
   if start>=0 and binder[start]==0x41:
    r=w.Reader(binder[start+1:]);index=r.sint()
    if r.pos==n and 0<index<25363:candidates.append(index)
  assert len(candidates)==1
  r=w.Reader(binder[at+len(needle):]);address=r.uint();assert address not in registered;registered[address]=candidates[0];at+=len(needle)
 pe=struct.unpack_from('<I',primary,60)[0];imp=struct.unpack_from('<I',primary,pe+24+120)[0];symbols={}
 def string(r):return primary[r:primary.index(0,r)].decode()
 for offset in range(imp,imp+4096,20):
  lookup,_,_,dll,thunk=struct.unpack_from('<5I',primary,offset)
  if not dll:break
  if string(dll).lower()!='fmod.dll':continue
  for n in range(1024):
   ptr=struct.unpack_from('<Q',primary,lookup+n*8)[0]
   if not ptr:break
   assert not ptr>>63
   symbol=string(ptr+2);address=0x400000+thunk+n*8;slot=registered[address];function=tables[slot];body=bodies[function]
   assert info['functionTypes'][function]==0
   symbols[symbol]={'primaryIat':address,'table':slot,'function':function,'bodySha256':hashlib.sha256(body).hexdigest(),'returnsOnlyFmodOk':body==bytes.fromhex('00200042003703000b')}
 return {'moduleSha256':PIN,'primarySha256':PRIMARY_PIN,'initializerFunction':24695,'symbols':symbols}
if __name__=='__main__':
 d=catalog(Path(sys.argv[1]).read_bytes(),Path(sys.argv[2]).read_bytes());p=Path(__file__).with_name('adapter-map.json')
 if '--check' in sys.argv:assert json.loads(p.read_text())==d
 else:p.write_text(json.dumps(d,indent=2)+'\n')
 print('Verified FMOD adapter mappings:',len(d['symbols']))
