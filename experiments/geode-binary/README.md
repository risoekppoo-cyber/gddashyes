# Geode Windows binary translation checkpoint

This experiment executes instructions from the **official Windows Geode.dll**, not a replacement C++ implementation of those functions. It is an early binary compatibility component, **not the full Geode loader**. Downloaded `.geode` packages do not work yet.

## Current startup work

The original browser canary below is historical. The active `geode-startup-batch` branch now verifies 8,416 startup instructions (6,958 Geode, 1,442 real Cocos and 16 loader instructions), including completion of the real Cocos DLL entrypoint under the declared standalone guest model. Geode initialization and existing mod packages remain unsupported. See [CHECKPOINT.md](CHECKPOINT.md) for the exact runtime stop, evidence, limitations and reproducible resume commands.

## Try the earlier browser canary

- [Independent x64 reference comparison](https://risoekppoo-cyber.github.io/gddashyes/experiments/geode-binary/)
- [Game with binary canary](https://risoekppoo-cyber.github.io/gddashyes/index.html?sdkmenu=1&binarygeode=1&quality=low&rev=binary1)

The game link also enables the existing Geode SDK subset experiment. After the native menu finishes initializing, the binary test runs in the game's own memory. A successful test changes the native menu label to **Geode DLL canary active** and adds a `binary` report. Browser boot, label visibility and gameplay still need browser verification; Node tests do not establish those results.

## Implemented and tested

| Component | Evidence | Limit |
|---|---|---|
| Official x64 DLL → SLEIGH p-code → generated C → WebAssembly | Five exported Hook methods, 20 original instructions; 200 comparisons against the original DLL bytes executed in Unicorn 2.1.4 | Only this instruction closure; no constructors or startup |
| Register and object compatibility | All 16 general registers, native return PC, return stack and 256 object bytes compared after every reference case | Test objects are constructed fixtures, not genuine initialized loader objects |
| Shared GD memory | Translated `Hook::getAddress` reads a native function address; the existing game dispatcher calls it and returns 480 | Controlled real game function, not a full boot or gameplay test |
| PE32+ image mapper | Actual 17,035,264-byte DLL image mapped; 56,939 DIR64 relocations applied; 2,516 named exports indexed | Does not initialize DLLs or implement a Windows runtime |
| Rebased export execution | Translated methods called using exports from the mapped image at guest base `0x02000000`, with a nonzero guest-to-linear offset | Does not test all relocated functions |
| Import metadata and IAT binding | 656 normal and 1,353 delay imports parsed; unresolved IAT slots cleared; explicit resolver binding checked | Binding test uses sentinel addresses and executes no Windows imports |
| TLS and exceptions metadata | Two TLS callbacks relocated; 32,807 x64 unwind records identified | Callbacks, TLS allocation and exception handling are not implemented |
| Failure behavior | Unknown program counters, step exhaustion and high unmapped data pointers stop with explicit errors | No general untrusted-DLL sandbox is claimed |

`verify.mjs` rejects auxiliary WASM modules with memory initialization, globals, startup sections or unexpected imports before attaching them to GD memory. The generated canary imports only memory and an error-reporting function, and has no initial memory writes.

## Actual startup blocker

**Follow-up:** [The new indirect-call fixture](indirect/README.md) passes 64 independent x64 reference cases, including a native caller → actual Geode dispatch thunk/getter → caller → native callback sequence. It adds opt-in `CALLIND` and `BRANCHIND` translation and a router for explicitly translated addresses. The original conservative startup probe below remains blocked; full DLL startup, target discovery and Windows services have not been implemented.

`dist/startup-probe/blocked.json` records a bounded traversal of the DLL's real entrypoint. It reaches 84 translated/discovered instructions, then stops at:

```
0x180a524c5: CALL qword ptr [0x180e43558]
```

That slot is the PE load configuration's **GuardCFDispatchFunctionPointer**, initially pointing to `0x180a527b0`. It is an indirect call, not a missing ordinary imported function. The current bounded translator does not implement general indirect call target discovery or route arbitrary DLL calls through the game's scheduler. This is the first encountered translation blocker, not the only remaining problem and not a fundamental browser restriction.

Before full Geode startup is credible, the runtime must also resolve the Windows/CRT/Cocos/Extensions imports with correct behavior, initialize security/runtime state, run TLS and DLL initialization in order, preserve the MSVC object ABI and implement exception/thread behavior used on executed paths. The mapper deliberately leaves unresolved imports unusable. It does not return success from fake Windows services.

The next implementation target is a unified guest-address dispatcher for translated DLL bodies, GD bodies, CFG thunks and explicitly implemented host imports. Validate its native indirect calls and returns on small PE fixtures before attempting the real CRT entrypoint. Then implement the services actually reached by startup. Existing arbitrary native instruction-patching mods require additional translated-code invalidation/hook support even after loader startup works.

## Reproduce

Inputs:

- [Official release: Geode v6.0.0-alpha.1](https://github.com/geode-sdk/geode/releases/tag/v6.0.0-alpha.1)
- Windows release ZIP SHA-256: `54e7b9b08e926204a01fb18506ba73477704167739681003aab4c5d2093f3822`
- Extracted `Geode.dll` SHA-256: `ccedc2f1c86baf342f6720b9685991ca31fba246453efe2a1daf609dc40b6499`
- Pinned GD wasm SHA-256: `523d9362955eba27a8ce64ec9b4fda496c8ecc30e6ac9ca1f01cc76c89a5a15a`
- Python packages in `requirements.txt`; LLVM clang with wasm32 support, tested with Emsdk 6.0.5; Node 24.22.1.

```bash
python -m pip install -r experiments/geode-binary/requirements.txt
export GEODE_DLL=/path/to/official/Geode.dll
export GD_WASM=/path/to/pinned/gd.wasm
export WASM_CLANG=/path/to/emsdk/upstream/bin/clang
bash experiments/geode-binary/build.sh
```

`lift.py` rejects a mismatched DLL. The checked-in `manifest.json` includes the translated instruction/p-code listing and generated C hash. `reference.py` executes original machine bytes without calling the generated C or WASM; Unicorn is an ISA reference, not an independent Windows runtime. Rebase comparisons alone do not establish full PE relocation support; the separate mapper test exercises actual PE relocations.

Recorded local results are in `dist/node-result.json` and `dist/pe-result.json`. Neither sets `fullGeodeLoader` or `existingGeodePackagesSupported` to true. No original GD payload or full Geode DLL is redistributed here. The upstream Geode license is retained in `LICENSE.GEODE.txt`.
