#!/usr/bin/env python3
"""Independent x64 ISA reference: executes original DLL bytes in Unicorn.

This emulates instruction behavior, not Windows or full DLL initialization.
"""
import argparse, hashlib, json, random, struct
from pathlib import Path
import pefile, unicorn
from unicorn import x86_const as xc
from lift import PIN, REGS

p=argparse.ArgumentParser();p.add_argument('dll',type=Path);p.add_argument('--dist',type=Path,required=True)
a=p.parse_args()
assert hashlib.sha256(a.dll.read_bytes()).hexdigest()==PIN
pe=pefile.PE(str(a.dll));manifest=json.loads((a.dist/'manifest.json').read_text())
reg_ids=[getattr(xc,'UC_X86_REG_'+r) for r in REGS]
rng=random.Random(0x6e0de);vectors=[]
for image_base in [pe.OPTIONAL_HEADER.ImageBase,0x30000000]:
    uc=unicorn.Uc(unicorn.UC_ARCH_X86,unicorn.UC_MODE_64)
    uc.mem_map(0x10000,0xf0000)
    pages={((image_base+int(i['rva'],16))&~4095) for i in manifest['instructions']}
    for page in sorted(pages):uc.mem_map(page,4096)
    for i in manifest['instructions']:
        rva=int(i['rva'],16);uc.mem_write(image_base+rva,pe.get_data(rva,i['length']))
    for trial in range(20):
        obj=bytes(rng.randrange(256) for _ in range(256))
        obj=bytearray(obj);obj[0x10]=trial%2;obj[0x11]=(trial//2)%2
        for name,root in manifest['roots'].items():
            initial=[rng.getrandbits(64) for _ in REGS]
            initial[1]=0x40000;initial[2]=trial%2;initial[4]=0x60008
            uc.mem_write(0x40000,struct.pack('<Q',0x40100));uc.mem_write(0x40100,bytes(obj))
            uc.mem_write(0x60008,struct.pack('<Q',0x1234fedc))
            for reg,value in zip(reg_ids,initial):uc.reg_write(reg,value)
            uc.reg_write(xc.UC_X86_REG_EFLAGS,2)
            entry=image_base+int(root['rva'],16)
            uc.emu_start(entry,0x1234fedc,count=128)
            assert uc.reg_read(xc.UC_X86_REG_RIP)==0x1234fedc
            vectors.append({'name':name,'imageBase':hex(image_base),'initial':[hex(x) for x in initial],
              'objectBefore':bytes(obj).hex(),'expected':[hex(uc.reg_read(r)) for r in reg_ids],
              'objectAfter':bytes(uc.mem_read(0x40100,256)).hex()})
out={'reference':'Original DLL bytes executed by Unicorn '+unicorn.__version__,
 'dllSha256':PIN,'windowsLoaderTested':False,'registers':REGS,'vectors':vectors}
(a.dist/'reference.json').write_text(json.dumps(out,separators=(',',':'))+'\n')
print(json.dumps({'reference':'Unicorn','cases':len(vectors),'functions':len(manifest['roots'])}))
