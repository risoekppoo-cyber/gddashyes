"""Lexical paths in the declared C-drive namespace; no filesystem lookups."""
import ntpath
CWD='C:\\WestminsterDash'
def full_path(value):
 value=value.replace('/','\\')
 if not value or value.startswith('\\\\') or '\x00' in value:raise RuntimeError('UNMODELED_WINDOWS_PATH')
 drive,tail=ntpath.splitdrive(value)
 if drive and drive.lower()!='c:':raise RuntimeError('UNMODELED_WINDOWS_DRIVE')
 for part in tail.split('\\'):
  if any(c in part for c in '*?"<>|:') or part not in ['.','..'] and part.endswith((' ','.')):raise RuntimeError('UNMODELED_WINDOWS_PATH')
 result=ntpath.normpath(ntpath.join(CWD,value))
 if value.endswith('\\') and not result.endswith('\\'):result+='\\'
 return result
