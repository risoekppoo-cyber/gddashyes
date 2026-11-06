#!/usr/bin/env python3
import hashlib,urllib.request,zipfile,io,sys
from pathlib import Path
url='https://github.com/geode-sdk/geode/releases/download/v6.0.0-alpha.1/geode-v6.0.0-alpha.1-win.zip'
data=urllib.request.urlopen(url,timeout=90).read()
assert hashlib.sha256(data).hexdigest()=='54e7b9b08e926204a01fb18506ba73477704167739681003aab4c5d2093f3822'
archive=zipfile.ZipFile(io.BytesIO(data))
names=[n for n in archive.namelist() if n.split('/')[-1]=='Geode.dll'];assert len(names)==1
dll=archive.read(names[0])
assert hashlib.sha256(dll).hexdigest()=='ccedc2f1c86baf342f6720b9685991ca31fba246453efe2a1daf609dc40b6499'
Path(sys.argv[1]).write_bytes(dll)
