// Produce one content-versioned module so a browser cannot mix service classes
// cached from different setup revisions. The full DLL reference tests import it.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const files=['ctype-c.mjs','windows-srw.mjs','windows-modules.mjs','windows-crt.mjs','windows-encoding.mjs','windows-paths.mjs','windows-files.mjs','windows-lifecycle.mjs','windows-input.mjs','windows-debugger.mjs','windows-console.mjs','windows-stdio.mjs','windows-pipes.mjs','windows-critical.mjs','windows-iocp.mjs','thread-boundary.mjs','windows-exception-ptr.mjs','windows-performance-clock.mjs','windows-msvc-mutex.mjs','guest-scheduler.mjs','game-imports.mjs'];
let source='// Generated service bundle. Source modules retain their own tests.\n';
for(const file of files){let text=await readFile(new URL('../experiments/geode-binary/'+file,import.meta.url),'utf8');text=text.replace(/^import .*;\r?\n/gm,'').replace(/^export \{[^}]*\};\r?\n/gm,'').replace(/^export /gm,'');source+='\n// '+file+'\n'+text;}
source+='\nexport {GuestMsvcMutex as ServiceClass,GuestScheduler,gameFilesystem,BrowserModifiers,inspectCocos};\nexport const SERVICE_NAMES=["AcquireSRWLockExclusive","ReleaseSRWLockExclusive","GetModuleFileNameW","GetLastError","SetLastError",...CRT_NAMES,...ENCODING_NAMES,...PATH_NAMES,...FILE_NAMES,...LIFECYCLE_NAMES,...INPUT_NAMES,...DEBUGGER_NAMES,...CONSOLE_NAMES,...STDIO_NAMES,...PROCESS_NAMES,...PIPE_NAMES,...PIPE_CRT_NAMES,...CRITICAL_NAMES,...IOCP_NAMES,...THREAD_BOUNDARY_NAMES,...EXCEPTION_PTR_NAMES,...PERFORMANCE_CLOCK_NAMES,...MSVC_MUTEX_NAMES];\n';
await writeFile(resolve(process.argv[2],'services.mjs'),source);
