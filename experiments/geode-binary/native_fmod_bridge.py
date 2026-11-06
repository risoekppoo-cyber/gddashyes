"""Explicit return-only browser adapter, not a native FMOD DLL implementation."""
from pathlib import Path
import json,struct
from guest_modules import shim
BASE=0x14000000
SYMBOL='?init@System@FMOD@@QEAA?AW4FMOD_RESULT@@HIPEAX@Z'
ENTRY_BYTES=b'\x90'*16+bytes.fromhex('b800000000c3')
class OwnedBridgeWriteRequired(Exception):
 def __init__(self,event):self.event=event

def provider(imports):
 evidence=json.loads((Path(__file__).parent.parent/'fmod-bridge/result.json').read_text())
 assert evidence['status']=='FMOD_BRIDGE_CONTRACT_PASS' and evidence['module']=='523d9362955eba27a8ce64ec9b4fda496c8ecc30e6ac9ca1f01cc76c89a5a15a'
 assert evidence['nativeReadableEntryVerified'] and evidence['nativeGeneralRegistersMatchBrowserContract']
 catalog=json.loads((Path(__file__).parent.parent/'fmod-bridge/adapter-map.json').read_text());assert catalog['moduleSha256']==evidence['module']
 targets={name.split('!',1)[1]:address for address,name in imports.items() if name.lower().startswith('fmod.dll!') and name.split('!',1)[1] in catalog['symbols']}
 assert SYMBOL in targets and len(targets)<=64
 module,image,gates=shim('fmod.dll',BASE,list(targets));image=bytearray(image);entries={}
 for index,full in enumerate(gates.values()):
  symbol=full.split('!',1)[1];entry=BASE+0x1000+index*64;metadata=catalog['symbols'][symbol]
  # Unsupported stateful adapters have a real tail gate, never fabricated successful execution.
  code=ENTRY_BYTES if metadata['returnsOnlyFmodOk'] else b'\x90'*16+bytes.fromhex('ff2500000000')+struct.pack('<Q',targets[symbol])
  struct.pack_into('<I',image,0x2100+index*4,entry-BASE);image[entry-BASE:entry-BASE+len(code)]=code
  entries[symbol]={'address':entry,'codeHex':code.hex(),'gateway':targets[symbol],**metadata}
 module.update(browserAdapterProvider=True,staticTls=False,entryAddress=entries[SYMBOL]['address'],entries=entries,originalFmodDll=False)

 return module,bytes(image)
