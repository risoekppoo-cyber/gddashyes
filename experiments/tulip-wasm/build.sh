#!/usr/bin/env bash
set -euo pipefail
# Activate Emscripten 6.0.5 first. Source checkouts are deliberately external.
: "${TULIP_SOURCE:?Set TULIP_SOURCE to TulipHook 62ef839ee205d6943361c0902d08224acab32660}"
: "${RESULT_SOURCE:?Set RESULT_SOURCE to geode-sdk/result 0be6e01b892f54036127249f4f9e4007500c877b}"
test "$(git -C "$TULIP_SOURCE" rev-parse HEAD)" = 62ef839ee205d6943361c0902d08224acab32660
test "$(git -C "$RESULT_SOURCE" rev-parse HEAD)" = 0be6e01b892f54036127249f4f9e4007500c877b
git -C "$TULIP_SOURCE" diff --exit-code --quiet
git -C "$RESULT_SOURCE" diff --exit-code --quiet
here="$(cd -- "$(dirname -- "$0")" && pwd)"
out="$here/dist"
mkdir -p "$out"
flags=(-std=c++20 -O2 -fexceptions -include "$here/wasm-platform.hpp"
    -I"$TULIP_SOURCE/include" -I"$TULIP_SOURCE/include/tulip"
    -I"$TULIP_SOURCE/src" -I"$RESULT_SOURCE/include")
sources=("$TULIP_SOURCE/src/Handler.cpp" "$TULIP_SOURCE/src/Pool.cpp"
    "$TULIP_SOURCE/src/Main.cpp" "$TULIP_SOURCE/src/target/Target.cpp"
    "$TULIP_SOURCE/src/convention/DefaultConvention.cpp"
    "$TULIP_SOURCE/src/convention/CallingConvention.cpp")
em++ "${flags[@]}" "${sources[@]}" "$here/target.cpp" "$here/engine.cpp" \
    -sMAIN_MODULE=2 -sMODULARIZE -sEXPORT_ES6 -sEXPORT_NAME=createTulipEngine \
    -sALLOW_MEMORY_GROWTH -sENVIRONMENT=web,node \
    -sEXPORTED_RUNTIME_METHODS='["ccall","FS"]' \
    -o "$out/engine.mjs"
em++ -std=c++20 -O2 -fexceptions -sSIDE_MODULE=2 \
    -Wl,--export=wm_mod_install -Wl,--export=wm_mod_control \
    "$here/test-mod.cpp" -o "$out/test-mod.wasm"
sha256sum "$out/engine.wasm" "$out/test-mod.wasm"
