# Live game mapping checkpoint — 7 November 2026

The integrated cleanup and WASM import/stack-validation fixes pass local and CI
checks. The actual hash-pinned callback WASM matches eight independent recorded
reference contexts at both its old base and a relocated base.

The real-game Chromium test now reports **LIVE_DLL_MAPPING_PROLOGUE_PASS**:
- The official DLL is hash-checked, mapped and rebased into a retained allocation
  owned by the game's exported allocator, with 65,536-byte image alignment.
- This route requires the pinned runtime's observed `guestBase=0`; guest and
  linear addresses are identical. Other layouts are rejected.
- All 56,939 relocations were applied. The loaded callback instruction bytes
  match the pinned translation input before execution.
- The callback prologue runs at the actual new image base in the live game.
- The sampled CPU region is preserved, the native stack window is restored,
  temporary allocations are cleaned, and the game continues (142 frames).
- The DLL mapping is retained until page teardown. Errors in the observation
  attempt release it. Unknown/mismatched DLLs fail the hash check.

## Try the mapping check

Open [the isolated mapping page](https://risoekppoo-cyber.github.io/gddashyes/experiments/geode-binary/mapped/).
Select `Geode.dll` extracted from the official Windows Geode 6.0.0-alpha.1 release.
Selection stays in the browser. The normal launcher is unchanged.
The original prologue-only test remains at `../handoff/`.

## Remaining boundary

This is **not a full Geode loader**. All 2,009 imports remain unresolved;
initialization, TLS/CRT state, and the deferred callback beyond its first call
are not implemented by this route. Existing `.geode` packages remain unsupported.
Only the translated prologue is executed, using a shadow CPU and restored
native stack. Mapping the full DLL does not execute its initialization.

The reproducible workflow and browser runner are
`.github/workflows/geode-integration.yml` and
`integration-tests/browser-smoke.cjs`. The workflow downloads the exact official
DLL into a temporary test-input folder; no full DLL is committed or redistributed.
See `live-mapping-result.json` for the actual browser report and run link.
