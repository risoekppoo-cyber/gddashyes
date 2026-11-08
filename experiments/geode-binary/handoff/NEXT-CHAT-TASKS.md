# Current continuation — 8 November 2026

Use current main. Older local mirrors and Chat-mode ZIPs may be stale.

## Current verified state

- Parent: 12,223 instructions, stopped at _beginthreadex API entry.
- Real requested callback: entry RVA 0x4ffab0, original argument, ID 2 and owned
  CPU/stack/TIB/TLS. Four empty nonblocking completion polls execute.
- Native worker: 4,383 instructions with deterministic clock profiles.
- Browser worker: 4,379 instructions in the recorded run; 16,602 total.
- Three resumptions run at game frames 1, 2 and 3; the game continues to 142
  frames. Original game CPU, live stack and parent private storage are preserved.
- Slices execute at most 127 native instructions, retaining RIP and state.
  Compiler stack, child context and parent CPU clone retain valid ownership.
- The measured sequence ends runnable at poll-return RVA 0x4f165b. It is bounded,
  not a persistent background loop. No completion data is invented.

40 native-reference cases and 40 sliced counterparts pass at both DLL bases.
Six worker clock-profile cases and six sliced versions cover zero, about 17 ms
and 100 ms pauses. Seven slice-contract checks, 702 worker scheduler slices,
1,032 differential division cases and the real-browser check pass.

## Next immediate task — High reasoning

Implement the observed _beginthreadex lifecycle and resume the saved parent.
Additional empty worker polls are no longer the critical path.

1. Read current thread-boundary.mjs, guest-scheduler.mjs, setup-context.mjs,
   build-deferred.py and the retained-parent ownership model. Discover the UCRT
   initialization requirements for this exact call profile; distinguish
   independently verified requirements from unknown architectural state.
2. Create a small actual-Windows x64 UCRT oracle for security=null, stackSize=0,
   flags=0 and a real callback/argument. Record thread-ID output, callback
   identity, fresh thread errno/TLS, handle/exit/join/close behavior and relevant
   failure output rules. Use bounded subprocess execution and opaque handles.
   This isolated evidence-gathering task can be delegated to Chat mode at Medium.
3. Add lifecycle and ownership only for the verified profile. Adopt the saved
   parent CPU/stack/TIB without resetting its RIP, TLS, argument or private data.
   Preserve existing child state if it is reused; do not create duplicate
   callbacks or run static initialization twice. Retain compiler storage.
4. Differentially compare parent/child continuation and process memory at both
   bases. Advance native tracing to the next actual unsupported frontier.
   Validate the real browser between bounded host turns before publishing.

The current service-entry trap has not returned a handle or written the ID.
Full thread creation, UCRT initialization, exit/join and full-loader/package
support flags remain false. Do not turn them on just because a callback ran.
Keep unsupported failures explicit; do not infer free memory from zero bytes.

## Later, when observed

- Actual timed/blocking waits, port/pipe wakeup and packet delivery.
- Continue loader initialization, hooks, and actual mod loading.
- Full CRT startup, TLS callbacks and additional native state as required.

## Completed — do not repeat

- Resumable instruction export with explicit stop/budget/transfer outcomes.
- Same-CPU child continuation across browser turns, owned compiler lifetime,
  per-thread errors/IDs and shared process services.
- Named-pipe queues, stdio redirection and real completion-packet state.
- Windows-checked empty exception pointers, MSVC mutexes and nonblocking IOCP
  batches with operation status. Monotonic performance clock and unsigned DIV.
- Hash-verified pinned DLL cache with bounded official-download retries in CI.

Read DEFERRED-SETUP.md and RESUMABLE-SLICES.md for evidence and limits. Always
recommend the next prompt's reasoning setting when finishing.
