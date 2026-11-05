# Geode Hook SDK subset and native menu-label experiment

The Geode public Hook API now compiles and runs against the pinned translated
game. `node-result.json` records the passing execution check. This is a **limited
source port**, not the full Geode SDK/loader or native `.geode` compatibility.

## Try it

1. Open `experiments/geode-sdk/` and run the SDK bridge test in Edge.
2. Open `index.html?sdkmenu=1&quality=low` at the repository root.
3. Wait for the game menu. The mod attempts to add **Geode SDK hook active** as a
   native Cocos bitmap-font label near the bottom of the menu.
4. Expand the SDK panel at the top right and copy its report. If the label is
   visible, click **I can see the menu label** before copying.

The full-game path is experimental and has **not been booted or visually
verified by the agent**. Local Edge control is unavailable in this session.
An attached native label is only reported after Cocos `getParent` confirms its
parent is the menu. The report keeps visual confirmation and full-game boot
separate. A passing SDK bridge test does not mean the label was rendered.
The normal game URL does not enable this experiment.

## Real upstream code vs platform port

The side module compiles **unmodified Geode `loader/src/loader/Hook.cpp`** from
the supplied 6.0.0-alpha.1 source. Its SHA-256 is
`c82bb93d8dd016aaa09188ca392c4198351a507c337d83bc04995b16f67e6a07`.
The retained files and Geode license are under `vendor/`.

The public `Geode/loader/Hook.hpp` retains its classes and methods. Its broad
`utils/general.hpp` include is replaced by the two standard byte-container
aliases it uses. The exact change is `vendor/Hook.hpp.patch`. `Prelude.hpp`,
`DefaultInclude.hpp` and `loader/Tulip.hpp` are copied from upstream. A new
`platform/platform.hpp` supplies only the macros this subset needs.

`HookImpl.hpp` is a **new target implementation**, replacing the native
Loader/Mod-owned private implementation for this experiment. It routes actual
Geode Hook create/enable/disable/priority calls to the compiled TulipHook engine.
Owner lookup returns null; IPC runtime-info requests are unsupported and throw.
Mod ownership, `$modify`, patches, resource loading and the broader SDK are not
implemented. This must not be presented as an unmodified general Geode mod.

`menu-mod.cpp` uses the actual public Hook class. It hooks the translated entry
with an explicitly adapted `void(cpuAddress)` signature, calls the original
through `ws_next`, and requests a label only after a checked native return.
It also supplies a getter hook for independent verification. The getter test
is not enabled during the menu experiment.

## Native game bindings

All calls use a separate guest CPU and stack. The game and mod retain separate
memories; only opaque guest addresses and copied values cross the bridge.

| Cocos method | Guest VA | Table slot | WASM function |
| --- | --- | --- | --- |
| `CCLabelBMFont::create(char const*, char const*)` | `0x10049150` | 19938 | 1212 |
| `CCNode::setPosition(CCPoint const&)` | `0x10004e60` | 18604 | 3376 |
| `CCNode::addChild(CCNode*, int, int)` | `0x10002ba0` | 18495 | 1687 |
| `CCNode::getParent()` | `0x10003540` | 18528 | resolved by dispatcher |

Addresses come from the loaded Cocos image's PE exports and match the WASM
address records. Image SHA-256:
`1ade9d1b9603d82a41f2211348ec98516098b6d012114f785a763b8762512257`.
The game module is pinned to
`523d9362955eba27a8ce64ec9b4fda496c8ecc30e6ac9ca1f01cc76c89a5a15a`.

`GuestApi` uses the real translated dispatcher and pending-call drain helpers,
Win64 integer argument registers and a guest `CCPoint` reference. It validates
the return stack and PC, bounds continuations and restores pending/resume
globals. It supports the explicit synchronous call allowlist, not arbitrary
C++ arguments, floating registers, asynchronous native calls or callbacks.

`MenuCompletion` records the native entry stack, return PC and `this` handle.
It accepts completion only when the stack has popped the return address, RIP
matches that address, pending calls are clear and the Boolean result is true.
A returned WASM body alone does not trigger label creation.

## Verification performed

The actual pinned game module passed in Node 24.22.1:

- SDK side module loaded, using upstream Hook.cpp and the ported public header.
- Geode `Hook::enable` changed the real getter from 480 to 600 on direct and
  table calls; `toggle(false/true)` restored and reapplied it.
- Guest return stack and PC were preserved.
- Real Cocos `CCNode::setPosition` accepted a guest object and point fixture,
  wrote the expected X/Y fields and set its dirty flags.
- A menu-return fixture rejected intermediate/pending returns and accepted
  the correctly completed native frame. This fixture does not execute menu init.

Label construction, attachment and rendering during full-game boot remain
browser tests. No full-Geode support is claimed.

## Rebuild

Activate Emscripten 6.0.5. Use the same pinned TulipHook and Result sources as
the previous `tulip-wasm` experiment, plus Geode JSON v4.0.1
(`489e7fd8c7561bb111d08fd2269ef74e4696afa4`) for its public header.

```sh
TULIP_SOURCE=/tmp/TulipHook RESULT_SOURCE=/tmp/geode-result JSON_SOURCE=/tmp/geode-json \
  bash experiments/geode-sdk/build.sh
node experiments/geode-sdk/verify-node.mjs /absolute/path/to/gd.wasm
```

To refresh the retained SDK files from the supplied source archive:

```sh
python experiments/geode-sdk/prepare-sdk.py /path/to/geode-6.0.0-alpha.1 experiments/geode-sdk/vendor
```

The engine retains its C++ runtime for SDK side-module dependencies. This makes
it larger than the first TulipHook-only demo. It still has no Geode Index client,
installer or general `.geode` package loader.
