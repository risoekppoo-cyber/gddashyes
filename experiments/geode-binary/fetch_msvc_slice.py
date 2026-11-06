#!/usr/bin/env python3
"""Extract the pinned official x64 MSVCP DLL without running its installer.

The DLL is a local test input, never bundled in this repository.
"""
import hashlib,sys,urllib.request
from pathlib import Path
PIN='0f885b509a685d2bbfa652fed26b5fb31d88fbdab0a978c641d1c7b8aa460aa9'
EXE_PIN='cc0ff0eb1dc3f5188ae6300faef32bf5beeba4bdd6e8e445a9184072096b713b'
URL='https://download.visualstudio.microsoft.com/download/pr/990c720a-46ce-4dc7-87b9-c2eb615d34b9/CC0FF0EB1DC3F5188AE6300FAEF32BF5BEEBA4BDD6E8E445A9184072096B713B/VC_redist.x64.exe'
def extract(data):
 import libarchive
 if hashlib.sha256(data).hexdigest()!=EXE_PIN:raise RuntimeError('Redistributable hash mismatch')
 cabinet=data[0xa7848:0xa7848+24939223];assert cabinet[:4]==b'MSCF'
 payload=None
 with libarchive.memory_reader(cabinet) as entries:
  for entry in entries:
   if entry.pathname=='a12':payload=b''.join(entry.get_blocks());break
 if payload is None:raise RuntimeError('Pinned x64 payload not found')
 dll=None
 with libarchive.memory_reader(payload) as entries:
  for entry in entries:
   if entry.pathname=='msvcp140.dll_amd64':dll=b''.join(entry.get_blocks());break
 if dll is None or hashlib.sha256(dll).hexdigest()!=PIN:raise RuntimeError('MSVCP x64 DLL hash mismatch')
 return dll
if __name__=='__main__':
 with urllib.request.urlopen(URL,timeout=45) as response:data=response.read(32*1024*1024+1)
 if len(data)>32*1024*1024:raise RuntimeError('Unexpected redistributable size')
 dll=extract(data);out=Path(sys.argv[1]);out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(dll);print('Verified official MSVCP x64 DLL:',len(dll),'bytes',PIN)
