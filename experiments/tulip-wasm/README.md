# Compiled TulipHook + separate C++ mod experiment

**Result: PASS in Node 24.22.1. Full Geode is not ported.**

Open `experiments/tulip-wasm/` on the deployed site and click **Run C++ mod test**
to run the same checks in Edge. Browser verification of this new experiment is
still pending. This page does not boot graphics or start the full game.

## What actually runs

This compiles real, unmodified upstream TulipHook `.cpp` files, not a JavaScript
replacement for its hook registry. TulipHook is Geode's hooking dependency.
The sources compiled into the engine are:

- `src/Handler.cpp`: hook registry, removal, priority ordering and chain state.
- `src/Pool.cpp`: patchless common-handler dispatch and handler ownership.
- `src/Main.cpp`: public TulipHook entry points used by the adapter.
- `src/target/Target.cpp`: portable target helpers.
- `src/convention/DefaultConvention.cpp` and `CallingConvention.cpp`.

The local `wasm-platform.hpp` permits compilation without selecting a native
instruction set and supplies the target header normally included by native
platform headers. `target.cpp` adds a minimal WebAssembly target. Executable
page allocation is rejected. The experiment enables upstream patchless mode
before creating hooks; it never uses native machine-code generation.

`test-mod.cpp` is compiled separately as an Emscripten side module. The engine
loads it with real `dlopen`/`dlsym`. Its C functions call a small adapter API,
which calls upstream TulipHook's public hook APIs and common-handler dispatch.
This plugin is **not a Geode SDK mod or a `.geode` package**.

The game remains a separate WebAssembly instance. Its translated Windows CPU
state is passed as an opaque address. A narrow JavaScript bridge calls the real
original getter and reads/writes its integer return register. No game getter is
reimplemented or replaced with a test fake.

## Execution evidence

`node-result.json` records the actual run against the pinned 123 MB game module:

| Check | Observed result |
| --- | --- |
| Original `GJBaseGameLayer::getHitboxTrailMax` | 480 |
| Dynamically loaded C++ hook calls original, adds 120 | 600 |
| Existing direct call and table call | Both reach the C++ hook |
| Remove hook | 480 |
| Add hook again | 600 |
| Add a second hook that multiplies by 2 | 1080 |
| Change second hook's priority | 1200 |
| Remove hooks and restore original entry | 480 |
| Guest RSP and RIP | Preserved on every tested call |

The two-hook results exercise upstream ordering and nested common-handler
dispatch: `480 * 2 + 120 = 1080`, then `(480 + 120) * 2 = 1200`.

## Rebuild

Use Emscripten **6.0.5**. Activate its SDK, then obtain these pinned sources:

```sh
git clone https://github.com/geode-sdk/TulipHook.git /tmp/TulipHook
git -C /tmp/TulipHook checkout 62ef839ee205d6943361c0902d08224acab32660
git clone https://github.com/geode-sdk/result.git /tmp/geode-result
git -C /tmp/geode-result checkout 0be6e01b892f54036127249f4f9e4007500c877b
TULIP_SOURCE=/tmp/TulipHook RESULT_SOURCE=/tmp/geode-result bash experiments/tulip-wasm/build.sh
node experiments/tulip-wasm/verify-node.mjs /absolute/path/to/gd.wasm
```

TulipHook is pinned to v3.1.15, the version required by the supplied Geode
6.0.0-alpha.1 source. Result is pinned to v1.5.0. No upstream `.cpp` files
were edited for this build. The build script checks commit IDs and tracked
source modifications. The small compiled engine and plugin are committed under
`dist/`; the original game payload is downloaded separately and hash checked
as in the earlier bridge experiment.

Compiled binary SHA-256 values:

```text
engine.wasm   e45633d2816ff8797757f2c7a0aa5cc6ad660de3b1c7d7eec9dbd0212fc92cf1
test-mod.wasm b428570a1a8b0117a0aaa1195fda7c02d5a58803a90a94cd9dff9fc545dd0e59
```

## Full Geode build attempt

The user's supplied `geode-6.0.0-alpha.1.zip` has SHA-256:

`65e1f3100a2425d2513b8203f151cf154b728bc916397278a62c259a678409c0`

Configuring its unmodified source with Emscripten 6.0.5 and CMake 3.31.6 fails:

```text
cmake/PlatformDetect.cmake:17:
Unable to detect platform, please set GEODE_TARGET_PLATFORM in the root CMake file.
```

Repeating with `-DGEODE_TARGET_PLATFORM=Web` fails:

```text
cmake/Platform.cmake:190: Unknown platform Web
```

These are actual configure results, recorded in `full-geode-attempt.txt`.
No complete Geode loader binary was produced.

## Limits and next milestone

This demonstrates portable hook management, patchless chaining, and a separately
compiled plugin touching real game CPU state. It does **not** implement Geode's
platform loader, Geode SDK classes, Cocos bindings, object layouts, C++ ABI, mod
metadata/dependencies, UI, filesystem services, or existing native mod binaries.
The getter is synchronous and argument-free apart from the translated CPU;
general function signatures and translated continuations are not solved here.
The previous native-address bridge is not used for the original call in this test;
this test calls the saved original getter body directly.

The next milestone is a small Geode SDK source mod compiled for a defined WASM
platform, with an explicit binding for one game method. It needs a real Geode
platform adapter and a checked game ABI bridge. Existing Windows/Android/iOS
`.geode` downloads remain unsupported; this result does not establish that all
their behavior can be translated.

Upstream source: [TulipHook](https://github.com/geode-sdk/TulipHook/tree/62ef839ee205d6943361c0902d08224acab32660),
[Geode](https://github.com/geode-sdk/geode),
[Geode Result](https://github.com/geode-sdk/result/tree/0be6e01b892f54036127249f4f9e4007500c877b).
