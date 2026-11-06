#!/usr/bin/env python3
"""Download an exact public test input without committing it."""
import sys,gzip,io,urllib.request,urllib.error,time,hashlib
from pathlib import Path
from build import PIN
url='https://raw.githubusercontent.com/Ale7208/geometry-dash-wasm/main/payload/wasm-'+PIN[:24]+'.gz'
for attempt in range(5):
 try:
  with urllib.request.urlopen(url,timeout=45) as response:compressed=response.read(40*1024*1024+1)
  break
 except urllib.error.HTTPError as error:
  if error.code not in [429,500,502,503,504] or attempt==4:raise
  time.sleep(2**attempt)
assert len(compressed)<=40*1024*1024
with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as stream:data=stream.read(125*1024*1024+1)
assert len(data)==123481510 and hashlib.sha256(data).hexdigest()==PIN
p=Path(sys.argv[1]);p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data);print('Verified pinned module:',len(data),'bytes')
