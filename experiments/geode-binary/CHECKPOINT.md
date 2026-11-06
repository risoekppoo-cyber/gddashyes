# Resume checkpoint — Geode startup batch

User goal: continue the real binary translation in batches, quickly; save durable checkpoints. Do not equate a prefix test with full Geode loading. Normal game files are unchanged.

## Latest verified milestone

`dist/batch-verified.json` records **972 original Geode DLL instructions plus 16 loader-bootstrap instructions** (988 total) executed in translated WASM and compared with Unicorn 2.1.4 under the declared guest platform model.

Verified state: all 16 general registers, all 16 XMM registers, five arithmetic flags, the full native stack, the complete DLL image, TLS memory, TIB and CRT callback arena match. Both actual PE TLS callbacks completed; static TLS copies the DLL's 784-byte template and supplies its TLS index and main-thread vector. Real initializer callbacks run through a native call/return bridge, with null skipping and error propagation. One initializer table completed; the C++ constructor table is still in progress. On-exit callbacks are stored, not executed yet.

The longer run passes process ID, monotonic counter/frequency, SList initialization, CRT table initialization and callback registration, initializer dispatch, UTF-16 environment lookup/last-error state, uncontended SRW locking, empty-queue condition wakes, version/system information, CPUID and scalar/SSE integer transfers. `implementedImports` lists exactly which imports the actual run exercised; API contract tests cover additional boundaries.

CPU and Windows versions are explicit virtual profiles, not host hardware/OS reports. There is one serialized guest execution context. Contended blocking locks and nonempty condition queues stop; worker scheduling is not implemented.

## Exact resume point

The next missing API is **api-ms-win-crt-heap-l1-1-0.dll!malloc** at import gateway `0x700028b0`. Implement a bounded, tracked CRT heap, including allocation failure, 16-byte alignment, realloc preservation and valid free handling, then continue the actual constructor path. Unknown exports and unknown modules must keep stopping explicitly. The real GD executable and Cocos integration still need to be supplied when requested.

Module lookup now resolves case-insensitive names to actual mapped PE images. Two explicitly partial system shim images contain real export tables and only implemented host gateways. GetProcAddress parses mapped PE export tables, preserves case-sensitive names, and returns real guest VAs. Real Geode.dll exports also use its mapped PE table. Unknown shim exports/ordinals/forwarders stop; they are not reported as absent. NULL GetModuleHandle stops until the real primary executable is integrated.

The actual DLL resolved both SetThreadDescription and GetThreadDescription, but has not called those gateways in this prefix. Focused contracts verify callable RtlGetVersion resolution, UTF-16 thread naming, allocated description ownership and LocalFree. Only the current-thread pseudo handle is modeled; arbitrary thread handles stop. Local description allocations use 10–11 MiB, separate from the CRT heap to be added.

The declared compatibility profile is native Windows, not Wine. Exactly `ntdll.dll!wine_get_version` is declared absent, returning NULL/error 127; unrelated unknown exports still stop. This is the Wine extension used for detection, documented in Wine's own export specification and API list: https://source.winehq.org/WineAPI/ntdll.html and https://github.com/wine-mirror/wine/blob/master/dlls/ntdll/ntdll.spec. Shim catalogs are not complete Windows export catalogs.

Integer division/remainder is now implemented with divide-by-zero and quotient-overflow traps. The 128-bit backend and overlapping p-code temporaries support the reached SSE moves/shuffles. Keep the scalar backend as the default: the original 200 native-reference getter comparisons still pass after regeneration.

## Checkpoints and reports

GitHub branch: `geode-startup-batch` in `risoekppoo-cyber/gddashyes`.

Initial durable checkpoint commit: `87e5d6c47524ac4e27f20be88da82448e2ea2c81` (575 verified total instructions). Later commits advance this branch. `dist/batch-native-next.json` is an ARCHIVED earlier unverified 850-instruction trace, not the current result. Always use `dist/batch-verified.json` for the latest verified milestone.

