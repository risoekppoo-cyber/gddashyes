# Indirect-call binary translation test

This is a stronger follow-up to the five-function Geode DLL canary. It tests a cross-module indirect-call and callback sequence using **real x64 machine instructions**, independently executed in Unicorn and translated through SLEIGH p-code → generated C → WebAssembly.

## Tested call sequence

1. The native Win64 fixture's `entry` receives a constructed Hook pointer and the address of the official Geode `Hook::getAddress` function.
2. Its compiler-generated CFG call loads Geode's actual default guard-dispatch thunk at `0x180a527b0`. The thunk's original `JMP RAX` enters Geode's getter.
3. The getter reads the callback address from the constructed Hook/Impl object and returns to the fixture.
4. Another compiler-generated indirect call uses the same Geode thunk to enter the fixture callback.
5. The callback reads test data and computes XOR; the caller adds seven and returns normally.

The host router resolves only the explicitly translated instruction addresses, yields between two WASM modules and keeps the same native CPU, stack and objects. No C++ objects cross into a separate Emscripten C++ object representation.

## Results

64 cases, including 64-bit overflow inputs, each execute 21 native instructions with four transfers between translated modules. For each case, the WASM result matches the original DLL instruction execution in Unicorn 2.1.4 for:

- All 16 general-purpose registers and the final return PC.
- CF, PF, ZF, SF and OF flags.
- 256 stack bytes, including the original return address, saved register and nested call return addresses.
- The computed callback result.

An unregistered indirect target (`0xdeadbeef`) is rejected rather than treated as a successful call. `result.json` records the local Node run. The browser page executes the same test independently.

## Limits

This exercises the indirect-call instruction pattern that blocked the earlier static startup probe. It **does not execute Geode's CRT entrypoint** or establish complete target discovery. The test supplies a constructed Hook/Impl object, as before.

The compiler emits CFG-style calls; this test uses the original Geode thunk's default implementation. **Windows CFG security policy is not implemented or tested.** No Windows services, TLS callbacks, DLL constructors, exceptions or downloaded `.geode` packages are executed. The fixture is a no-entrypoint test DLL, not an existing third-party mod.

The actual Windows Geode DLL remains pinned to SHA-256 `ccedc2f1c86baf342f6720b9685991ca31fba246453efe2a1daf609dc40b6499`. The fixture's hash, translated instruction sets, opcode counts, initial PE image and independent reference cases are recorded in `reference.json`. The original Geode DLL is not included.

## Reproduce

With the parent directory's Python requirements installed, the official pinned `Geode.dll` available, and Emsdk 6.0.5 installed:

```bash
export GEODE_DLL=/path/to/official/Geode.dll
export LLVM_BIN=/path/to/emsdk/upstream/bin
bash experiments/geode-binary/indirect/build.sh
```

`native.c` is compiled to the Windows `fixture.dll` using clang's `x86_64-pc-windows-msvc` target, `-Xclang -cfguard`, and LLVM's PE linker. `generate.py` lifts instructions from that DLL and the official Geode DLL and writes the independent reference. The generated `fixture.c` and `geode.c` are then compiled to separate WASM modules. The initial fixture base is fixed; rebasing indirect-call return addresses is not tested here.
