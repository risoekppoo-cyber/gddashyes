# Resume checkpoint — actual Geode DLL translation

User goal: keep progressing in batches and save durable checkpoints. Do not equate a prefix or SDK canary with the full Geode loader. Work on branch `geode-startup-batch` in `risoekppoo-cyber/gddashyes`; normal game files remain unchanged.

## Latest verified milestone — successful DLL process attachment

**The original Geode DLL completes DLL_PROCESS_ATTACH and returns TRUE in translated WebAssembly.** The clean comparison executes **1,063,171 instructions**: **1,021,798 original Geode**, **33,753 MSVCP**, **6,150 VCRUNTIME**, **1,442 Cocos**, and **28 immutable bootstrap**. It reaches return PC 0x1234fedc with RAX=1, completes 157 initializer callbacks and handles 9,625 modeled API calls. Both Microsoft runtime DLL attachments, Geode TLS callbacks and Cocos attachment complete.

Source: `95e864f60a2d5de5a879550b8653b00e2433cbab`. All three startup profiles pass in https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42290998928 . The combined run compares full memory/register/provider state, 118 CPU fixtures (107 real-x64 floating cases), and 200 scalar cases. It also regenerates the actual patch/trampoline component, passes 24 native-reference cases and verifies that all three committed component WASM modules match a clean rebuild. `dist/batch-verified.json` is the compact CI summary; the full report is attached to the run. The former 1,063,053 boundary is archived as `dist/pre-generated-code-verified.json`.

**This completes DLL attachment, not the complete Geode loader.** Geode installs a jump in the primary image and defers more startup to its callback. That callback, primary EXE TLS/entrypoint, live game boot and `.geode` packages have NOT executed in this proof. `dllProcessAttachCompleted` and `dllInitializationCompleted` are true; `fullGeodeLoader`, `existingGeodePackagesSupported` and `nativePatchToLiveWasmLinked` remain false.

The first native/WASM comparison attempt caught a harness error: instruction-byte guards tried reading the immutable bootstrap at 0x72000000 outside guest memory. The correction excludes only that host-owned compiled bootstrap. All **41,009 reached mapped native instructions** retain byte guards. Unknown/stale versions fail explicitly; no code guard was disabled for Geode or game bytes.

## Browser component — confirmed in the user's Edge

Live check: https://risoekppoo-cyber.github.io/gddashyes/experiments/geode-binary/generated/ . Published main revision: `7b5b839b3b008969600fcfe9aef3e7e7327db2de`. Only the isolated component folder was published; normal game files were not changed. Its local helper is a copy of the startup module validator so the folder is self-contained.

The user's Edge 156 report is saved exactly with provenance in `generated/edge-result.json`: **GEODE_GENERATED_CODE_ROUTING_PASS**, 24 cases, actual DLL-installed patch and actual generated trampoline, correct GPR/XMM/flags/native stack, patch/restoration routing, unknown-code rejection and stale-translation rejection. The router selects the matching compiled code version by current native bytes; each translated instruction checks its bytes again. This is a component proof, not execution of the deferred callback or live-game integration.

## Earlier FMOD component

`../fmod-bridge/README.md` records a verified mapping from the pinned primary import IAT 0x00ace740 through WASM table slot 24570 to function 24950. Its exact implementation only returns FMOD_OK and performs no audio initialization. A matching owned readable Win64 entry and a narrow native-E9-to-WASM router pass 64 register contexts, 576 browser-adapter calls and 192 independent native executions, including call-original and restoration. Unknown patches fail closed. This is a component proof, not Geode's own installer running. The startup batch below integrates the owned provider and verifies the next boundary; patch-to-live-WASM routing remains unimplemented. The focused CI passed: https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42278351214 . Tested source: `309233501d70932f128477bf45765ded5ccd7ca2`.

## Earlier startup integration batch — verified through 1,063,053

FMOD mode is now wired into the original DLL startup with `GEODE_FMOD_BRIDGE=1`. `native_fmod_bridge.py` exposes owned PE entries only for import mappings verified against the pinned game. `../fmod-bridge/adapter-map.json` records 64 mappings; the 26 exact return-only implementations use the independently verified MOV/RET contract. Other adapters tail-jump to their unresolved call gateways and stop if execution is requested. This does not claim native FMOD DLL execution or full audio support.

The original Geode code has read the owned FMOD entries and proceeded through module paths, UTF-8 conversion, C-locale drive-letter classification, lexical C-drive paths, and directory metadata handles. These providers operate in a declared guest namespace, never the host filesystem. File-content I/O, other drives/code pages, reparse points and unsupported open modes remain explicit stops.

