# FMOD adapter bridge checkpoint

This component verifies the port's actual `FMOD::System::init` adapter and a matching owned Win64 entry. It does not load Geode or advance the guarded startup boundary.

The hash-pinned primary image imports `?init@System@FMOD@@QEAA?AW4FMOD_RESULT@@HIPEAX@Z` at guest IAT address **0x00ace740**. The pinned module's initializer (function 24695) registers **table slot 24570**, which points to **function 24950**. The build verifies the exact registration sequence, table mapping, signature and function body. This adapter only writes zero (`FMOD_OK`) into guest RAX; it performs no audio initialization. The loader's separate `gd_js_audio` and `gd_js_audio_sound_data` imports implement later audio operations.

The owned native implementation is 16 padding NOPs followed by `mov eax,0; ret`. It is generated bridge code, not a recovered FMOD DLL prologue. It preserves the existing return-only adapter's semantics. Its padding supplies a defined entry region for a controlled detour. Other FMOD functions require their own contracts; returning success for them is unsupported.

## Verified scope

- 64 randomized register contexts, with original/hooked/restored calls through direct WASM calls, the original function table and the original native dispatcher: 576 calls.
- Full 4 KiB CPU context comparison after every call, including native return PC/SP on dispatcher calls. Hooks call the unchanged original body before changing its result from 0 to 600 and incrementing maxchannels.
- An owned-entry router accepts the identical registered E9 detour bytes used by the native reference. It validates the entire patch before routing changes and rejects unknown encodings and destinations (128 rejection cases).
- Independent Unicorn 2.1.4 executes the owned native entry, actual detour and original trampoline in 192 executions. General registers match the browser contract; XMMs and flags are preserved. Native translation caches are invalidated on patch/restore.
- No host imports are reached by this isolated fixture; unselected game functions trap. No game boot, audio playback or Geode hook-installer execution is claimed.

The router is an explicitly invoked component. It is NOT yet a write barrier attached to translated Geode stores or Windows protection/patch APIs. The full Geode startup remains guarded before the unsupported native FMOD read.

## Next integration step

1. Register this owned entry in the startup runtime as an explicit browser-adapter provider, binding only this verified import. Keep all other FMOD exports unresolved.
2. Expose its real bridge bytes to the original Geode decoder. Catch writes before native/reference execution consumes changed code.
3. Connect Geode's supported patch writes to routing invalidation and the live WASM hook target. The current router supports only the controlled E9 encoding and registered target; arbitrary Geode jump/trampoline encodings require additional implementation.
4. Verify decoder, patch installation, original/trampoline call and restoration end to end before moving the canonical startup boundary. Keep `startupBoundaryCleared` false until then.

## Reproduce

```sh
python -m pip install unicorn==2.1.4
python experiments/fmod-bridge/fetch_module.py /tmp/fmod/gd.wasm
python experiments/geode-binary/fetch_primary_image.py /tmp/fmod/primary.img
python experiments/fmod-bridge/build.py /tmp/fmod/gd.wasm /tmp/fmod/primary.img /tmp/fmod/test
node experiments/fmod-bridge/verify.cjs /tmp/fmod/test
python experiments/fmod-bridge/verify_native.py /tmp/fmod/test
```

Do not commit generated fixture WASM or downloaded game images. Only code, manifests and verification summaries belong in the repository. The fixture excludes original data segments and traps every unselected function; it is not a playable game.

Verified locally and on a clean GitHub runner: https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42278351214 . Tested source: `309233501d70932f128477bf45765ded5ccd7ca2`.

## Startup provider integration

`../geode-binary/native_fmod_bridge.py` now provides the owned entry catalog under the opt-in startup mode `GEODE_FMOD_BRIDGE=1`. The catalog has 64 hash-pinned adapter mappings; 26 have the exact return-only body. Stateful methods remain unsupported at their call gateways. Geode can inspect the owned entry bytes, but code writes are guarded until generated-code execution and live patch invalidation are implemented. This startup integration has a separate combined verification checkpoint; the original 64-case contract proof does not establish full loader support.
