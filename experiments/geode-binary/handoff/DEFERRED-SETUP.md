# Deferred setup checkpoint â€” 7 November 2026

The owned live-game mapping now has an opt-in continuation past the original
14-instruction callback prologue. It executes 69 translated native instructions,
including nested calls and the first two reached Windows service calls:
`AcquireSRWLockExclusive` and `ReleaseSRWLockExclusive`.

The bounded SRW profile tracks lock ownership and rejects contention/recursive
acquisition or invalid releases. It is not a no-op success stub. Its simple
uncontended 0 â†’ 1 â†’ 0 representation was checked against the local Windows
kernel APIs; it does not implement general native threading or blocking.

Static TLS template and zero-fill storage use allocator-owned memory. The
translator gets its own GS/TIB/TLS context and an isolated Windows-aligned guest
stack. The live game CPU and stack are preserved. TLS callbacks, CRT startup
and deferred loader initialization remain unimplemented.

`build-deferred.py` traces the official hash-pinned DLL with Unicorn and emits
only the observed instruction closure. It adds bounded 128-bit copy/load/store
and bitwise semantics, explicit XMM shadow storage and image-relative address
rebasing. Unknown operations remain errors. Six native-reference contexts at
two image bases verify registers, XMMs, arithmetic flags, stack, TLS, DLL writes,
and service call order. Two of those cases independently exercise the reached
MOVUPS/MOVAPS/XORPS instruction slice; the live 69-instruction path itself has
not reached that SIMD slice yet.

The real Chromium/game check reports `LIVE_SETUP_SERVICE_BOUNDARY_PASS`, 140
or more frames (154 in the published run), preserved sampled CPU state and restored live stack. It stops BEFORE:

`KERNEL32.dll!GetModuleFileNameW` (callback path RVA `0x132d0b`).

The reported next arguments are module handle 0, a buffer in the private setup
stack, and capacity 260 WCHARs. No module-file-name result is fabricated.
Two imports now have implemented guest dispatch; 2,007 import slots remain
unresolved. This count is not the number of services executed by setup.

Use the mapping page's checked setup option, or append `&geodesetup=1` to the
owned-mapping handoff URL after supplying the pinned DLL. The old modes remain
available. **Existing `.geode` packages and the full loader do not work yet.**

The workflow publishes `setup.wasm`, its hash manifest, native-reference result
and browser result only after both reference and actual-browser checks pass.