The native discovery recorded 1,063,054 attempted instructions, including a failed first write. Fresh native replay and translated WASM both verify the clean **1,063,053** prefix immediately before that instruction. `dist/fmod-startup-native-next.json` remains discovery evidence only. The allocation is 32 requested bytes at 0x15000000 (4 KiB committed, 64 KiB reservation). Next instruction: 0x212f63e, occurrence 1, `MOVUPS [RDX], XMM0`. This is Geode-generated machine code, not another missing FMOD symbol.

All existing executable images and the new executable allocation have native/host write guards. Discovery/replay stops before code mutation because generated-code execution and patch-to-live-WASM invalidation are not implemented. Do not remove these guards to make the loader appear to advance. The owned E9 router component alone does not handle these generated stubs.

The clean CI batch passed all three startup profiles, full translated-state comparison and existing CPU/scalar regressions. The separate FMOD workflow also passed all 64 mapping checks and 192 native executions: https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42287771297 . No code was changed after these tests; the following checkpoint commit records evidence only.

## Exact resume point

New live integration stage (browser confirmation pending): `handoff/index.html` loads the current root launcher with three checked, page-local opt-in insertions; root game files are unchanged. The actual source target 0x00a74a90 maps to WASM function 10503/table 10972, confirmed against the pinned module. Eight native contexts pass the translated Geode deferred callback's 14-instruction prologue. The live probe runs it with copied real GPRs/converted flag layout, actual guest memory/stack and a separately allocated compiler stack; then restores the native stack and lets original game startup continue. It stops before the first call at 0x0212f22d. Full DLL mapping/attachment in live memory remains unimplemented; do not interpret a prologue pass as full Geode loading. Browser results must be saved before claiming live execution. New narrow AF correction is described in `handoff/README.md`.

DLL attachment now completes. The actual 32-byte original-call trampoline at **0x15000000** is `48895c2408488974241048897c2418ff25000000009f4a670800000000909090`. It preserves the first three original stack-save instructions and transfers to primary **0x08674a9f**. Original Geode changes primary **0x08674a90** to `ff250000000000f212020000000090`, targeting deferred Geode callback **0x0212f200**. Two VirtualProtectEx calls change the owning page RX→RWX→RX, with old-protection output and page ownership independently compared. The 11 CPU writes to the primary patch and the 14 generated-allocation write events are observed; complete resulting images/arena match WASM.

Next integrate attachment and that deferred callback with the actual game startup and shared memory. Verify the target's real calling convention and intercept it before its first live-game invocation. Do not run a second game entrypoint after the existing game has booted. The standalone primary image uses declared ASLR base **0x08000000**, while its source guest image uses **0x00400000**. Resolve the shared memory/address layout, primary data pointers, DLL/runtime allocations and dispatcher mapping together; adjusting only a code address cannot establish C++ object compatibility. Preserve the running game's memory and reserve non-overlapping compatibility regions.

The completed standalone attachment has not executed any primary-image instructions, the deferred callback or its original-call trampoline. The browser component separately executes the exact patch/trampoline against native reference state. Neither establishes that live-game calls already reach Geode. Existing-package loading, threads, exception unwinding, filesystem contents, stateful FMOD calls and unsupported code versions still require implementation when reached.

Current runtime mode: `GEODE_GENERATED_CODE=1 GEODE_FMOD_BRIDGE=1 GEODE_MSVCP_BOOT=1 GEODE_VCRUNTIME_DLL=/tmp/vcruntime140-x64.dll`. Private executable writes are tracked. First execution seals generated allocations; later writes stop. Mapped image writes require the reached current-process VirtualProtectEx subset. Every reached mapped instruction is checked against its captured bytes, and previously executed changed versions stop for retranslation. Native write callbacks invalidate Unicorn translations. The standalone WASM write barrier enforces declared image page ownership/protection; it is not yet connected to the live game dispatcher.

Rebuild using **`build-generated-check.py`** in this directory with a completed output folder, then `generated/build.sh` and `generated/verify-node.mjs`. Avoid committing game/official DLL binaries or whole startup memory snapshots. The current browser fixtures contain only the selected original prologue, generated trampoline, installed patch and native-reference states.

Continue with reached dependencies in batches. Native discovery alone is not proof. Run the combined comparison and regression checks after each substantive batch, not after each small edit. An instruction count is not a completion percentage.

