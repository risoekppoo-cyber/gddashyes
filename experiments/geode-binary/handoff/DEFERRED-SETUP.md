# Verified startup checkpoint - 7 November 2026

Setup executes 12,223 native startup instructions. Eight native-reference cases
pass at two image bases. The real Chromium run continued for 138 game frames,
preserved the original CPU snapshot and restored the live game stack. Full Geode
initialization and existing .geode package loading remain unsupported.

## Completed continuation

- Owned named-pipe server/client endpoints and byte queues, with CRT freopen_s
  preserving FILE identity and the saved stdout descriptor. Text writes convert
  LF to CRLF; pending reads, completed reads, EOF, close and error delivery are
  implemented for the supported pipe profile.
- Completion-port creation, pipe association, posted packets, read-completion
  packets and nonblocking dequeue. Empty polls preserve the Windows-observed
  outputs. Blocking waits explicitly require a scheduler.
- Critical-section initialization, recursive ownership, try/enter/leave/delete,
  and condition-variable initialization/wakes when there are no waiters.
  Contention and blocking remain unsupported.
- Observed LOCK/UNLOCK translation under a strictly non-shared, single-CPU
  profile, plus the finite positive powf range exercised by startup.
- The earlier live Cocos export binding, thread-name event, detached-console
  queries, owned FILE/descriptors, allocator ownership, static TLS template,
  timestamp bootstrap and onexit registration remain verified.

The real browser has created and connected the geode-stdout-1 named pipe,
redirected stdout to its client, preserved the original stdout as descriptor 3,
initialized an idle critical section and created an empty completion port. The
worker prefix has not yet reached its pipe-consumer loop. Actual byte
transport and completion delivery are covered by focused tests and independent
native Windows probes; they are not claimed as worker activity in the browser.

## Next exact boundary

The scheduler now executes the real requested callback at RVA 0x4ffab0 in a
separate context, with the supplied argument and a copied static TLS template.
The independent native comparison passes at two DLL bases: the worker executes
557 instructions, including shared-process service calls and its arc-worker-0
thread-name event, then pauses at:

    MSVCP140.dll!?__ExceptionPtrCreate@@YAXPEAX@Z
    Worker stop RVA: 0xa557f0

The parent still stops at the actual thread-creation API entry:

    api-ms-win-crt-runtime-l1-1-0.dll!_beginthreadex
    Worker entry RVA: 0x4ffab0

Native reference and browser agree on the complete call profile:

    security:           null
    stackSize:          0 (default)
    entry:              imageBase + 0x4ffab0
    argument:           non-null owned guest object
    initFlags:          0 (start runnable)
    threadIdOutput:     non-null guest stack address

The import trap captures the actual API arguments before any successful return.
The diagnostic scheduler invokes the native-verified callback prefix under the
explicit static-TLS model. This does not implement the UCRT thread-start wrapper,
per-thread CRT initialization, a returned thread handle, join or thread exit.
No successful _beginthreadex return or thread-ID output write is fabricated.

The browser retains the child's CPU/stack/TIB/TLS and a copy of the parent's CPU;
the parent's private stack and TIB remain owned by SetupContext. Worker execution
checks that the parent CPU, stack and TIB stay unchanged. Explicit block/wake
states exist, but the worker is paused at an unsupported service rather than
waiting on a running pipe consumer. Root continuation still requires actual
thread-creation/lifecycle integration and the next C++ runtime dependencies.

Report fields worker and totalTranslatedInstructions distinguish the 557 worker
instructions from the 12,223 parent instructions (12,780 total). The worker report
keeps threadCreationImplemented and crtThreadStartupImplemented false. Full
loader/package-support flags remain false. Raw pointers vary by allocator and
must not be hard-coded. Full CRT startup, TLS callbacks and arbitrary native
Cocos method execution remain unfinished.

## Validation

[Native-reference and real-browser validation](https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42420056396)
passes eight parent cases, two worker cases and the actual-browser preservation check.
The comparison includes GPRs, XMMs, defined flags, stack, TLS, DLL/heap writes,
callback registration, stdio/pipe/critical/IOCP state and the exact worker request.
Two additional worker comparisons check CPU/XMM/defined flags, the full allocated
heap (including private stack/TIB/TLS), DLL writes and unchanged parent storage.
The focused service and scheduler-foundation tests pass. Recorded Windows oracles cover pipe/CRT text
behavior, critical-section recursion, powf and completion-port packet semantics.

Generated setup WASM, bundled services, manifests and result JSON are published
only after reference and browser validation pass. The launcher revision is
setup-worker-callback-20261107. See NEXT-CHAT-TASKS.md for the next small tasks;
the older Chat-mode ZIP describes a superseded checkpoint.
