# Verified startup checkpoint - 7 November 2026

Setup executes 12,223 native startup instructions. Eight native-reference cases
pass at two image bases. The real Chromium run continued for 128 game frames,
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
startup prefix has not yet run the worker that consumes the pipe. Actual byte
transport and completion delivery are covered by focused tests and independent
native Windows probes; they are not claimed as worker activity in the browser.

## Next exact boundary

The scheduler foundation now exists in guest-scheduler.mjs. It owns isolated CPU,
stack and TIB/TLS allocations and dispatches bounded synchronous slices. It tracks
runnable, blocked, exited and failed contexts, supports explicit wakeup, restores
the caller's service context and attempts each allocation's cleanup independently.
Shared services select per-thread IDs, last-error/errno and lock ownership.
Focused tests exercise context isolation across memory growth, shared locks and
failure cleanup. This foundation is not connected to the live startup lift yet;
its tests do not execute the real Geode worker or establish its CRT entry ABI.

    api-ms-win-crt-runtime-l1-1-0.dll!_beginthreadex
    Worker entry RVA: 0x4ffab0

Native reference and browser agree on the complete call profile:

    security:           null
    stackSize:          0 (default)
    entry:              imageBase + 0x4ffab0
    argument:           non-null owned guest object
    initFlags:          0 (start runnable)
    threadIdOutput:     non-null guest stack address

The addressable import trap lets translation reach the actual API entry and
capture its arguments. It stops before executing a thread API body; no thread
handle, thread ID or successful creation is fabricated. The report exposes this
as pendingThreadRequest with threadCreationImplemented=false. Raw argument and
output addresses vary with the allocator and must not be hard-coded.

This checkpoint is not resumable: runtime frees the temporary root CPU shadow
after recording it. A real cooperative scheduler must retain root/worker CPU
contexts, own their stacks and TIB/TLS, share process services, and implement
blocking, wakeup and lifecycle transitions before startup can continue safely.
Full CRT startup, TLS callbacks and general native Cocos calls also remain
unfinished. The Cocos address binding does not implement arbitrary method calls.

## Validation

[Native-reference and real-browser validation](https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42401498284)
passes all eight reference cases and the actual-browser preservation check.
The comparison includes GPRs, XMMs, defined flags, stack, TLS, DLL/heap writes,
callback registration, stdio/pipe/critical/IOCP state and the exact worker request.
The focused service and scheduler-foundation tests pass. Recorded Windows oracles cover pipe/CRT text
behavior, critical-section recursion, powf and completion-port packet semantics.

Generated setup WASM, bundled services, manifests and result JSON are published
only after reference and browser validation pass. The launcher revision is
setup-worker-boundary-20261107. See NEXT-CHAT-TASKS.md for the next small tasks;
the older Chat-mode ZIP describes a superseded checkpoint.