## Implemented runtime model

This is one serialized guest execution context, not Windows or Wine. Declared CPU/Windows compatibility profiles are not reports about host hardware/OS. Unimplemented imports, unknown modules/exports/ordinals/forwarders, primary-module requests, nested dependency loads, repeated loads needing reference counts, failed attach needing detach, blocking lock contention, nonempty condition queues and unknown guest frees stop explicitly.

Module lookup is case-insensitive and export names are case-sensitive. Mapped PE export tables supply real native VAs. System shims contain actual PE32+ export tables exposing implemented gateways only; incomplete catalogs never imply that an arbitrary export is absent. The exact Wine extension `ntdll.dll!wine_get_version` is declared absent for the native-Windows compatibility model (NULL/error 127). Geode and Cocos catalogs are complete mapped PE catalogs. `mapped_pe` must interpret image RVAs as memory offsets, not disk raw-section offsets.

Cocos image SHA-256: `1ade9d1b9603d82a41f2211348ec98516098b6d012114f785a763b8762512257`; 1,900,544 bytes; actual guest base `0x10000000`; 5,917 exports. Although its header retains preferred base `0x180000000`, the supplied memory image is already rebased to `0x10000000`: do not relocate it twice. The fetcher verifies both exact source chunks and the complete extracted image. No game or official Geode binaries are committed.

Supported executed services include process/thread identity, FILETIME and monotonic timing, system/version information, CPUID, static TLS, environment/last error, SRW locks, condition wakes, on-exit registration, C/C++ initializer callbacks, CRT allocation and strlen, mapped-module/export lookup and bounded dependency attach. DisableThreadLibraryCalls fails for active static TLS, using declared model error ERROR_MOD_NOT_FOUND (126), rather than pretending it disabled required TLS notifications. Unknown modules are rejected.

The `ceilf` CRT adapter uses the Win64 XMM0 argument/return ABI, preserves signed zero and rejects nonfinite inputs.

The CRT heap (52–60 MiB) owns tracked 16-byte-aligned blocks. calloc overflow/zero fill, realloc preservation/failure, coalescing free and errno ENOMEM are tested. Thread descriptions use a separate local heap and LocalFree. Arbitrary thread handles and callbacks on shutdown remain unsupported.

Floating point is deliberately bounded: finite normal/zero comparisons and predicates, signed integer-to-binary32/64 conversions with all four MXCSR rounding modes and sticky precision, finite-to-integer CVTT conversion with masked invalid/precision status, and normal/zero binary32 add/subtract/multiply/divide in nearest-even mode. NaN/infinity/subnormal comparisons, unsupported division inputs/results/modes and unmasked precision exceptions stop. This is not general SSE/x87 support. The guest starts with MXCSR 0x1f80. The native reference now executes the reached scalar SSE operations on real host x64, using explicitly selected normalized instructions and checked register or base/displacement memory operands. Host MXCSR is always saved/restored. This prevents Unicorn precision-flag omissions from corrupting the reference. Unsupported addressing and unmasked FP exceptions stop. There are 107 separate hardware floating fixtures, with 36 emulator status discrepancies recorded. The prior MIN64/-1 integer-division discrepancy is likewise checked with real x64 SIGFPE.

## Durable milestones

Latest: `95e864f60a2d5de5a879550b8653b00e2433cbab` — **1,063,171 and successful DLL process attachment**, https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42290998928 . All three profiles and the actual patch/trampoline component pass; user Edge confirmation is recorded.

| Source revision | Total prefix | Recorded evidence |
|---|---:|---|
| 95e864f60a2d5de5a879550b8653b00e2433cbab | 1,063,171; DLL attach TRUE | `dist/batch-verified.json`; https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42290998928 |
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
GEODE_GENERATED_CODE=1 GEODE_FMOD_BRIDGE=1 GEODE_VCRUNTIME_DLL=/tmp/vcruntime140-x64.dll GEODE_MSVCP_BOOT=1 GEODE_MSVCP_DLL=/tmp/msvcp140-x64.dll GEODE_INSTRUCTION_LIMIT=2000000 GEODE_PRIMARY_IMG=/tmp/GeometryDash.exe.img GEODE_DLL=/tmp/Geode.dll GEODE_COCOS_IMG=/tmp/libcocos2d.dll.img GEODE_OUT=/tmp/geode-resume-run GEODE_WASM_OPT=/tmp/geode-wasm-tools/node_modules/.bin/wasm-opt bash experiments/geode-binary/run-startup-tests.sh
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
