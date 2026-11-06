# Resume checkpoint — actual Geode DLL translation

User goal: keep progressing in batches and save durable checkpoints. Do not equate a prefix or SDK canary with the full Geode loader. Work on branch `geode-startup-batch` in `risoekppoo-cyber/gddashyes`; normal game files remain unchanged.

## Latest verified milestone

`dist/batch-verified.json`: **8,416 total original-machine/loader instructions** in WASM, compared with independent x64 reference execution under the declared guest model:

- **6,958 original Geode.dll instructions**.
- **1,442 original libcocos2d.dll instructions**.
- **16 generated initial-loader instructions**, counted separately.
- **152 host calls**; Cocos's real PE DLL entrypoint completed and its pending LoadLibraryExA call returned the real guest module base. This is Cocos initialization in the bounded guest model, not completion of Geode initialization.
- Both actual Geode PE TLS callbacks completed. Native C/C++ initializer callbacks execute with Win64 shadow space and checked native return frames; callback counts and table state are recorded in the report.
- All 16 GPRs, all 16 XMMs, five arithmetic flags, MXCSR, the full native stack, complete Geode and Cocos images, shim images, TIB, both static TLS areas, CRT heap, allocation metadata, errno region, local-description heap and on-exit arena match.

Geode resolved three actual Cocos exports after the dependency finished: clearQueuedInput, pumpRawInput and setupWindow (full mangled names and guest addresses are in `resolvedExports`). It has not reached full loader startup or loaded an existing .geode mod.

The complete local script passed: module/heap/initializer/thread/string/synchronization contracts, the actual 8,416-instruction prefix, 80 machine-code ALU/SSE cases, and 200 regenerated original scalar getter comparisons. Fresh-runner confirmation of this newest revision is pending until recorded below.

## Exact runtime stop and next work

**KERNEL32.dll!GetModuleHandleW(NULL)** at `0x70000730` now requests the real **primary GeometryDash.exe image**. No fake main-module handle is returned. Current Geode initialization is incomplete.

1. Recover the hash-pinned `GeometryDash.exe.img` from the same upstream payload. The manifest identifies GD 2.209, Steam build 26002420, primary image SHA-256 `dab65e0527e343f03ea08614b2967f5a20cdb481b1622aadde76cde648803c2a`. Determine the image's actual rebased guest address from its pointers, not merely the preferred base still present in its header.
2. Audit address conflicts before mapping it. Existing test-only TIB/arenas/compiler stack occupy low guest addresses and must move if they overlap the actual primary image. Centralize these regions; update native and WASM sides together and re-run the complete comparison.
3. Register the real primary module and bind its imported services explicitly. GetModuleHandleW(NULL) may then return its mapped base. Continue the original Geode code, stopping at the next real missing operation. Do not fake GD functions or assume game objects have initialized.
4. Before claiming game support, attach this startup runtime to the actual game dispatcher and initialized game memory. The standalone prefix has not booted the game. Existing `.geode` packages, hook installation, exception unwinding, worker scheduling and browser performance remain separate unproven stages.

The generated single giant dispatcher also triggers a V8 TurboFan Zone-memory failure during tier-up after executing successfully. The standalone test uses `node --liftoff-only` to keep verification reliable. **Browser execution/performance of this enlarged dispatcher is not verified**. Split translated code into smaller native-function dispatch units before browser integration; a compiler flag is not a production-browser fix.

## Implemented runtime model

This is one serialized guest execution context, not Windows or Wine. Declared CPU/Windows compatibility profiles are not reports about host hardware/OS. Unimplemented imports, unknown modules/exports/ordinals/forwarders, primary-module requests, nested dependency loads, repeated loads needing reference counts, failed attach needing detach, blocking lock contention, nonempty condition queues and unknown guest frees stop explicitly.

Module lookup is case-insensitive and export names are case-sensitive. Mapped PE export tables supply real native VAs. System shims contain actual PE32+ export tables exposing implemented gateways only; incomplete catalogs never imply that an arbitrary export is absent. The exact Wine extension `ntdll.dll!wine_get_version` is declared absent for the native-Windows compatibility model (NULL/error 127). Geode and Cocos catalogs are complete mapped PE catalogs. `mapped_pe` must interpret image RVAs as memory offsets, not disk raw-section offsets.

Cocos image SHA-256: `1ade9d1b9603d82a41f2211348ec98516098b6d012114f785a763b8762512257`; 1,900,544 bytes; actual guest base `0x10000000`; 5,917 exports. Although its header retains preferred base `0x180000000`, the supplied memory image is already rebased to `0x10000000`: do not relocate it twice. The fetcher verifies both exact source chunks and the complete extracted image. No game or official Geode binaries are committed.

