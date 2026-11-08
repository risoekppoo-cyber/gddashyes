#!/usr/bin/env python3
"""Fetch the pinned official DLL, reusing only an exact SHA-256 match."""
import hashlib,urllib.request,urllib.error,zipfile,io,sys,time
from pathlib import Path
DLL_SHA='ccedc2f1c86baf342f6720b9685991ca31fba246453efe2a1daf609dc40b6499'
ZIP_SHA='54e7b9b08e926204a01fb18506ba73477704167739681003aab4c5d2093f3822'
url='https://github.com/geode-sdk/geode/releases/download/v6.0.0-alpha.1/geode-v6.0.0-alpha.1-win.zip'
target=Path(sys.argv[1])
if target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest()==DLL_SHA:
 print('Reusing SHA-256 verified pinned Geode.dll')
 raise SystemExit(0)
for attempt in range(3):
 try:
  source=url if attempt==0 else url+'?download=1&retry='+str(attempt)
  request=urllib.request.Request(source,headers={'User-Agent':'Geode-startup-verifier','Accept':'application/octet-stream'})
  with urllib.request.urlopen(request,timeout=20) as response:data=response.read()
  break
 except (urllib.error.URLError,TimeoutError,ConnectionError) as error:
  if isinstance(error,urllib.error.HTTPError) and error.code not in [408,429,500,502,503,504]:raise
  if attempt==2:raise
  print('Pinned release download unavailable; retrying official URL')
  time.sleep(attempt+1)
assert hashlib.sha256(data).hexdigest()==ZIP_SHA,'Pinned release archive hash mismatch'
archive=zipfile.ZipFile(io.BytesIO(data))
names=[n for n in archive.namelist() if n.split('/')[-1]=='Geode.dll'];assert len(names)==1
dll=archive.read(names[0]);assert hashlib.sha256(dll).hexdigest()==DLL_SHA,'Pinned DLL hash mismatch'
target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(dll)
print('Downloaded SHA-256 verified pinned Geode.dll')
