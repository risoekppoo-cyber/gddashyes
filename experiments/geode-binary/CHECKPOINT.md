# Resume checkpoint — actual Geode DLL translation

User goal: keep progressing in batches and save durable checkpoints. Do not equate a prefix or SDK canary with the full Geode loader. Work on branch `geode-startup-batch` in `risoekppoo-cyber/gddashyes`; normal game files remain unchanged.

## Latest verified milestone

**1,063,053 instructions verified in translated WebAssembly**, including **1,021,682 original Geode**, **33,753 MSVCP**, **6,150 VCRUNTIME**, **1,442 Cocos**, and **26 bootstrap**. Both original Microsoft entrypoints complete before Geode starts; Geode TLS callbacks and the Cocos entrypoint complete. The original VCRUNTIME RTTI type-name routine runs. This prefix handles 9,622 API calls and completes 157 initializer callbacks. It passes the former FMOD inspection boundary and stops BEFORE the first write into a new executable allocation, with zero unresolved import bytes consumed.

`dist/batch-verified.json` is a compact summary extracted from the passing clean CI log; the complete report is an artifact of that run. All three CI profiles passed, including memory/register/provider comparisons, 118 one-case-partition CPU fixtures (107 real-x64 FP cases), and 200 scalar regressions. Source: `0788184683c0d905211b08261ca5a2e8700deeed`; run: https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42287771449 . The prior 1,051,993 proof is retained as `dist/pre-fmod-startup-integration.json`. Full Geode initialization, browser integration and existing `.geode` packages remain unsupported.

A separate completed real **VCRUNTIME140.dll attachment** verifies **410 instructions (402 original runtime and 8 bootstrap)** with its true successful native return, FLS and system-contract initialization: `dist/vcruntime-attach-verified.json`. Both Microsoft DLL inputs come from the same pinned official redistributable; neither binary is committed.

The previous 546,460 combined-prefix proof passed in clean GitHub CI at https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42239620346 (source 7d254fd8c43ba8698f4a5a260b62761d44f1f8cf). Its full report is retained as `dist/msvc-attach-chain-verified.json`. The first longer-prefix CI attempt hit the verifier's old 4,096-transfer cap, rather than a state mismatch; that cap has been replaced by a finite bound from recorded calls, instructions and module returns, preserving all exact transcript/state checks. The longer local comparison and then the 1,000,000-instruction combined comparison passed. The partitioned non-VCRUNTIME Geode profile and isolated VCRUNTIME profile passed in GitHub CI run 42243946127. The combined profile exposed the unresolved FMOD code read; the corrected guard and complete 1,051,993 comparison now pass locally; all three profiles pass on a clean GitHub runner: https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42245751604 . Tested source: `7ed37af12e84a375a0b4e73abb143a9237451b05`.

The partitioned translator passes 118 CPU fixtures, including 107 real-x64 floating cases, plus the original 200 scalar cases from the unchanged scalar path. Native and WASM comparisons include all GPRs/XMMs/flags/MXCSR, complete images and native stack, TLS and CRT arenas, heap ownership, and each reached provider's metadata. Non-native providers remain a declared serialized Windows compatibility model, not real Windows itself.

## FMOD follow-up component

`../fmod-bridge/README.md` records a verified mapping from the pinned primary import IAT 0x00ace740 through WASM table slot 24570 to function 24950. Its exact implementation only returns FMOD_OK and performs no audio initialization. A matching owned readable Win64 entry and a narrow native-E9-to-WASM router pass 64 register contexts, 576 browser-adapter calls and 192 independent native executions, including call-original and restoration. Unknown patches fail closed. This is a component proof, not Geode's own installer running. The startup batch below integrates the owned provider and verifies the next boundary; patch-to-live-WASM routing remains unimplemented. The focused CI passed: https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42278351214 . Tested source: `309233501d70932f128477bf45765ded5ccd7ca2`.

## Startup integration batch — verified

FMOD mode is now wired into the original DLL startup with `GEODE_FMOD_BRIDGE=1`. `native_fmod_bridge.py` exposes owned PE entries only for import mappings verified against the pinned game. `../fmod-bridge/adapter-map.json` records 64 mappings; the 26 exact return-only implementations use the independently verified MOV/RET contract. Other adapters tail-jump to their unresolved call gateways and stop if execution is requested. This does not claim native FMOD DLL execution or full audio support.

The original Geode code has read the owned FMOD entries and proceeded through module paths, UTF-8 conversion, C-locale drive-letter classification, lexical C-drive paths, and directory metadata handles. These providers operate in a declared guest namespace, never the host filesystem. File-content I/O, other drives/code pages, reparse points and unsupported open modes remain explicit stops.

