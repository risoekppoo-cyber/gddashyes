#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${GEODE_DLL:?Set GEODE_DLL to the hash-pinned official Geode.dll}"
GEODE_OUT="${GEODE_OUT:-$(mktemp -d)}"
GEODE_ZIG="${GEODE_ZIG:-$(python -c 'import ziglang;from pathlib import Path;print(Path(ziglang.__file__).parent/"zig")')}"
GEODE_WASM_OPT="${GEODE_WASM_OPT:-wasm-opt}"
export GEODE_OUT
mkdir -p "$GEODE_OUT"
compile() {
 local input="$1" output="$2" mode="$3"
 local extra=()
 if [[ "$mode" == wide ]];then extra+=('-Wl,--export=__stack_pointer');fi
 "$GEODE_ZIG" cc -target wasm32-freestanding -O2 -g0 -s -nostdlib "$input" -Wl,--no-entry -Wl,--import-memory -Wl,--export=lift_run "${extra[@]}" -Wl,-z,stack-size=0 -Wl,--initial-memory=131072 -o "$output"
 "$GEODE_WASM_OPT" "$output" --remove-unused-module-elements -o "$output.clean"
 mv "$output.clean" "$output"
}
node experiments/geode-binary/verify-windows-time.mjs
node experiments/geode-binary/verify-windows-threads.mjs
node experiments/geode-binary/verify-windows-startup.mjs
node experiments/geode-binary/verify-native-initializers.mjs
node experiments/geode-binary/verify-synchronization.mjs
python experiments/geode-binary/startup-smoke.py "$GEODE_DLL" "$GEODE_OUT" > "$GEODE_OUT/report.json"
python -c 'import json,sys;d=json.load(open(sys.argv[1]));assert d["firstTranslationBlocker"] is None,d;assert not d["unmodeledTibReads"],d' "$GEODE_OUT/report.json"
compile "$GEODE_OUT/startup.c" "$GEODE_OUT/startup.wasm" wide
node experiments/geode-binary/verify-startup.mjs "$GEODE_OUT" "$GEODE_OUT/report.json"
python experiments/geode-binary/verify-alu.py "$GEODE_OUT"
compile "$GEODE_OUT/alu.c" "$GEODE_OUT/alu.wasm" wide
node experiments/geode-binary/verify-alu.mjs "$GEODE_OUT"
python experiments/geode-binary/lift.py "$GEODE_DLL" --out "$GEODE_OUT/scalar"
compile "$GEODE_OUT/scalar/lifted.c" "$GEODE_OUT/scalar/lifted.wasm" scalar
node --input-type=module - <<'JS'
import {readFile} from 'node:fs/promises';
import {verifyVectors} from './experiments/geode-binary/verify.mjs';
const dir=process.env.GEODE_OUT+'/scalar/';
const result=await verifyVectors(await readFile(dir+'lifted.wasm'),JSON.parse(await readFile(dir+'manifest.json')),JSON.parse(await readFile('experiments/geode-binary/dist/reference.json')));
console.log('PASS:',result.referenceCases,'original scalar native-reference cases');
JS
