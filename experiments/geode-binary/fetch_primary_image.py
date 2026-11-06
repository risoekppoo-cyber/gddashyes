#!/usr/bin/env python3
"""Recover the hash-pinned primary image for the standalone ASLR guest test."""
import gzip,hashlib,sys,urllib.request,concurrent.futures
from pathlib import Path
PIN='dab65e0527e343f03ea08614b2967f5a20cdb481b1622aadde76cde648803c2a'
START,END=179142218,192368202
CHUNKS=[(176160768, 'a2f5e21a608b83fc2162bab4a63566123f01578540a884593e63a0a0dd4339ad'), (180355072, '1d6f2b03305a1930f24bab451d7ca401ee7d70cf727b5df04f7961597e933e9b'), (184549376, '42b7faace9614b47ea7c6fefc42fd3bfa754e6b79714f271d3bd5b35b4da0ada'), (188743680, 'eb86d36f313282d9e15c2b72aba08fe1b611aaf26eb800e4af1d032bd55dc3ad')]
def fetch(chunk):
 offset,digest=chunk
 with urllib.request.urlopen('https://raw.githubusercontent.com/Ale7208/geometry-dash-wasm/main/payload/data-'+digest[:24]+'.gz',timeout=45) as response:compressed=response.read(8*1024*1024+1)
 if len(compressed)>8*1024*1024:raise RuntimeError('Unexpected payload chunk size')
 data=gzip.decompress(compressed)
 if len(data)!=4194304 or hashlib.sha256(data).hexdigest()!=digest:raise RuntimeError('Primary-image chunk hash mismatch')
 return offset,data
if __name__=='__main__':
 image=bytearray(END-START)
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
  for offset,data in pool.map(fetch,CHUNKS):
   first,last=max(START,offset),min(END,offset+len(data));image[first-START:last-START]=data[first-offset:last-offset]
 if hashlib.sha256(image).hexdigest()!=PIN:raise RuntimeError('Primary-image hash mismatch')
 out=Path(sys.argv[1]);out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(image);print('Verified primary image:',len(image),'bytes',PIN)
