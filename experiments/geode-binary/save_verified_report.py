#!/usr/bin/env python3
"""Store a compact verified result plus a hash of its full reproducible report."""
import hashlib,json,sys
from pathlib import Path
source=Path(sys.argv[1]);data=source.read_bytes();report=json.loads(data)
assert report['status']=='DLL_STARTUP_PREFIX_VERIFIED' and report['wasmStartupExecuted']
report['reportFormat']='verification-summary-v1';report['fullReportSha256']=hashlib.sha256(data).hexdigest()
report['omittedDetails']=['hostCalls','initializerEvents','crtHeap.live','crtHeap.freeBlocks','nativeFloatingReference.byPc']
for key in ['hostCalls','initializerEvents']:report.pop(key,None)
heap=report.get('crtHeap',{})
for key in ['live','freeBlocks']:
 if key in heap:heap[key+'Count']=len(heap.pop(key))
report.get('nativeFloatingReference',{}).pop('byPc',None)
if len(sys.argv)>3:report['verificationScope']=sys.argv[3]
Path(sys.argv[2]).write_text(json.dumps(report,indent=2)+'\n')