The native discovery recorded 1,063,054 attempted instructions, including a failed first write. Fresh native replay and translated WASM both verify the clean **1,063,053** prefix immediately before that instruction. `dist/fmod-startup-native-next.json` remains discovery evidence only. The allocation is 32 requested bytes at 0x15000000 (4 KiB committed, 64 KiB reservation). Next instruction: 0x212f63e, occurrence 1, `MOVUPS [RDX], XMM0`. This is Geode-generated machine code, not another missing FMOD symbol.

All existing executable images and the new executable allocation have native/host write guards. Discovery/replay stops before code mutation because generated-code execution and patch-to-live-WASM invalidation are not implemented. Do not remove these guards to make the loader appear to advance. The owned E9 router component alone does not handle these generated stubs.

The clean CI batch passed all three startup profiles, full translated-state comparison and existing CPU/scalar regressions. The separate FMOD workflow also passed all 64 mapping checks and 192 native executions: https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42287771297 . No code was changed after these tests; the following checkpoint commit records evidence only.

## Exact resume point

With `GEODE_FMOD_BRIDGE=1`, MSVCP boot and VCRUNTIME enabled, the verified boundary is **1,063,053 instructions**, stopped BEFORE occurrence 1 of instruction **0x212f63e**. It is a `MOVUPS [RDX], XMM0` store into **0x15000000**, a 32-byte executable allocation requested by original Geode. Unicorn reports the first 8-byte protected sub-write with value `0x74894808245c8948`; the complete SIMD instruction has not executed. The following instructions construct more bytes and a jump target. Do not treat this as an already installed or executed hook.

Next implement generated-code write tracking and execution routing for the actual emitted bytes. Capture and validate the complete generated stub, preserve guest CPU/stack state across its transfer, and invalidate any translated code affected by later native patches. Writes to existing executable images, the owned FMOD image and unresolved import gateway pages must remain guarded. The prior owned E9 router component only accepts its registered component fixture; it does not implement this generated stub. Unknown code and unmodeled patches must still stop explicitly.

The current proof has `fmodInspectionBoundaryPassed: true`, `stoppedBeforeNativePatch: true`, `nativePatchToLiveWasmLinked: false`, `unresolvedImportMemoryReads: []`, and `firstRuntimeDependency.reason: NATIVE_CODE_WRITE_REQUIRES_ROUTING`. `run-startup-tests.sh` performs native discovery, fresh replay stopping before that exact instruction occurrence, then the complete WASM comparison. Native discovery alone is not a verified milestone.

The prior 1,051,993 boundary at occurrence 33 of 0x21a6dad is retained in `dist/pre-fmod-startup-integration.json`. It stopped before reading FMOD::System::init's unresolved gateway. The owned provider now supplies readable entries verified against the pinned browser adapter catalog. Of 64 mappings, 26 are exact return-only adapters; stateful entries still tail-jump to explicit unsupported call gateways. No native FMOD DLL or full browser audio support is claimed.

Use `GEODE_MSVCP_BOOT=1`, `GEODE_VCRUNTIME_DLL=/tmp/vcruntime140-x64.dll`, and `GEODE_FMOD_BRIDGE=1` for the current combined path. The default non-FMOD Geode profile retains the earlier type-name boundary; `GEODE_VCRUNTIME_ONLY=1` tests completed VCRUNTIME attachment independently. The primary EXE is mapped at declared ASLR base 0x08000000 (99,581 relocations, 856 Cocos imports), but its TLS callbacks and entrypoint have NOT run. Live-game startup, gameplay and `.geode` package loading are not tested by this standalone prefix.

Continue in batches, implementing only reached dependencies. Once the next batch is ready, run the combined comparison and regression checks together. An instruction count is not a completion percentage. The partitioned translator uses 128-case noinline functions and an exact instruction budget; the standalone verifier uses Node's `--liftoff-only`. Browser performance remains unverified.

## Implemented runtime model

This is one serialized guest execution context, not Windows or Wine. Declared CPU/Windows compatibility profiles are not reports about host hardware/OS. Unimplemented imports, unknown modules/exports/ordinals/forwarders, primary-module requests, nested dependency loads, repeated loads needing reference counts, failed attach needing detach, blocking lock contention, nonempty condition queues and unknown guest frees stop explicitly.

Module lookup is case-insensitive and export names are case-sensitive. Mapped PE export tables supply real native VAs. System shims contain actual PE32+ export tables exposing implemented gateways only; incomplete catalogs never imply that an arbitrary export is absent. The exact Wine extension `ntdll.dll!wine_get_version` is declared absent for the native-Windows compatibility model (NULL/error 127). Geode and Cocos catalogs are complete mapped PE catalogs. `mapped_pe` must interpret image RVAs as memory offsets, not disk raw-section offsets.

