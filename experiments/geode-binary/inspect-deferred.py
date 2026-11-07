#!/usr/bin/env python3
"""Bounded instruction/edge inventory of the exact next deferred-loader call."""
import hashlib,json,sys
from pathlib import Path
import pefile,pypcode
from lift import Lifter,LiftError,PIN
data=Path(sys.argv[1]).read_bytes()
assert hashlib.sha256(data).hexdigest()==PIN
pe=pefile.PE(data=data);base=pe.OPTIONAL_HEADER.ImageBase
ctx=pypcode.Context('x86:LE:64:default')
imports={}
for group in [getattr(pe,'DIRECTORY_ENTRY_IMPORT',[]),getattr(pe,'DIRECTORY_ENTRY_DELAY_IMPORT',[])]:
 for desc in group:
  for imp in desc.imports:imports[imp.address]=desc.dll.decode()+'!'+(imp.name.decode() if imp.name else '#'+str(imp.ordinal))
def instruction(rva):
 va=base+rva;b=pe.get_data(rva,32);ins=ctx.disassemble(b,base_address=va,max_instructions=1).instructions[0]
 ops=ctx.translate(b[:ins.length],base_address=va,max_instructions=1).ops
 edges=[]
 for op in ops:
  name=op.opcode.name
  if name in ['CALL','BRANCH','CBRANCH','CALLIND','BRANCHIND','RETURN']:
   edges.append({'kind':name,'inputs':[str(x) for x in op.inputs]})
 return {'rva':hex(rva),'instruction':str(ins),'bytes':b[:ins.length].hex(),'edges':edges},ins,ops
item,ins,ops=instruction(0x12f22d)
targets=[int(op.inputs[0].offset)-base for op in ops if op.opcode.name=='CALL' and op.inputs[0].space.name=='ram']
report={'dllSha256':PIN,'callbackRva':'0x12f200','firstCall':item,'directTargets':[hex(x) for x in targets],'continuation':[],'targets':[]}
at=0x12f22d+ins.length
for _ in range(16):
 row,ins,ops=instruction(at);report['continuation'].append(row);at+=ins.length
 if any(op.opcode.name in ['RETURN','BRANCH','BRANCHIND'] for op in ops):break
for target in targets:
 rows=[];at=target
 for _ in range(24):
  row,ins,ops=instruction(at);rows.append(row);at+=ins.length
  if any(op.opcode.name in ['RETURN','BRANCH','BRANCHIND'] for op in ops):break
 lifter=Lifter(pe,256,allow_indirect=True,yield_unknown=True)
 try:lifter.discover([base+target]);status='TRANSLATABLE'
 except LiftError as error:status=str(error)
 report['targets'].append({'rva':hex(target),'entryInstructions':rows,'closureStatus':status,'discovered':len(lifter.blocks)})
Path('deferred-inspection.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
