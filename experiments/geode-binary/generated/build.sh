#!/usr/bin/env bash
set -euo pipefail
out="${GEODE_GENERATED_OUT:-$(dirname "$0")}"
zig="${GEODE_ZIG:-$(python -c 'import ziglang;from pathlib import Path;print(Path(ziglang.__file__).parent/"zig")')}"
for variant in original patched trampoline; do
 "$zig" cc -target wasm32-freestanding -O2 -ffp-contract=off -g0 -s -nostdlib "$out/$variant.c" -Wl,--no-entry -Wl,--import-memory -Wl,--export=lift_run -Wl,--export=__stack_pointer -Wl,-z,stack-size=0 -Wl,--initial-memory=131072 -o "$out/$variant.wasm"
done