Cocos image SHA-256: `1ade9d1b9603d82a41f2211348ec98516098b6d012114f785a763b8762512257`; 1,900,544 bytes; actual guest base `0x10000000`; 5,917 exports. Although its header retains preferred base `0x180000000`, the supplied memory image is already rebased to `0x10000000`: do not relocate it twice. The fetcher verifies both exact source chunks and the complete extracted image. No game or official Geode binaries are committed.

Supported executed services include process/thread identity, FILETIME and monotonic timing, system/version information, CPUID, static TLS, environment/last error, SRW locks, condition wakes, on-exit registration, C/C++ initializer callbacks, CRT allocation and strlen, mapped-module/export lookup and bounded dependency attach. DisableThreadLibraryCalls fails for active static TLS, using declared model error ERROR_MOD_NOT_FOUND (126), rather than pretending it disabled required TLS notifications. Unknown modules are rejected.

The `ceilf` CRT adapter uses the Win64 XMM0 argument/return ABI, preserves signed zero and rejects nonfinite inputs.

The CRT heap (52–60 MiB) owns tracked 16-byte-aligned blocks. calloc overflow/zero fill, realloc preservation/failure, coalescing free and errno ENOMEM are tested. Thread descriptions use a separate local heap and LocalFree. Arbitrary thread handles and callbacks on shutdown remain unsupported.

Floating point is deliberately bounded: finite normal/zero comparisons and predicates, signed integer-to-binary32/64 conversions with all four MXCSR rounding modes and sticky precision, finite-to-integer CVTT conversion with masked invalid/precision status, and normal/zero binary32 add/subtract/multiply/divide in nearest-even mode. NaN/infinity/subnormal comparisons, unsupported division inputs/results/modes and unmasked precision exceptions stop. This is not general SSE/x87 support. The guest starts with MXCSR 0x1f80. The native reference now executes the reached scalar SSE operations on real host x64, using explicitly selected normalized instructions and checked register or base/displacement memory operands. Host MXCSR is always saved/restored. This prevents Unicorn precision-flag omissions from corrupting the reference. Unsupported addressing and unmasked FP exceptions stop. There are 107 separate hardware floating fixtures, with 36 emulator status discrepancies recorded. The prior MIN64/-1 integer-division discrepancy is likewise checked with real x64 SIGFPE.

## Durable milestones

Latest: `0788184683c0d905211b08261ca5a2e8700deeed` — **1,063,053**, https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42287771449 . All three profiles pass; FMOD inspection is cleared and execution stops before the first generated-code write.

| Source revision | Total prefix | Recorded evidence |
|---|---:|---|
| 0788184683c0d905211b08261ca5a2e8700deeed | 1,063,053 | `dist/batch-verified.json`; https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42287771449 |
| e33d28c36977bff1b29e77b9c01203cf11da4eeb | 865 | https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42188246572 |
| 7a6188aa21209386b4eff54a3dfca5f992e8368a | 988 | `dist/module-resolution-verified.json`; https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42196526947 |
| d708353b8abc6c864776c5a85c9ee87bdbdc4696 | 1,607 | `dist/crt-heap-verified.json`; https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42197100197 |
| d23ee69fcb9b7a5056449539bf2df1b0b66fdf31 | 8,416 | `dist/cocos-verified.json`; https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42200279670 |
| bb4781a367084ede9c86b9db4557767abfcb2eca | 20,000 | `dist/primary-image-verified.json`; https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42227445945 |
| 0295f6b13356c11664bcab1bcd6723e968f14292 | 535,140 | `dist/pre-iostream-verified.json`; https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42229062319 |
| a56a1e63f507deeb31439b227511049448759af3 | 535,183 | `dist/batch-verified.json`; https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42230332418 |

Older `dist/batch-native-next.json`, startup-smoke/time/thread reports and README original-canary tables are historical, not the current result. Always prefer this file plus `dist/batch-verified.json`. Each generation has a fresh ID; stale generated C/WASM or mismatched report/reference outputs are rejected. Exact step budgets and the complete host-call transcript distinguish earlier visits to repeated terminal PCs from the actual reference endpoint.

## Rebuild after scratch disappears

Worktree: `/workspace/scratch/d6c02ef02c38/geode-startup-batch`.

