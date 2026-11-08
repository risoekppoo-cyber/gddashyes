"""Inspect the actual Jukebox package against the pinned loader, without executing it."""
import argparse,hashlib,io,json,time,urllib.request,zipfile
from pathlib import Path
import pefile
PACKAGE_URL='https://github.com/Fleeym/jukebox/releases/download/v3.8.0/fleym.nongd.geode'
PACKAGE_SHA='a0eca6c82c7fa6149b956a809a9058959957d7c4672368b6933ea030e641b621'
DLL_SHA='ccedc2f1c86baf342f6720b9685991ca31fba246453efe2a1daf609dc40b6499'
def download():
 for attempt in range(3):
  try:
   with urllib.request.urlopen(PACKAGE_URL+'?attempt='+str(attempt),timeout=45) as r:data=r.read(32*1024*1024+1)
   assert hashlib.sha256(data).hexdigest()==PACKAGE_SHA,'Official package SHA mismatch'
   return data
  except Exception:
   if attempt==2:raise
   time.sleep(1)
def main():
 p=argparse.ArgumentParser();p.add_argument('loader',type=Path);p.add_argument('--package',type=Path);p.add_argument('--rebuilt',action='store_true');p.add_argument('--out',default='jukebox-package-preflight.json');a=p.parse_args()
 loader_data=a.loader.read_bytes();assert hashlib.sha256(loader_data).hexdigest()==DLL_SHA,'Unpinned loader'
 data=a.package.read_bytes() if a.package else download();digest=hashlib.sha256(data).hexdigest()
 if not a.rebuilt:assert digest==PACKAGE_SHA,'Not the pinned upstream package'
 else:
  receipt=json.loads(Path('jukebox-source-build-receipt.json').read_text());assert receipt['sourceAndResourcesUnchanged'] and receipt['status']=='ORIGINAL_SOURCE_NATIVE_BUILD_VERIFIED'
 z=zipfile.ZipFile(io.BytesIO(data));manifest=json.loads(z.read('mod.json'));assert manifest['id']=='fleym.nongd'
 candidates=[n for n in z.namelist() if n.endswith('.dll')];assert len(candidates)==1,f'Ambiguous Windows DLL: {candidates}'
 mod=pefile.PE(data=z.read(candidates[0]));loader=pefile.PE(data=loader_data);assert mod.FILE_HEADER.Machine==0x8664,'Not a Win64 mod'
 exports={s.name.decode():s.address for s in loader.DIRECTORY_ENTRY_EXPORT.symbols if s.name};ordinals={s.ordinal for s in loader.DIRECTORY_ENTRY_EXPORT.symbols}
 imports={};missing=[]
 for group in [getattr(mod,'DIRECTORY_ENTRY_IMPORT',[]),getattr(mod,'DIRECTORY_ENTRY_DELAY_IMPORT',[])]:
  for entry in group:
   dll=entry.dll.decode();symbols=[i.name.decode() if i.name else '#'+str(i.ordinal) for i in entry.imports];imports.setdefault(dll,[]).extend(symbols)
   if dll.lower()=='geode.dll':
    missing.extend(s for s in symbols if (int(s[1:]) not in ordinals if s.startswith('#') else s not in exports))
 major=manifest['geode'].lstrip('v').split('.')[0]
 blockers=[]
 if major!='6':blockers.append('package requires Geode '+manifest['geode']+'; loader is 6.0.0-alpha.1')
 if manifest['gd'].get('win')!='2.2091':blockers.append('Windows GD requirement '+str(manifest['gd'].get('win'))+' differs from pinned 2.2091')
 if missing:blockers.append(str(len(missing))+' Geode import symbols absent from pinned loader')
 blockers.extend(['browser Geode loader still stops at _beginthreadex','original Jukebox Cocos UI, hooks and web callbacks have not been executed'])
 report={'status':'PACKAGE_PREFLIGHT_COMPLETE','packageSha256':digest,'officialReleasePackage':not a.rebuilt,'loaderSha256':DLL_SHA,'manifest':manifest,'dll':candidates[0],'dllSha256':hashlib.sha256(z.read(candidates[0])).hexdigest(),'machine':mod.FILE_HEADER.Machine,'entryRva':mod.OPTIONAL_HEADER.AddressOfEntryPoint,'imageSize':mod.OPTIONAL_HEADER.SizeOfImage,'imports':imports,'missingGeodeSymbols':missing,'resourceFiles':[n for n in z.namelist() if not n.endswith('.dll')],'blockers':blockers,'browserLoadable':False,'originalUIExecuted':False}
 Path(a.out).write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({'packageSha256':digest,'geode':manifest['geode'],'gd':manifest['gd'],'imports':{k:len(v) for k,v in imports.items()},'missingGeodeSymbols':missing[:8],'blockers':blockers},indent=2))
 if a.rebuilt:assert major=='6' and not missing,'Rebuilt package still has SDK ABI gaps'
if __name__=='__main__':main()