Every generated native reference and its report carry the same fresh generation ID. The verifier rejects mismatched/stale outputs, unsupported IR and unmodeled TIB reads. This prevents an old generated C/WASM file from falsely passing a newer blocked trace.

## Rebuild after scratch storage disappears

Worktree used: `/workspace/scratch/d6c02ef02c38/geode-startup-batch`.

```bash
python -m pip install -r experiments/geode-binary/requirements.txt ziglang==0.14.1
npm install --prefix /tmp/geode-wasm-tools binaryen@123.0.0
python experiments/geode-binary/fetch-startup-dll.py /tmp/Geode.dll
GEODE_DLL=/tmp/Geode.dll GEODE_OUT=/tmp/geode-batch-run GEODE_WASM_OPT=/tmp/geode-wasm-tools/node_modules/.bin/wasm-opt bash experiments/geode-binary/run-startup-tests.sh
```

The fetcher verifies both release ZIP and extracted DLL SHA-256. The source DLL hash remains `ccedc2f1c86baf342f6720b9685991ca31fba246453efe2a1daf609dc40b6499`. No original DLL or game payload is committed.

Existing local tool paths, if still present: Python dependencies `/tmp/geode-batch-tools` (set PYTHONPATH); Zig `/tmp/geode-batch-tools/ziglang/zig` (set GEODE_ZIG); Binaryen `/tmp/geode-wasm-tools/node_modules/.bin/wasm-opt` (set GEODE_WASM_OPT); DLL `/tmp/Geode.dll`. All are reproducible.

The updated GitHub workflow runs the same script on a fresh runner with read-only repository permissions. It uploads only the JSON report.

## Verification and limitations

Passed locally: time/thread/startup/initializer/synchronization contracts; 11 raw-machine-code division/SSE cases; 200 original scalar reference cases; full 988-instruction startup-prefix comparison. A known Unicorn 2.1.4 discrepancy on signed MIN64 / -1 is documented in `verify-alu.py`: preserve the architectural divide fault, independently confirmed by real x64 SIGFPE, rather than copying the emulator's wrapped result.

The original shared-game `instantiateLift` validator is unchanged. Wide generated code uses `startup-module.mjs` in the standalone test, which permits only the exported i32 compiler-stack global and rejects data/start sections or unexpected imports. It reserves a private compiler stack and checks restoration after each dispatcher return. This does not claim a general untrusted-module sandbox.

Memory layout: native stack 2–3 MiB; TIB/TLS vector 4 MiB; CRT callback arena 5–6 MiB; static TLS 7 MiB; compiler stack 8–9 MiB; DLL image 32 MiB. The TLS/constructor loader bootstrap has separate instruction counts, so it does not inflate the reported DLL progress.

Full DLL initialization, arbitrary Geode package loading, real game integration of this startup runtime, general Windows/CRT services, exception handling, real workers and shutdown callback execution remain incomplete. The live game remains the earlier SDK/binary canary, not full Geode.

## Prior fresh-runner confirmation

The same complete test script passed on GitHub Actions: https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42188246572

Tested source commit: `e33d28c36977bff1b29e77b9c01203cf11da4eeb`. That run covers the prior 865-instruction checkpoint; the current module-resolution checkpoint has passed the complete local script and awaits its own CI run. All focused contracts, the actual 865-instruction prefix comparison, 11 division/SSE machine-code cases, and 200 regenerated scalar comparisons passed. The only subsequent edits in this checkpoint are documentation and recorded results.

## Latest checkpoint validation

Module resolution checkpoint: 988 total instructions, 37 host calls, 3 module lookups, 2 positive export resolutions, matching shim PE images and all prior state comparisons. Complete local test script passed, including 11 division/SSE and 200 regenerated scalar cases. GitHub Actions confirmation pending for this new source revision.
