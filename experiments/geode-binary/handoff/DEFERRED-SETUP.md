# Verified startup checkpoint - 8 November 2026

The parent executes 12,223 instructions to _beginthreadex. The requested worker
now completes four empty nonblocking completion polls, resuming its retained CPU
between browser frames. The final Chromium run executed 4,379 worker instructions
(16,602 total), continued for 142 game frames, preserved the original game CPU
and restored the live stack. Full Geode initialization and existing .geode
package loading remain unsupported.

The independent deterministic native trace executes 4,383 worker instructions.
The live monotonic clock can choose a shorter observed branch; the browser
report records its actual count. Unknown instruction targets and unsupported
service calls still stop explicitly.

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
worker performed four real nonblocking IOCP polls on the owned empty port. Pipe
bytes were not delivered to that worker in this run; transport and completion
payloads are checked separately against actual Windows and focused guest tests.


## Resumption now verified

The actual callback at RVA 0x4ffab0 receives the original owned argument and its
own CPU, stack, TIB/TLS, thread ID and errno. Static TLS is initialized once.
The first poll returns at RVA 0x4f165b after 1,710 native instructions. Subsequent
dispatches resume that saved RIP; they do not restart the callback entry.

The slice export retains RIP/registers at its instruction budget. Seven direct
contract checks cover zero budgets, exact-budget stops, unknown transfers,
invalid limits and the legacy lift_run failure contract. The browser uses at
most 127 native instructions per slice. Its three later dispatches ran at game
frames 1, 2 and 3, completing four real polls in total.

An independently owned compiler stack remains valid after the temporary handoff
stack is freed. The parent CPU clone, parent private stack/TIB and child
CPU/stack/TIB/TLS remain owned until release. Every dispatch preserves the
parent's private storage and the current original game CPU. Page hide cancels
pending browser dispatch and releases owned storage.

This diagnostic deliberately stops after the measured four-poll sequence. The
worker remains runnable at the poll-return checkpoint; it is not an unbounded
background loop. A nonzero completion wait is retained at API entry as blocked,
without supplying an API result or inventing a packet. Timed waits and wakeup
delivery remain future work. See RESUMABLE-SLICES.md for the exact contract.

## Next exact blocker

The parent still stops at the actual thread-creation API entry:

    api-ms-win-crt-runtime-l1-1-0.dll!_beginthreadex
    Worker entry RVA: 0x4ffab0

Native reference and browser agree on the request:

    security:           null
    stackSize:          0 (default)
    entry:              imageBase + 0x4ffab0
    argument:           non-null owned guest object
    initFlags:          0 (start runnable)
    threadIdOutput:     non-null guest stack address

No successful return, handle or thread-ID write has been fabricated. The child
runs under the explicit static-TLS diagnostic model; UCRT thread initialization,
full TLS callbacks, handle lifetime, exit and join are not yet implemented.
The next useful advance is actual thread-creation/lifecycle integration followed
by parent resumption, rather than increasing the number of empty worker polls.

worker.threadCreationImplemented and worker.crtThreadStartupImplemented remain
false. Raw pointers vary with the allocator and must not be hard-coded. Full
CRT startup and arbitrary native Cocos method execution remain unfinished.

## Validation

[Native-reference and browser validation](https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42482024559)
passes 40 whole reference cases and their 40 sliced counterparts at both DLL
bases, including six worker/clock-profile cases and six sliced worker cases.
Clock profiles insert zero, approximately 17 ms, or 100 ms between continuations.
Worker checks used 702 scheduler slices; seven slice-contract checks and 1,032
independent differential arithmetic checks also pass.

The comparison includes GPRs, XMMs, defined flags, service order, complete
allocated heap/stack/TIB/TLS, DLL writes and unchanged parent storage. Existing
stdio, pipes, critical sections, completion ports, mutexes and exception-pointer
tests remain passing. Recorded Windows API oracles remain unchanged.

[Live handoff regression validation](https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42482024387)
also passes. Generated setup WASM, bundled services, manifests and result JSON
are published only after reference and browser checks succeed. The launcher
revision is setup-worker-frames-20261108. NEXT-CHAT-TASKS.md records the current
continuation; older source ZIPs describe superseded checkpoints.