Supported executed services include process/thread identity, FILETIME and monotonic timing, system/version information, CPUID, static TLS, environment/last error, SRW locks, condition wakes, on-exit registration, C/C++ initializer callbacks, CRT allocation and strlen, mapped-module/export lookup and bounded dependency attach. DisableThreadLibraryCalls fails for active static TLS, using declared model error ERROR_MOD_NOT_FOUND (126), rather than pretending it disabled required TLS notifications. Unknown modules are rejected.

The CRT heap (52–60 MiB) owns tracked 16-byte-aligned blocks. calloc overflow/zero fill, realloc preservation/failure, coalescing free and errno ENOMEM are tested. Thread descriptions use a separate local heap and LocalFree. Arbitrary thread handles and callbacks on shutdown remain unsupported.

Floating point is deliberately bounded: finite normal/zero comparisons and predicates, signed integer-to-binary32/64 conversions with all four MXCSR rounding modes and sticky precision, and normal/zero binary32 division in nearest-even mode. NaN/infinity/subnormal comparisons, unsupported division inputs/results/modes and unmasked precision exceptions stop. This is not general SSE/x87 support. The guest starts with MXCSR 0x1f80. Raw SSE fixtures were also executed on real x64 hardware with host MXCSR restored: 69 hardware cases passed; Unicorn 2.1.4 omitted precision flags in 20 cases, so those expected flags come from hardware. The prior MIN64/-1 integer-division discrepancy is likewise checked with real x64 SIGFPE.

## Durable milestones

| Source revision | Total prefix | Recorded evidence |
|---|---:|---|
| e33d28c36977bff1b29e77b9c01203cf11da4eeb | 865 | https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42188246572 |
| 7a6188aa21209386b4eff54a3dfca5f992e8368a | 988 | `dist/module-resolution-verified.json`; https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42196526947 |
| d708353b8abc6c864776c5a85c9ee87bdbdc4696 | 1,607 | `dist/crt-heap-verified.json`; https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42197100197 |
| Current checkpoint | 8,416 | `dist/batch-verified.json`; complete local script passed, CI pending |

Older `dist/batch-native-next.json`, startup-smoke/time/thread reports and README original-canary tables are historical, not the current result. Always prefer this file plus `dist/batch-verified.json`. Each generation has a fresh ID; stale generated C/WASM or mismatched report/reference outputs are rejected. Repeated visits to the final API's address must still execute earlier successful calls: the verifier enables its stop PC only after all expected host calls have been consumed.

## Rebuild after scratch disappears

Worktree: `/workspace/scratch/d6c02ef02c38/geode-startup-batch`.

```bash
python -m pip install -r experiments/geode-binary/requirements.txt ziglang==0.14.1
npm install --prefix /tmp/geode-wasm-tools binaryen@123.0.0
python experiments/geode-binary/fetch-startup-dll.py /tmp/Geode.dll
python experiments/geode-binary/fetch_cocos_image.py /tmp/libcocos2d.dll.img
GEODE_DLL=/tmp/Geode.dll GEODE_COCOS_IMG=/tmp/libcocos2d.dll.img GEODE_OUT=/tmp/geode-resume-run GEODE_WASM_OPT=/tmp/geode-wasm-tools/node_modules/.bin/wasm-opt bash experiments/geode-binary/run-startup-tests.sh
```

Local tools if present: Python dependencies `/tmp/geode-batch-tools` (set PYTHONPATH), Zig `/tmp/geode-batch-tools/ziglang/zig` (set GEODE_ZIG), Binaryen `/tmp/geode-wasm-tools/node_modules/.bin/wasm-opt`. Official DLL SHA-256 remains `ccedc2f1c86baf342f6720b9685991ca31fba246453efe2a1daf609dc40b6499`; its release ZIP is also checked. CI runs the same script, uses pinned dependencies and read-only repository permissions, and uploads only the JSON report.

Current guest regions: native stack 2–3 MiB; TIB/vector 4 MiB; on-exit arena 5–6 MiB; Geode static TLS 7 MiB; private compiler stack 8–9 MiB; local description heap 10–11 MiB; errno 12 MiB; Cocos static TLS 13 MiB; shim PE images 16 MiB onward; Geode DLL 32 MiB; CRT heap 52–60 MiB; Cocos DLL 256 MiB. Audit and relocate auxiliary regions before mapping the real primary executable.
