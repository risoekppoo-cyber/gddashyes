# Resume checkpoint — 2026-11-06

User goal: keep advancing the real Geode DLL binary translation quickly, batching services, and save durable checkpoints. Do not claim full Geode or package compatibility from these prefix tests.

This branch contains work beyond main's 27-instruction result. Normal game files are unchanged.

## Verified checkpoint

`dist/batch-verified.json` records **559 original Geode DLL instructions plus 16 loader bootstrap instructions**, all executed in translated WASM and compared with x64 reference execution in Unicorn 2.1.4.

Both actual PE TLS callbacks completed. Static TLS copies the DLL's 784-byte template, writes its TLS index, and supplies a main-thread TLS vector. The run matches all 16 general registers, all 16 XMM registers, arithmetic flags, the full native stack, DLL image, TLS memory and CRT callback arena. Real initializer functions execute through a native callback/return bridge. On-exit callbacks are stored in guest arrays. Uncontended SRW acquisition/release has been exercised.

Basic additions: process ID, performance counter/frequency, SList initialization, on-exit table initialization/registration, initializer-table execution, UTF-16 environment lookup and last-error state, single-thread synchronization, CPUID profile and integer/SSE register transfers. CPUID uses an explicitly declared virtual x64 baseline; no AVX/XSAVE. Locks run only in the serialized guest; contended blocking calls stop.

## Current work in progress

The source also includes empty-queue condition-variable wakes. The latest native reference reaches **850 instructions** (including loader instructions), recorded separately in `dist/batch-native-next.json`. This longer run has NOT yet passed the WASM comparison.

First translation gap on that path:

```
0x250fc64: DIV RDI
INT_DIV on a 128-bit dividend
```

First subsequent unimplemented API reached in the native reference: `ntdll.dll!RtlGetVersion`. Implement integer division/remainder correctly, including zero and overflow behavior, before claiming this longer path works. Do not overwrite the verified report with an unverified native trace.

## Local tools and inputs

- Worktree: `/workspace/scratch/d6c02ef02c38/geode-startup-batch`
- Official DLL: `/tmp/Geode.dll` (can be fetched again with `fetch-startup-dll.py`)
- Python packages: `/tmp/geode-batch-tools`, from pinned `requirements.txt`
- Compiler: `/tmp/geode-compiler/ziglang/zig`, Zig 0.14.1 (installed from `ziglang==0.14.1`)
- Optimizer: `/tmp/geode-wasm-tools/node_modules/.bin/wasm-opt`, Binaryen 123.0.0
- Scratch build directory: `/tmp/geode-batch-run`

Scratch files may disappear. Rebuild them from the source and hash-pinned official release; do not rely on this chat's in-memory tool state.

```bash
python -m pip install --target /tmp/geode-batch-tools -r experiments/geode-binary/requirements.txt
python -m pip install --target /tmp/geode-compiler ziglang==0.14.1
npm install --prefix /tmp/geode-wasm-tools binaryen@123.0.0
python experiments/geode-binary/fetch-startup-dll.py /tmp/Geode.dll
mkdir -p /tmp/geode-batch-run
PYTHONPATH=/tmp/geode-batch-tools python experiments/geode-binary/startup-smoke.py /tmp/Geode.dll /tmp/geode-batch-run > /tmp/geode-batch-run/report.json
/tmp/geode-compiler/ziglang/zig cc -target wasm32-freestanding -O2 -nostdlib /tmp/geode-batch-run/startup.c -Wl,--no-entry -Wl,--import-memory -Wl,--export=lift_run -Wl,--export=__stack_pointer -Wl,-z,stack-size=0 -Wl,--initial-memory=131072 -o /tmp/geode-batch-run/startup.wasm
/tmp/geode-wasm-tools/node_modules/.bin/wasm-opt /tmp/geode-batch-run/startup.wasm --remove-unused-module-elements -o /tmp/geode-batch-run/clean.wasm
mv /tmp/geode-batch-run/clean.wasm /tmp/geode-batch-run/startup.wasm
node experiments/geode-binary/verify-startup.mjs /tmp/geode-batch-run /tmp/geode-batch-run/report.json
```

The original shared-game `instantiateLift` validator is unchanged. Wider generated code needs an explicitly reserved private compiler stack; `startup-module.mjs` permits only the exported i32 stack-pointer global, rejects data/start sections and unexpected imports, and is used only in the standalone startup test. Private compiler stack: 8–9 MiB; native stack: 2–3 MiB; TIB/TLS-vector region: 4 MiB; CRT arena: 5–6 MiB; static TLS: 7 MiB; DLL image: 32 MiB. No full DLL or payload is committed.

## Checks and remaining work

Passed locally: `verify-windows-startup.mjs`, `verify-native-initializers.mjs` and the 575-instruction WASM prefix. New condition-variable behavior still needs dedicated contract checks. Add SRW ownership/contention and wide-value regression tests. Audit TIB reads against explicitly initialized fields; current reads are recorded in the reports.

Update `.github/workflows/geode-startup.yml` before merging: export `__stack_pointer`, include the new focused tests and trigger paths, and retain the original safety checks. The current main workflow predates these wider-code changes.

Full Geode initialization, real game integration of this startup runtime, broad CRT/Windows services, actual worker scheduling, exception handling, shutdown callbacks and existing `.geode` packages remain incomplete. Do not report this branch as playable full Geode.