```bash
sudo apt-get install -y libarchive-tools
python -m pip install -r experiments/geode-binary/requirements.txt ziglang==0.14.1
npm install --prefix /tmp/geode-wasm-tools binaryen@123.0.0
python experiments/geode-binary/fetch-startup-dll.py /tmp/Geode.dll
python experiments/geode-binary/fetch_cocos_image.py /tmp/libcocos2d.dll.img
python experiments/geode-binary/fetch_primary_image.py /tmp/GeometryDash.exe.img
python experiments/geode-binary/fetch_msvc_slice.py /tmp/msvcp140-x64.dll
python experiments/geode-binary/fetch_vcruntime.py /tmp/vcruntime140-x64.dll
GEODE_FMOD_BRIDGE=1 GEODE_VCRUNTIME_DLL=/tmp/vcruntime140-x64.dll GEODE_MSVCP_BOOT=1 GEODE_MSVCP_DLL=/tmp/msvcp140-x64.dll GEODE_INSTRUCTION_LIMIT=2000000 GEODE_PRIMARY_IMG=/tmp/GeometryDash.exe.img GEODE_DLL=/tmp/Geode.dll GEODE_COCOS_IMG=/tmp/libcocos2d.dll.img GEODE_OUT=/tmp/geode-resume-run GEODE_WASM_OPT=/tmp/geode-wasm-tools/node_modules/.bin/wasm-opt bash experiments/geode-binary/run-startup-tests.sh
```

Local tools if present: Python dependencies `/tmp/geode-batch-tools` (set PYTHONPATH), Zig `/tmp/geode-batch-tools/ziglang/zig` (set GEODE_ZIG), Binaryen `/tmp/geode-wasm-tools/node_modules/.bin/wasm-opt`. Official DLL SHA-256 remains `ccedc2f1c86baf342f6720b9685991ca31fba246453efe2a1daf609dc40b6499`; its release ZIP is also checked. CI runs the same script, uses pinned dependencies and read-only repository permissions, and uploads only the JSON report.

Current guest regions: native stack 2–3 MiB; TIB/vector 4 MiB; on-exit arena 5–6 MiB; Geode static TLS 7 MiB; private compiler stack 8–9 MiB; local description heap 10–11 MiB; errno 12 MiB; Cocos static TLS 13 MiB; primary static TLS 14 MiB; CRT context 15 MiB; shim PE images 16 MiB onward; Geode DLL 32 MiB; CRT heap 52–60 MiB; primary executable 128 MiB; Cocos DLL 256 MiB; MSVCP image 288 MiB; VCRUNTIME image 304 MiB; owned FMOD image 320 MiB; executable allocation arena 336–338 MiB. All images/helper regions are disjoint in this ASLR model.

## Previous C++ runtime investigation (superseded by completed attach above)

Official VS17 x64 Redistributable downloaded from Microsoft's immutable URL `https://download.visualstudio.microsoft.com/download/pr/990c720a-46ce-4dc7-87b9-c2eb615d34b9/CC0FF0EB1DC3F5188AE6300FAEF32BF5BEEBA4BDD6E8E445A9184072096B713B/VC_redist.x64.exe`. EXE SHA-256: `cc0ff0eb1dc3f5188ae6300faef32bf5beeba4bdd6e8e445a9184072096b713b`. Its attached CAB at offset 0xa7848 contains `a12`, a CAB containing `msvcp140.dll_amd64`. Extracted DLL SHA-256: `0f885b509a685d2bbfa652fed26b5fb31d88fbdab0a978c641d1c7b8aa460aa9`, 557,728 bytes. Local path if present: `/tmp/msvcp140-x64.dll`. Pure Python libarchive-c 5.3 uses system libarchive to read these containers; the installer is never run.

The exact missing export is at RVA 0x4930. Disassembly shows a pure 13-instruction constructor: write the actual vtable pointer at offset 0, zero fields at offsets 8, 16, 24 (DWORD), 32, 40, 48, 56 and 64, return `this`. It reads no mutable DLL globals and calls no imports. This tightly gated translation now advances one real ABI operation without claiming full MSVCP initialization. Any other MSVCP body must remain blocked until its initialization/runtime requirements are handled. The DLL and redistributable must not be committed; use hash-checked fetching.

## Current source and evidence scope

The complete local MSVCP slice test passed at 535,183 instructions, including 13 actual Microsoft constructor instructions and the poisoned-object ABI fixture. This does not initialize the Microsoft C++ DLL, complete Geode's entrypoint, boot the game or load .geode packages. No new browser/live-game behavior has been claimed. The game's existing SDK/canary remains separate from this standalone startup work.

## Fresh-runner confirmation

Latest source revision: `a56a1e63f507deeb31439b227511049448759af3`. Successful complete CI run: https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42230332418 . It fetched and hash-verified all original inputs, including Microsoft's redistributable and extracted DLL. Native/WASM prefix, constructor padding/return fixture, runtime contracts, 118 CPU fixtures (107 real-x64 floating cases) and 200 original scalar cases passed. `dist/batch-verified.json` is the fresh-runner report with its source commit and run URL. The subsequent commit only records evidence and resume documentation.
