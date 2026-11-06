#!/usr/bin/env python3
"""Make a non-playable fixture from pinned upstream bytes; never bundle game code."""
import sys,json,hashlib,struct
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'tools'))
import wasm_probe as w
PIN='523d9362955eba27a8ce64ec9b4fda496c8ecc30e6ac9ca1f01cc76c89a5a15a'
PRIMARY_PIN='dab65e0527e343f03ea08614b2967f5a20cdb481b1622aadde76cde648803c2a'
TARGET=24950;TABLE=24570;REGISTER=24581;DISPATCH=24579;BINDER=24695;BASE_GLOBAL=346225600

def signed(n):
 out=bytearray()
 while True:
  byte=n&127;n>>=7;more=not (n==0 and not byte&64 or n==-1 and byte&64);out.append(byte|(128 if more else 0))
  if not more:return bytes(out)

def name(s):
 b=s.encode();return w.uint(len(b))+b

def build(module,primary,out):
 assert hashlib.sha256(module).hexdigest()==PIN,'Unsupported game module'
 assert hashlib.sha256(primary).hexdigest()==PRIMARY_PIN,'Unsupported primary image'
 pe=struct.unpack_from('<I',primary,60)[0];imp=struct.unpack_from('<I',primary,pe+24+120)[0];iat=None
 def string(r):return primary[r:primary.index(0,r)].decode()
 symbol='?init@System@FMOD@@QEAA?AW4FMOD_RESULT@@HIPEAX@Z'
 for offset in range(imp,imp+4096,20):
  lookup,_,_,dll,thunk=struct.unpack_from('<5I',primary,offset)
  if not dll:break
  if string(dll).lower()!='fmod.dll':continue
  for n in range(1024):
   ptr=struct.unpack_from('<Q',primary,lookup+n*8)[0]
   if not ptr:break
   if not ptr>>63 and string(ptr+2)==symbol:iat=0x400000+thunk+n*8
 assert iat==0xace740
 info=w.inspect(module);bodies=w.function_bodies(module);table=w.table_elements(module)
 assert table[TABLE]==TARGET and info['functionTypes'][TARGET]==0
 assert info['types'][0]=={'params':[127],'results':[]}
 original=bodies[TARGET];assert original==bytes.fromhex('00200042003703000b'),'Adapter semantics changed'
 binding=b'\x41'+signed(TABLE)+b'\x10'+w.uint(REGISTER)+b'\x21\x00\x41'+signed(BASE_GLOBAL)+b'\x28\x02\x00\x20\x00\x37\x00'+w.uint(iat)
 assert bodies[BINDER].count(binding)==1,'FMOD IAT binding did not match'
 ss=w.sections(module);data=dict(ss);r=w.Reader(data[4]);assert r.uint()==1 and r.byte()==0x70 and r.uint()==1
 size,maximum=r.uint(),r.uint();assert size==maximum==25363
 imported=len(info['imports']);total=imported+info['definedFunctions'];clone=total;probe=total+1
 selected={TARGET,DISPATCH,REGISTER,24574}
 payloads=[]
 for n,b in bodies.items():payloads.append(b if n in selected else bytes.fromhex('00000b'))
 payloads[TARGET-imported]=b'\x00\x20\x00\x41'+signed(size)+b'\x11\x00\x00\x0b'
 payloads+=[original,b'\x00\x20\x00\x10'+w.uint(TARGET)+b'\x0b']
 fr=w.Reader(data[3]);count=fr.uint();types=data[3][fr.pos:];er=w.Reader(data[7]);exports=er.uint();old_exports=data[7][er.pos:]
 extra={'westminster_original_fmod_init':clone,'westminster_entry_fmod_init':TARGET,'fmod_direct_probe':probe,'westminster_dispatch':DISPATCH,'fmod_register':REGISTER}
 replacements={3:w.uint(count+2)+types+b'\x00\x00',4:w.uint(1)+b'\x70\x01'+w.uint(size+1)+w.uint(size+1),7:w.uint(exports+len(extra))+old_exports+b''.join(name(k)+b'\x00'+w.uint(v) for k,v in extra.items()),10:w.uint(len(payloads))+b''.join(w.uint(len(b))+b for b in payloads)}
 assert 8 not in data
 fixture=module[:8]+b''.join(bytes([i])+w.uint(len(replacements.get(i,p)))+replacements.get(i,p) for i,p in ss if i not in [11,12])
 out.mkdir(parents=True,exist_ok=True);(out/'fixture.wasm').write_bytes(fixture)
 # This is our owned, readable Win64 bridge contract, not original FMOD DLL bytes.
 native_entry=b'\x90'*16+bytes.fromhex('b800000000c3')
 manifest={'moduleSha256':PIN,'primarySha256':PRIMARY_PIN,'symbol':symbol,'iat':iat,'table':TABLE,'function':TARGET,'slot':size,'originalBodySha256':hashlib.sha256(original).hexdigest(),'fixtureSha256':hashlib.sha256(fixture).hexdigest(),'nativeEntryHex':native_entry.hex(),'nativeEntryKind':'owned Win64 bridge matching the pinned return-only adapter','fullGameBootTested':False,'geodeLoaded':False,'startupBoundaryCleared':False}
 (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(manifest))
if __name__=='__main__':build(Path(sys.argv[1]).read_bytes(),Path(sys.argv[2]).read_bytes(),Path(sys.argv[3]))
