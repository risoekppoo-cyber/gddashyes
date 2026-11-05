#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
: "${GEODE_DLL:?Set GEODE_DLL to the official v6.0.0-alpha.1 Windows Geode.dll}"
: "${WASM_CLANG:?Set WASM_CLANG to an LLVM clang with wasm32 support}"
python lift.py "$GEODE_DLL" --out dist
"$WASM_CLANG" --target=wasm32 -O2 -nostdlib dist/lifted.c -Wl,--no-entry -Wl,--import-memory -Wl,--export=lift_run -Wl,-z,stack-size=0 -Wl,--initial-memory=131072 -Wl,--max-memory=4294967296 -o dist/lifted.wasm
python reference.py "$GEODE_DLL" --dist dist
python lift.py "$GEODE_DLL" --out dist/startup-probe --startup-probe --limit 512
node verify-node.mjs "${GD_WASM:?Set GD_WASM to the pinned game wasm}"
node verify-pe.mjs "$GEODE_DLL"
