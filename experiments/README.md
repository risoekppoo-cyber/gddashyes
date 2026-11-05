# Geometry Dash WASM hook experiment

This is a working function-interception prototype, **not a port of Geode**.
It adds no Geode mod browser and cannot load `.geode` files.

There is now a [compiled TulipHook experiment](tulip-wasm/README.md) with a
separately compiled C++ plugin. It passes the real-game getter and hook-chain
tests in Node. Open `experiments/tulip-wasm/` to run its browser check. This
ports part of Geode's hook dependency, not the full Geode loader or SDK.

## What passed

The Node verification runs the actual pinned game module, with graphics and
audio left unbooted. It invokes the real compiled
`GJBaseGameLayer::getHitboxTrailMax` implementation using a controlled native
CPU/stack fixture. Its original result is 480. An after-hook observes 480 and
changes it to 600. Direct calls and function-table calls both reach the hook.
The return address and stack advancement remain correct. Disabling the hook
and restoring the original both restore 480. A modified input module is rejected.

A separate compiled WASM bridge can also invoke the game by native guest
address (`0x717680`), rather than by a WASM function index. It exposes the
existing translated dispatch helpers, shares the game memory, and drains
pending translated calls before returning. A controlled queued-call test
executes the actual getter twice and checks both native returns and stack
advancement. This does not implement arbitrary C++ object marshalling.

These are execution results from the real game code, not a replacement getter.
They do not establish that the complete game boots or that Geode loads.

## Try the menu experiment

First open `experiments/check.html` and click **Run bridge check** to run the
shared Node/browser execution check without graphics. It displays browser
features and a copyable result report. A pass is not a full-game boot test.

Serve the repository over HTTP, then open `/?hooktest=1` using a browser with
WebAssembly JSPI and WebGL 2. The normal URL retains the existing loader path.
The diagnostic at the bottom right reports entries into the compiled menu
function and returns from its WASM body. These counters can include re-entry
while the translated program processes continuations; they are not a count of
completed native menu initializations. The experiment does not add a menu label
or alter the gameplay getter result; the 600 override is confined to the Node test.

GitHub Pages serves the configured publishing branch. A branch URL on github.com
is a source view, not a playable preview. Merge/deploy this branch before using
the Pages URL with `?hooktest=1`.

The experimental path buffers and verifies the module before instantiation,
so it uses more startup memory than the normal streaming loader.

## Reproduce the execution check

The game module is not committed to this repository. Obtain the pinned payload
from the upstream repository and decompress it locally:

`https://github.com/Ale7208/geometry-dash-wasm/blob/main/payload/wasm-523d9362955eba27a8ce64ec.gz`

Then run:

```sh
node experiments/verify-hook.cjs /absolute/path/to/gd.wasm
```

Node 24 was used for verification. No npm dependencies are needed for this check.
The expected uncompressed SHA-256 is:

`523d9362955eba27a8ce64ec9b4fda496c8ecc30e6ac9ca1f01cc76c89a5a15a`

Optional local binary inspection:

```sh
python tools/wasm_probe.py /absolute/path/to/gd.wasm --json /tmp/module.json
```

`--slice` emits an intentionally non-playable module for local disassembly.
It retains the selected function bodies and replaces all others with traps.
Do not distribute these generated game-code files.

## Mapping and mechanism

| Target | Windows RVA | Guest VA | Table slot | WASM function |
| --- | --- | --- | --- | --- |
| `MenuLayer::init` | `0x4720c0` | `0x8720c0` | 8004 | 14163 |
| `GJBaseGameLayer::getHitboxTrailMax` | `0x317680` | `0x717680` | 5341 | 6726 |

The Windows image is mapped at `0x400000`. These addresses match Geode's
2.2091 bindings, although this payload's manifest reports gameVersion 2.209.
The module's own data records and element segment resolve the table and
function indices; the hash pins the mapping to this exact build.

`MenuLayer::scene` contains a direct call to WASM function 14163, so changing
only table slot 8004 would miss that call. This prototype instead replaces the
target's function body with a typed indirect call through a new slot. It appends
the original body as a separate function, preserving all existing function IDs,
and installs a small compiled WASM wrapper that calls before → original → after.
No imported function IDs are shifted. All edits are in-memory and hash gated.

The native CPU layout used by the verification is RAX +0, RCX +8, RSP +32,
RIP +192. The getter advances RSP by 8 and loads RIP from the guest return stack.

## Remaining work

- Verify the menu hook during a complete browser boot and actual gameplay.
- Model native call completion across translated continuations before implementing
  general native after-hooks.
- Bridge Geode's hook registry, calling conventions and game-object access to this
  translated execution model.
- Adapt platform services, library loading and mod initialization.
- Test one compatible mod before attempting arbitrary `.geode` packages.

Geode's iOS patchless mode provides a design reference for preparing hooks,
but its ARM/Mach-O patcher is not directly reusable for this x86-64/WASM build.

## Checkpoint

The hook and native-address/queued-call checks pass in Node 24.22.1. The
connected tool set currently exposes no control connection to the user's
local Edge browser. The browser check page is ready for that verification.
Real Geode loading remains incomplete: the current work is a translated-game
bridge, not a Geode-compatible C++ ABI, platform loader, or `.geode` loader.

## Primary references

- [GD payload and loader](https://github.com/Ale7208/geometry-dash-wasm)
- [Geode 2.2091 bindings](https://github.com/geode-sdk/bindings/blob/main/bindings/2.2091/GeometryDash.bro)
- [Geode loader](https://github.com/geode-sdk/geode/blob/main/loader/src/loader/LoaderImpl.cpp)
- [TulipHook handler](https://github.com/geode-sdk/TulipHook/blob/main/src/Handler.cpp)
