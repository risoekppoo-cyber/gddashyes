# Current continuation

Use current main. Earlier module lookup, thread naming, stdio, named-pipe and
completion-port setup tasks are complete; the older source ZIP is historical.

Verified checkpoint: 12,223 native startup instructions, eight passing reference
cases, 136 Chromium game frames, preserved game CPU and restored live stack.
Full loader initialization and existing .geode packages remain unsupported.

## Next implementation: real guest worker execution

The exact stop is _beginthreadex at the API entry. Worker entry RVA is 0x4ffab0.
Read pendingThreadRequest in handoff/setup-browser-result.json and
nextThreadRequest in handoff/setup-manifest.json. Creation is not implemented.
Do not turn the diagnostic trap into a successful stub.

Keep each change small and validate it before extending the translated prefix:

Foundation implemented: guest-scheduler.mjs owns private contexts and bounded
dispatch, explicit block/wake states and cleanup. Services now select per-thread
IDs, TIB error storage, errno and lock ownership. These focused tests pass with
memory growth and isolation checks. The scheduler is not wired into live startup;
the real worker closure and CRT trampoline remain the next required evidence.

1. Separate shared process services/handles from per-thread state. Give each
   thread its own CPU shadow, stack, TIB/TLS, last-error value and lifecycle.
   Preserve existing pipe, stdio, heap and completion-port ownership. Inspect
   the actual worker entry/CRT trampoline before assuming its entry ABI.
2. Introduce a cooperative scheduler with bounded instruction slices and owned
   thread contexts. Retain the root CPU at a yield; the current runtime frees
   its temporary shadow after the checkpoint and cannot resume it. Validate
   alternating contexts, register/TLS isolation and failure cleanup first.
3. Implement the observed _beginthreadex request: allocate a real runnable
   worker, execute the actual translated entry and preserve its argument, publish
   an owned handle and write its real guest ID. Translate the worker closure
   with independent native evidence; stop on its first unsupported dependency.
4. Add genuine blocked/runnable transitions for completion-port dequeue and
   overlapped pipe reads. Connect writes/close to completion and wakeup. Verify
   pending, ready, failed and EOF paths without polling loops or dropped bytes.
5. Continue the main startup thread and implement only its next observed
   lifecycle dependencies. Add exit/join/handle cleanup when exercised. Preserve
   game responsiveness across scheduler yields and page disposal.
6. Compare independent native traces and shared/per-thread state, then run the
   real-browser integration. Publish the next precise boundary and keep loader
   and package-support flags false until those operations actually work.

## Relevant files

- experiments/geode-binary/thread-boundary.mjs
- experiments/geode-binary/guest-scheduler.mjs
- integration-tests/guest-scheduler.mjs
- experiments/geode-binary/windows-pipes.mjs
- experiments/geode-binary/windows-iocp.mjs
- experiments/geode-binary/windows-critical.mjs
- experiments/geode-binary/windows-stdio.mjs
- experiments/geode-binary/build-deferred.py
- experiments/geode-binary/setup-context.mjs
- experiments/geode-binary/handoff/runtime.js
- integration-tests/bundle-services.mjs
- integration-tests/deferred-reference.mjs
- integration-tests/browser-smoke.cjs
- integration-tests/{pipes,critical,iocp}-native.py and recorded result JSON
- .github/workflows/geode-deferred.yml

Preserve the original game CPU/stack, allocator ownership, unresolved-import
stops, verified Cocos binding and explicit rejection of arbitrary exceptions.
The LOCK/UNLOCK profile currently permits only one non-shared guest CPU; a
cooperative scheduler must not silently enable parallel shared-memory execution.
Do not infer unused memory from zero bytes. Report actual commands/results and
use NOT_RUN for unavailable execution. A mocked trace alone is insufficient.
