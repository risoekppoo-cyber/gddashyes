#!/usr/bin/env python3
"""Hash-pinned Microsoft VCRUNTIME input; extracts CAB bytes, never runs installer."""
import sys,urllib.request
from pathlib import Path
from fetch_msvc_slice import URL,extract
PIN='d5e4d9a3e835fa679450145d6a7d94e36573a509317111904d9b3712c30d9066'
if __name__=='__main__':
 if len(sys.argv)>2:data=Path(sys.argv[2]).read_bytes()
 else:
  with urllib.request.urlopen(URL,timeout=45) as response:data=response.read(32*1024*1024+1)
  if len(data)>32*1024*1024:raise RuntimeError('Unexpected redistributable size')
 dll=extract(data,'vcruntime140.dll_amd64',PIN);out=Path(sys.argv[1]);out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(dll)
 print('Verified official VCRUNTIME x64 DLL:',len(dll),'bytes',PIN)
