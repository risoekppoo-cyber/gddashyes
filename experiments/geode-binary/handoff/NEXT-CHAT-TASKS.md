# Current continuation — 8 November 2026

Use current main; older source ZIPs and local mirrors may be stale. The parent
reaches _beginthreadex after 12,223 instructions. The actual callback at RVA
0x4ffab0 executes 1,710 instructions, including GetQueuedCompletionStatusEx,
then yields at its return address (RVA 0x4f165b). Total: 13,933 instructions.

The final browser check preserved 133 game frames and the original CPU/stack.
36 reference cases, two worker comparisons, 1,032 division checks and the real
Windows batch oracle pass. The worker's last batch requested 64 entries, timeout
zero, alertable false; an empty owned port returned false/258 and removed zero.

## Next immediate task — High reasoning

Add safe bounded resumption of retained guest CPU contexts. Start with the
instruction-slice contract and one worker continuation, keeping this task small:

1. Add a resumable slice entry point that returns at its instruction budget with
   RIP/registers preserved. Keep the old lift_run failure contract for existing
   callers. Distinguish service transfer, cooperative budget yield and explicit
   checkpoint/exit without fabricating a native service return.
2. Extend native tracing beyond the saved poll return to another measured
   frontier. Check why an exploratory unrestricted trace has no explicit
   boundary rather than assuming the rest of the loop is verified. Distinguish
   budget exhaustion, an unmapped/null target and an actual exit.
3. Resume from saved RIP with the same CPU, stack, TIB/TLS, identity, errno,
   services and heap. Do not rerun the callback entry, recreate its argument or
   overwrite live TLS with a fresh template.
4. Compare uninterrupted execution with repeated small slices at both image
   bases, including service order, registers, flags and memory. Check cleanup
   and actual-browser responsiveness before publishing a new frontier.

The worker is marked runnable in the scheduler, but the integration currently
invokes only one bounded callback prefix. It is not a running background loop.
The current nextRequiredService label "Worker scheduler continuation" describes
that integration task; it is not a missing Windows API to replace with a stub.

## Later stages

- Adopt/resume the retained parent and implement actual _beginthreadex lifecycle,
  including verified UCRT thread initialization, owned handle/ID and exit/join.
  No successful thread-creation return has been fabricated at this checkpoint.
- Connect actual blocking/wakeup for pipes and completion ports when observed.
- Continue loader initialization, hooks and actual mod loading. Keep all full
  loader/package-support flags false until the corresponding operations work.

## Completed — do not repeat

- Bounded contexts, thread-specific errors/IDs and shared process services.
- Owned pipe queues, stdio redirection, successful/failed I/O completion packets.
- Native-checked empty C++ exception pointers and MSVC mutex types 2/0x102.
- Real monotonic performance clock and required unsigned division.
- Nonblocking GetQueuedCompletionStatusEx: real FIFO batches up to 64 entries,
  output/error rules and operation status. Blocking/APC waits remain rejected.
- Hash-verified pinned DLL cache and bounded official-download retries in CI.

Relevant files: build-deferred.py, guest-scheduler.mjs, setup-context.mjs,
windows-iocp-batch.mjs, windows-iocp.mjs, handoff/runtime.js,
integration-tests/deferred-reference.mjs and browser-smoke.cjs.
IOCP-BATCH.md contains Windows evidence and the exact supported profile.

Preserve allocator ownership and original game state. Do not introduce parallel
shared-memory execution or infer free memory from zero bytes. Use actual
commands/results and NOT_RUN where appropriate. Always recommend the next
prompt's reasoning setting when finishing, as the user requested.
