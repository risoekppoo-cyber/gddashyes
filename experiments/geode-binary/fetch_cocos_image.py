#!/usr/bin/env python3
"""Extract only the exact pinned Cocos memory image; never commit its bytes."""
import concurrent.futures,gzip,hashlib,sys,urllib.request
from pathlib import Path
PIN='1ade9d1b9603d82a41f2211348ec98516098b6d012114f785a763b8762512257'
START,END=192699978,194600522
CHUNKS=[(188743680,'eb86d36f313282d9e15c2b72aba08fe1b611aaf26eb800e4af1d032bd55dc3ad'),(192937984,'a3c1d58ac5b24887ffc04d75016053376d5d620432093e27e671bc85c969cfc3')]
def fetch(chunk):
 offset,digest=chunk;url='https://raw.githubusercontent.com/Ale7208/geometry-dash-wasm/main/payload/data-'+digest[:24]+'.gz'
 with urllib.request.urlopen(url,timeout=45) as response:compressed=response.read(8*1024*1024+1)
 if len(compressed)>8*1024*1024:raise RuntimeError('Unexpected compressed chunk size')
 data=gzip.decompress(compressed)
 if len(data)!=4194304 or hashlib.sha256(data).hexdigest()!=digest:raise RuntimeError('Payload chunk hash mismatch')
 return offset,data
if __name__=='__main__':
 output=Path(sys.argv[1]);image=bytearray(END-START)
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  for offset,data in pool.map(fetch,CHUNKS):
   first,last=max(START,offset),min(END,offset+len(data));image[first-START:last-START]=data[first-offset:last-offset]
 if hashlib.sha256(image).hexdigest()!=PIN:raise RuntimeError('Cocos image hash mismatch')
 output.parent.mkdir(parents=True,exist_ok=True);output.write_bytes(image);print('Verified pinned Cocos image:',len(image),'bytes',PIN)
