# Retained CPU instruction slices

`lift_slice(cpu, image_base, guest_base, stop, limit)` reads the existing RIP at
CPU offset 192. It never resets RIP to a callback entry. Each successful native
instruction updates the same 4096-byte CPU shadow and shared guest memory.

| Result bits | Meaning |
| --- | --- |
| Neither high bit | Reached the explicit stop PC; low 30 bits count instructions |
| 0x40000000 | Instruction budget exhausted; CPU/RIP retained for the next slice |
| 0x80000000 | Transfer to a PC outside the observed translation; host must resolve it or stop |

Budget exhaustion does not call a Windows API, synthesize a return value, pop a
guest stack frame, or identify an arbitrary unknown transfer as a successful
exit. An explicit stop takes precedence over an exact-budget yield. A zero
budget does not modify the CPU. Limits with either high bit set fail before
executing or changing CPU state. Division faults retain their earlier contract.
`lift_run` retains its entry-setting and budget-exhaustion fault behavior for
existing callers.

The scheduler runs the actual requested worker in slices of at most 127 native
instructions. After the first completion poll returns, execution continues from
the saved RIP using the same CPU, argument, stack, TIB/TLS, thread identity,
errno, process services, clock and allocations. The callback entry and static
TLS initialization run once. The parent CPU, stack and TIB remain unchanged.

Each instruction slice is synchronous. After the initial poll, three later
continuations run through requestAnimationFrame on separate browser turns.
The recorded run advanced the game at frames 1, 2 and 3 during those dispatches.
An independently owned compiler stack, saved parent CPU and worker context
survive temporary handoff cleanup. Parent storage and the current original game
CPU are preserved on each turn. Page hide cancels pending dispatch and release
frees the owned context/compiler storage. Further dispatch after release fails.

This is a bounded four-poll diagnostic, not an unbounded background loop. A
nonzero completion wait is retained at API entry as blocked; no wait result is
supplied. No _beginthreadex handle, ID write, UCRT wrapper, join or exit is
fabricated. The parent remains stopped at its real thread-creation request.

The independent Unicorn trace records poll-return checkpoints, resumes its
existing CPU three times, and observes each next boundary with a bounded budget.
It also inserts approximately 17 ms and 100 ms between continuations, separately
at both image bases. The native instruction budget is checked before servicing
an API, so a zero-budget API return cannot silently change guest state.
An unexpected null/unmapped target or missing boundary reports RIP, instruction
count, recent instructions and recent services. Reference tests compare whole
segments and cycling 1/7/31/127-instruction slices against that oracle at both
DLL image bases: GPRs, XMMs, defined flags, service order, full heap/stack/TLS,
DLL writes and parent preservation. Separate contract checks cover zero,
exact-limit, unknown transfer, invalid limit and legacy exhaustion behavior.

The browser report records sliceQuantum, sliceCount, maxSliceSteps,
continuedFromSavedCpu, checkpoint start/end PCs, retained compiler ownership,
pending continuations and browser dispatch/frame history. In the recorded run,
37 slices executed 4,379 worker instructions and four completion polls while the
game continued to 142 frames. Native scripted-clock runs execute 4,383 worker
instructions; monotonic live timing can choose shorter observed branches.

40 reference cases, 40 sliced counterparts, six native/six sliced worker cases,
seven slice-contract checks and 1,032 differential division checks pass. Full
Geode loader and existing-package support flags remain false.
