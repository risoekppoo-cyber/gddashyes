# Current continuation — 8 November 2026

Use current main; local mirrors and older source ZIPs may be stale. The parent
reaches _beginthreadex after 12,223 instructions. Its actual requested callback
at RVA 0x4ffab0 runs 1,709 instructions through GuestScheduler, stopping before
KERNEL32.dll!GetQueuedCompletionStatusEx at RVA 0x4f1655.

The final browser check preserved 123 game frames and the original game CPU/
stack (13,932 combined parent/worker instructions). The Windows mutex oracle,
36 reference cases, two worker comparisons and 1,032 division checks pass.
Full CRT thread startup and existing .geode package loading remain unsupported.

## Next immediate task — Medium reasoning

Implement the observed nonblocking batch completion-port poll. The captured
worker.pendingCompletionRequest in setup-browser-result.json specifies:

| Field | Observed value |
| --- | --- |
| Entry capacity | 64 |
| Timeout | 0 ms |
| Alertable | 0 |
| Completion port | Owned guest IOCP |
| Entries output | Non-null |
| Removed-count output | Non-null |

1. Read the official GetQueuedCompletionStatusEx contract and verify output
   layout, empty polls, batch ordering/counts and failed-operation status with
   an actual Windows probe. A Windows CI runner is available through the
   existing repository workflow pattern when local execution is unavailable.
2. Extend windows-iocp.mjs (or a bounded subclass) to consume the actual owned
   packet queue. Preserve count/output semantics on timeout/failure and reject
   unsupported blocking/APC behavior. Do not fabricate packets or return
   successful completion without delivering them.
3. Extend the independent native fixture, service names/bundle and focused tests.
   Compare batch memory/queue state and rerun the actual browser check, then
   record its next precise dependency.

## Completed — do not repeat

- Owned CPU/stack/TIB/TLS, bounded cooperative dispatch and explicit block/wake
  states. Parent CPU/stack/TIB preservation and retained contexts are verified.
- Shared process services with per-thread identity/error state and lock ownership.
- Native-checked pipes, CRT redirection, empty C++ exception-pointer lifetimes,
  monotonic performance-clock queries and required unsigned division.
- MSVC mutex types 2 and 0x102: in-situ init/destroy, lock/try/unlock/current-owns.
  Kernel SRW bookkeeping is shared. Busy locks never report fake success.
- The actual worker called _Mtx_lock and _Mtx_unlock before the new IOCP stop.
  Its tracked mutex is idle at the captured boundary.

## Later stages

- Real _beginthreadex lifecycle and UCRT per-thread initialization, followed by
  resuming the retained parent with genuine handle/ID ownership.
- Real completion-port/pipe blocking and wakeups, joins and thread exit.
- Safe resumable instruction slices: lift_run still faults at its instruction
  limit. The current callback executes one bounded prefix, not a background loop.
- Continue loader initialization and actual mod testing. Keep loader/package
  support flags false until the corresponding operations genuinely work.

Relevant code includes windows-msvc-mutex.mjs, windows-iocp.mjs,
guest-scheduler.mjs, setup-context.mjs, thread-boundary.mjs, build-deferred.py,
handoff/runtime.js, integration-tests/deferred-reference.mjs and browser-smoke.cjs.
MSVC-MUTEX.md records the pinned source and Windows probe evidence.

Preserve allocator ownership and original game state. Do not enable parallel
shared-memory execution or infer free memory from zero bytes. Report actual
results; use NOT_RUN for unavailable checks. Recommend the next prompt's setting
when finishing each task, as the user requested.
