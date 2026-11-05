#!/usr/bin/env bash
set -euo pipefail
: "${TULIP_SOURCE:?Set TULIP_SOURCE}"
: "${RESULT_SOURCE:?Set RESULT_SOURCE}"
: "${JSON_SOURCE:?Set JSON_SOURCE to geode-sdk/json v4.0.1}"
test "$(git -C "$TULIP_SOURCE" rev-parse HEAD)" = 62ef839ee205d6943361c0902d08224acab32660
test "$(git -C "$RESULT_SOURCE" rev-parse HEAD)" = 0be6e01b892f54036127249f4f9e4007500c877b
test "$(git -C "$JSON_SOURCE" rev-parse HEAD)" = 489e7fd8c7561bb111d08fd2269ef74e4696afa4
here="$(cd -- "$(dirname -- "$0")" && pwd)"
if [[ -n "${GEODE_SOURCE:-}" ]]; then
 python "$here/prepare-sdk.py" "$GEODE_SOURCE" "$here/vendor"
fi
mkdir -p "$here/dist"
flags=(-std=c++23 -O2 -fexceptions -include "$here/../tulip-wasm/wasm-platform.hpp"
 -I"$TULIP_SOURCE/include" -I"$TULIP_SOURCE/include/tulip" -I"$TULIP_SOURCE/src" -I"$RESULT_SOURCE/include")
sources=("$TULIP_SOURCE/src/Handler.cpp" "$TULIP_SOURCE/src/Pool.cpp" "$TULIP_SOURCE/src/Main.cpp"
 "$TULIP_SOURCE/src/target/Target.cpp" "$TULIP_SOURCE/src/convention/DefaultConvention.cpp"
 "$TULIP_SOURCE/src/convention/CallingConvention.cpp" "$TULIP_SOURCE/src/Wrapper.cpp"
 "$TULIP_SOURCE/src/Misc.cpp" "$TULIP_SOURCE/src/generator/Generator.cpp")
em++ "${flags[@]}" "${sources[@]}" "$here/../tulip-wasm/target.cpp" "$here/engine.cpp" \
 -sMAIN_MODULE=1 -sMODULARIZE -sEXPORT_ES6 -sEXPORT_NAME=createSdkEngine \
 -sALLOW_MEMORY_GROWTH -sENVIRONMENT=web,node \
 -sEXPORTED_RUNTIME_METHODS='["ccall","FS"]' \
 -Wl,--export=ws_read_rax -Wl,--export=ws_write_rax -Wl,--export=ws_menu_completed -Wl,--export=ws_label_request \
 -Wl,--export=_ZN5tulip4hook17DefaultConvention6createEv \
 -o "$here/dist/engine.mjs"
em++ "${flags[@]}" -I"$here/vendor/include" -I"$here" -I"$JSON_SOURCE/include" \
 "$here/vendor/Hook.cpp" "$here/menu-mod.cpp" \
 -sSIDE_MODULE=2 -Wl,--export=geodeCustomEntry -Wl,--export=sdk_test_install -Wl,--export=sdk_test_toggle \
 -o "$here/dist/menu-mod.wasm"
sha256sum "$here/dist/engine.wasm" "$here/dist/menu-mod.wasm"
