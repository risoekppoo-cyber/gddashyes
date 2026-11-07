// Produce one content-versioned module so a browser cannot mix service classes
// cached from different setup revisions. The full DLL reference tests import it.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const files=['ctype-c.mjs','windows-srw.mjs','windows-modules.mjs','windows-crt.mjs','windows-encoding.mjs','windows-paths.mjs','windows-files.mjs'];
let source='// Generated service bundle. Source modules retain their own tests.\n';
for(const file of files){let text=await readFile(new URL('../experiments/geode-binary/'+file,import.meta.url),'utf8');text=text.replace(/^import .*;\r?\n/gm,'').replace(/^export \{[^}]*\};\r?\n/gm,'').replace(/^export /gm,'');source+='\n// '+file+'\n'+text;}
source+='\nexport {GuestFiles as ServiceClass,gameFilesystem};\nexport const SERVICE_NAMES=["AcquireSRWLockExclusive","ReleaseSRWLockExclusive","GetModuleFileNameW","GetLastError","SetLastError",...CRT_NAMES,...ENCODING_NAMES,...PATH_NAMES,...FILE_NAMES];\n';
await writeFile(resolve(process.argv[2],'services.mjs'),source);
