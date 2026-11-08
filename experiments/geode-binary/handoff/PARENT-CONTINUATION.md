# Verified parent continuation â€” 8 November 2026

The observed thread-creation profile now returns an owned handle and writes the
actual retained worker ID, then resumes the saved parent CPU. The live parent
executes 836 more instructions, creates three additional runnable worker
contexts and stops BEFORE MSVCP140.dll!_Cnd_signal at RVA 0xa55870.
There are four retained workers (IDs 2â€“5), not four newly executed callbacks.

The browser run continued for 152 game frames with the original game CPU and
live stack preserved. Total translated instructions: 17,438 (12,223 initial
parent + 4,379 live worker + 836 resumed parent). The scripted native worker
count is 4,383; real clock timing can select the previously observed shorter
branch. The parent count is 836 at both bases and all clock profiles.

## Exactly what changed

- GuestThreadLifecycle.completeStart validates the actual API entry, caller
  frame and request, creates or reuses an owned context, writes its ID, and
  returns its real opaque handle. It does not just supply a success constant.
- The existing advanced worker is reused with its live CPU/TLS unchanged.
- Repeated matching requests create fresh CPU/stack/TIB/static-TLS contexts;
  their requested argument, ID, saved entry and owned handle are retained.
- Native reference and browser execution both continue until a real unsupported
  boundary. Known service calls are executed normally. A bounded batch allows
  up to eight creation requests, but this path reached a new API after four.
- Parent native tracing stops explicitly before unsupported instructions.
- The parent uses a retained CPU and independently owned compiler stack. Its
  execution preserves the first worker's private CPU, stack and TIB. Shared
  process heap/DLL changes are compared with the independent native model.
- The report includes parentContinuation, createdThreadCount and the new
  nextRequiredService. The browser launcher revision is
  setup-parent-resume-20261108.

## Evidence and limits

Run 42491563751 passes native/reference and actual-browser checks; live-handoff
regression 42491563754 also passes. The reference executes the parent at both
image bases with zero/~17ms/100ms clock gaps, in whole and sliced modes, checking
GPRs, XMMs, defined flags, service order, stack, TLS, process heap/DLL writes,
thread handles, context allocation addresses, clocks and mutex state.

This remains the explicitly supported static-TLS component model. It does NOT
verify complete UCRT startup or Geode DLL thread-attach/TLS callbacks. Those
flags remain false, as do full-loader and existing-package support. Jukebox has
not initialized or displayed its native UI. The three fresh workers remain
runnable at their entries; they have not secretly completed their callbacks.

## Next batch â€” High

1. Inspect the upstream MSVC _Cnd object layout and _Cnd_signal semantics for
   this exact call. Add the required condition-variable notification family
   with an independent actual-Windows check; don't fabricate a wake or return.
2. Continue from the current parent at _Cnd_signal with the SAME parent CPU,
   existing GuestThreadLifecycle, four contexts and four owned handles.
   Do not re-adopt ID 1, replay _beginthreadex, restart the old worker, or erase
   its TLS. resumeParent currently implements one verified bounded phase.
3. Extend the native model/reference to that next phase, then advance through
   already supported calls to the next actual missing requirement.
4. When runnable workers are dispatched, use their distinct stored entries and
   arguments; do not feed every context into the first worker's old checkpoint
   schedule. Preserve main-thread result delivery and process ownership.

Original mod path remains: loader -> original Jukebox Mod Loaded -> its song
widget popup -> original index/download -> active song path and offset.
The package build, Zstandard reader and server checks already pass; don't
repeat them or create a substitute menu. See ../mods/jukebox/README.md.

