# Verified startup checkpoint - 8 November 2026

The checkpoint executes 12,223 parent instructions and 1,710 worker instructions
(13,933 total). Native-reference checks pass at two image bases, including 36
reference cases, two worker comparisons and 1,032 differential division checks.
The real Chromium run continued for 133 game frames, preserved the original CPU
snapshot and restored the live game stack. Full Geode initialization and existing
.geode package loading remain unsupported.

## Completed continuation

- Windows-verified nonblocking batch IOCP dequeue, including counts, FIFO data,
  empty/error outputs and per-operation status. The actual worker executes an
  empty poll and yields after return. See IOCP-BATCH.md.

- Windows-verified MSVC mutex initialization, ownership, ordinary/recursive
  behavior, try-lock, unlock and disposal. The worker acquires and releases its
  actual mutex; its stop-state mutex is idle. See MSVC-MUTEX.md.

- Fixed-frequency performance queries backed by the real monotonic browser clock;
  one domain is shared across logical threads. See PERFORMANCE-CLOCK.md.
- Unsigned register division with 32/64-bit divisors and full-width dividends.
  Native and BigInt checks cover quotient/remainder, zero-extension, zero divisors
  and quotient overflow; faults preserve the guest CPU and stop explicitly.
- Native-checked empty C++ exception-pointer construction, copying, assignment,
  boolean queries and destruction. Lifetimes and containing heap ownership are
  tracked; non-empty exceptions remain unsupported. See EMPTY-EXCEPTION-PTR.md.
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
worker performed one real nonblocking IOCP poll on the owned empty port. Pipe
bytes were not delivered to that worker in this run; transport and completion
payloads are checked separately against actual Windows and focused guest tests.

## Next exact boundary

The scheduler now executes the real requested callback at RVA 0x4ffab0 in a
separate context, with the supplied argument and a copied static TLS template.
The independent native comparison passes at two DLL bases: the worker executes
1,710 instructions, including its arc-worker-0 thread-name event, mutex lock/
unlock and GetQueuedCompletionStatusEx. It now pauses immediately after the poll
returns, at RVA 0x4f165b.

The call requested 64 entries, timeout zero and alertable false. The empty port
produced false/error 258 and zero removed entries, leaving the entry array
untouched. No packet was invented. This stop is a deliberate cooperative
checkpoint, not a newly discovered unsupported Windows API.

The retained worker has scheduler state runnable, but the current integration
executes only this bounded prefix. The callback has not been resumed beyond the
poll return, and the instruction dispatcher still needs safe resumable slices.

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
states exist; the worker is deliberately paused at the poll-return frontier.
Root continuation still requires actual thread-creation/lifecycle integration.
The next stage is resumable dispatch from the saved CPU state, not restarting
its callback entry or silently treating the worker as a running background task.

Report fields worker and totalTranslatedInstructions distinguish the 1,710 worker
instructions from the 12,223 parent instructions (13,933 total). The worker report
keeps threadCreationImplemented and crtThreadStartupImplemented false. Full
loader/package-support flags remain false. Raw pointers vary by allocator and
must not be hard-coded. Full CRT startup, TLS callbacks and arbitrary native
Cocos method execution remain unfinished.

## Validation

[Native-reference and real-browser validation](https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42472850120)
passes 36 reference cases, two worker cases, 1,032 differential arithmetic checks
and the actual-browser preservation check.
The comparison includes GPRs, XMMs, defined flags, stack, TLS, DLL/heap writes,
callback registration, stdio/pipe/critical/IOCP state and the exact worker request.
Two additional worker comparisons check CPU/XMM/defined flags, the full allocated
heap (including private stack/TIB/TLS), DLL writes and unchanged parent storage.
The focused service and scheduler-foundation tests pass. Recorded Windows oracles cover pipe/CRT text
behavior, critical-section recursion, powf and completion-port packet semantics.

Generated setup WASM, bundled services, manifests and result JSON are published
only after reference and browser validation pass. The launcher revision is
setup-iocp-batch-20261108. See NEXT-CHAT-TASKS.md for the next small tasks;
the older Chat-mode ZIP describes a superseded checkpoint.
