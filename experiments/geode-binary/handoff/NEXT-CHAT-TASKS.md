# Current continuation

Use current main; earlier source ZIPs are historical. The parent reaches
_beginthreadex after 12,223 instructions. The real requested callback at RVA
0x4ffab0 now runs 623 instructions through GuestScheduler, stopping at
KERNEL32.dll!QueryPerformanceFrequency (RVA 0x512bfc).
Native worker comparisons pass at two image bases. The browser executed the
same worker prefix and preserved 149 game frames (12,846 combined instructions). Full loader initialization
and existing .geode packages remain unsupported.

## Implemented

- Owned CPU, stack and TIB/TLS per callback context; bounded synchronous dispatch,
  explicit block/wake states, failure/exit state and independent cleanup.
- Shared process memory/handles/services with per-thread IDs, last-error/errno,
  critical-section ownership and SRW ownership.
- Actual translated worker callback under the explicit static-TLS fixture model.
  Parent CPU/stack/TIB preservation and two native worker state comparisons.
- Retained worker context and owned copy of the parent CPU at the browser stop.

## Next small tasks

1. Implement the observed performance-clock queries using an explicit monotonic
   browser clock and consistent integer frequency/counter units. Inspect the
   Windows contract and capture native behavior before choosing the clock
   profile. Do not return arbitrary successful constants for unsupported timers.
   Empty exception_ptr Create/Destroy/Copy/Assign/ToBool are implemented and
   native-checked; non-empty capture, rethrow and unwinding remain unsupported.
2. Extend the worker native fixture and translation only through its next observed
   dependency. Keep both image bases, parent/worker isolation and full memory
   comparisons. Stop explicitly when another unknown service is reached.
3. Implement actual _beginthreadex lifecycle: inspect the UCRT wrapper and its
   per-thread initialization, connect the already-owned callback context to a
   real guest thread handle/ID, then resume the retained parent. The current
   callback diagnostic does not return a successful creation or write the ID.
4. Implement real block/wake delivery for pipe and completion-port consumers,
   followed by observed join/exit/handle cleanup. Use instruction slices that
   yield safely; lift_run currently faults if its instruction limit is exhausted.
   Dispatch one verified callback prefix only until resumable slicing is wired.
5. Continue startup and compare independent native traces, then test the actual
   browser. Keep loader/package-support flags false until they truly work.

Relevant files: experiments/geode-binary/{guest-scheduler,setup-context,
thread-boundary,windows-pipes,windows-iocp,windows-critical}.mjs,
build-deferred.py, handoff/runtime.js, integration-tests/deferred-reference.mjs,
integration-tests/guest-scheduler.mjs, integration-tests/browser-smoke.cjs and
.github/workflows/geode-deferred.yml.

Preserve allocator ownership, original game CPU/stack and captured Cocos code.
Do not enable parallel shared-memory execution or infer free memory from zeros.
Report actual commands/results and use NOT_RUN for unavailable execution.
A mocked trace alone is insufficient validation. Inspect current result JSON;
worker.contextRetained is not a claim of complete UCRT thread startup.
