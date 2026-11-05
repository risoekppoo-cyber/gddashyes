#!/usr/bin/env python3
"""Prepare an explicitly limited Geode Hook SDK port from user-supplied source.

Hook.cpp and the public Hook class are retained. Platform implementation is new.
"""
from pathlib import Path
import argparse, difflib, shutil
p = argparse.ArgumentParser()
p.add_argument('source', type=Path)
p.add_argument('output', type=Path)
a = p.parse_args()
root = a.source / 'loader'
include = a.output / 'include/Geode'
for name in ['Prelude.hpp', 'DefaultInclude.hpp', 'loader/Hook.hpp', 'loader/Tulip.hpp']:
    dst = include / name
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(root / 'include/Geode' / name, dst)
hook = include / 'loader/Hook.hpp'
original = hook.read_text()
ported = original.replace('#include "../utils/general.hpp"', '#include <span>\n#include <cstdint>\n#include <vector>\nnamespace geode { using ByteSpan = std::span<uint8_t const>; using ByteVector = std::vector<uint8_t>; }')
assert ported != original
hook.write_text(ported)
(a.output / 'Hook.hpp.patch').write_text(''.join(difflib.unified_diff(original.splitlines(True), ported.splitlines(True), fromfile='upstream/Hook.hpp', tofile='wasm/Hook.hpp')))
platform = include / 'platform/platform.hpp'
platform.parent.mkdir(parents=True, exist_ok=True)
platform.write_text('''#pragma once
#define GEODE_IS_WASM
#define GEODE_PLATFORM_NAME "WebAssembly"
#define GEODE_DLL
#define GEODE_API extern "C" __attribute__((visibility("default")))
#define GEODE_EXPORT __attribute__((visibility("default")))
#define GEODE_NO_UNIQUE_ADDRESS [[no_unique_address]]
''')
shutil.copyfile(root / 'src/loader/Hook.cpp', a.output / 'Hook.cpp')
shutil.copyfile(a.source / 'LICENSE.txt', a.output / 'Geode-LICENSE.txt')
print('Prepared public Hook SDK subset; full Mod/Loader/$modify/Cocos SDK are not included.')
