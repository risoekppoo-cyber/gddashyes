# Resume checkpoint — Geode startup batch

User goal: continue the real binary translation in batches, quickly; save durable checkpoints. Do not equate a prefix test with full Geode loading. Normal game files are unchanged.

## Latest verified milestone

`dist/batch-verified.json` records **849 original Geode DLL instructions plus 16 loader-bootstrap instructions** (865 total) executed in translated WASM and compared with Unicorn 2.1.4 under the declared guest platform model.

Verified state: all 16 general registers, all 16 XMM registers, five arithmetic flags, the full native stack, the complete DLL image, TLS memory, TIB and CRT callback arena match. Both actual PE TLS callbacks completed; static TLS copies the DLL's 784-byte template and supplies its TLS index and main-thread vector. Real initializer callbacks run through a native call/return bridge, with null skipping and error propagation. One initializer table completed; the C++ constructor table is still in progress. On-exit callbacks are stored, not executed yet.

The longer run passes process ID, monotonic counter/frequency, SList initialization, CRT table initialization and callback registration, initializer dispatch, UTF-16 environment lookup/last-error state, uncontended SRW locking, empty-queue condition wakes, version/system information, CPUID and scalar/SSE integer transfers. `implementedImports` lists exactly which imports the actual run exercised; API contract tests cover additional boundaries.

CPU and Windows versions are explicit virtual profiles, not host hardware/OS reports. There is one serialized guest execution context. Contended blocking locks and nonempty condition queues stop; worker scheduling is not implemented.

## Exact resume point

The next missing API is **KERNEL32.dll!GetModuleHandleA**, called for **ntdll.dll**. Continue with an explicit loaded-module/export registry and native-address resolution. Do not return arbitrary success handles or callable addresses for unsupported exports. The real GD executable and Cocos module integration still needs to be supplied when those modules are requested.

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

Existing local tool paths, if still present: Python dependencies `/tmp/geode-batch-tools` (set PYTHONPATH); Zig `/tmp/geode-compiler/ziglang/zig` (set GEODE_ZIG); Binaryen `/tmp/geode-wasm-tools/node_modules/.bin/wasm-opt` (set GEODE_WASM_OPT); DLL `/tmp/Geode.dll`. All are reproducible.

The updated GitHub workflow runs the same script on a fresh runner with read-only repository permissions. It uploads only the JSON report.

## Verification and limitations

Passed locally: time/thread/startup/initializer/synchronization contracts; 11 raw-machine-code division/SSE cases; 200 original scalar reference cases; full 865-instruction startup-prefix comparison. A known Unicorn 2.1.4 discrepancy on signed MIN64 / -1 is documented in `verify-alu.py`: preserve the architectural divide fault, independently confirmed by real x64 SIGFPE, rather than copying the emulator's wrapped result.

The original shared-game `instantiateLift` validator is unchanged. Wide generated code uses `startup-module.mjs` in the standalone test, which permits only the exported i32 compiler-stack global and rejects data/start sections or unexpected imports. It reserves a private compiler stack and checks restoration after each dispatcher return. This does not claim a general untrusted-module sandbox.

Memory layout: native stack 2–3 MiB; TIB/TLS vector 4 MiB; CRT callback arena 5–6 MiB; static TLS 7 MiB; compiler stack 8–9 MiB; DLL image 32 MiB. The TLS/constructor loader bootstrap has separate instruction counts, so it does not inflate the reported DLL progress.

Full DLL initialization, arbitrary Geode package loading, real game integration of this startup runtime, general Windows/CRT services, exception handling, real workers and shutdown callback execution remain incomplete. The live game remains the earlier SDK/binary canary, not full Geode.

## Fresh-runner confirmation

The same complete test script passed on GitHub Actions: https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42188246572

Tested source commit: `e33d28c36977bff1b29e77b9c01203cf11da4eeb`. The canonical verified report now includes that run URL and source revision. All focused contracts, the actual 865-instruction prefix comparison, 11 division/SSE machine-code cases, and 200 regenerated scalar comparisons passed. The only subsequent edits in this checkpoint are documentation and recorded results.
