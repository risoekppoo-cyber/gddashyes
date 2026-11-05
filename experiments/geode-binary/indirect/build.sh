#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
: "${GEODE_DLL:?Set GEODE_DLL to the pinned official DLL}"
: "${LLVM_BIN:?Set LLVM_BIN to the Emsdk upstream/bin directory}"
"$LLVM_BIN/clang" --target=x86_64-pc-windows-msvc -O1 -Xclang -cfguard -c native.c -o native.obj
"$LLVM_BIN/lld" -flavor link /dll /noentry /nodefaultlib /machine:x64 /base:0x1000000 /out:fixture.dll /implib:native.lib native.obj
python generate.py "$GEODE_DLL"
for name in fixture geode; do
 "$LLVM_BIN/clang" --target=wasm32 -O2 -nostdlib "$name.c" -Wl,--no-entry -Wl,--import-memory -Wl,--export=lift_run -Wl,-z,stack-size=0 -Wl,--initial-memory=131072 -Wl,--max-memory=4294967296 -o "$name.wasm"
 chmod 644 "$name.wasm" fixture.dll
done
rm native.obj native.lib
node verify-node.mjs
