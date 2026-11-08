"""Prepare an upstream Jukebox build without changing its C++ or resources."""
import argparse,hashlib,json,subprocess
from pathlib import Path
PIN='abb0b3c9f87336acb594278de5b25525d9177dcf'
TARGET='6.0.0-alpha.1'
def tracked(root):
 names=subprocess.check_output(['git','-C',str(root),'ls-files','-z']).decode().split('\0')
 return {n:hashlib.sha256((root/n).read_bytes()).hexdigest() for n in names if n and n!='mod.json'}
def main():
 p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('--verify',action='store_true');a=p.parse_args();root=a.source.resolve()
 assert subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD']).decode().strip()==PIN,'Unpinned upstream source'
 receipt=Path('jukebox-source-build-receipt.json')
 if a.verify:
  data=json.loads(receipt.read_text());assert tracked(root)==data['upstreamFiles'],'Upstream source/resources changed'
  current=json.loads((root/'mod.json').read_text());assert current==data['targetManifest'],'Unexpected manifest changes'
  data.update(sourceAndResourcesUnchanged=True,status='ORIGINAL_SOURCE_NATIVE_BUILD_VERIFIED',browserModLoaded=False)
 else:
  original=json.loads((root/'mod.json').read_text());assert original['id']=='fleym.nongd' and original['gd']['win']=='2.2091'
  target=json.loads(json.dumps(original));target['geode']=TARGET
  data={'sourceRepository':'Fleeym/jukebox','sourceCommit':PIN,'originalManifest':original,'targetManifest':target,'upstreamFiles':tracked(root),'changes':['mod.json: geode SDK build target only'],'sourceAndResourcesUnchanged':True,'status':'BUILD_PREPARED','browserModLoaded':False}
  (root/'mod.json').write_text(json.dumps(target,indent=2)+'\n')
 receipt.write_text(json.dumps(data,indent=2)+'\n');print(json.dumps({k:data[k] for k in ['sourceCommit','changes','status','browserModLoaded']}))
if __name__=='__main__':main()
