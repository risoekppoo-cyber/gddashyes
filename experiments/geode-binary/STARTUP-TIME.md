# First Windows service in actual Geode startup

Implemented `GetSystemTimeAsFileTime` in `windows-time.mjs`: current UTC wall-clock time becomes a little-endian 64-bit FILETIME in guest memory. The native Win64 return address is restored and the stack advanced; RAX is preserved because the function returns void. Out-of-range pointers and clock values fail explicitly.

The adapter uses JavaScript's millisecond wall-clock resolution; it does not claim 100-nanosecond clock precision. Its output units are 100-nanosecond intervals since 1601-01-01 UTC, as specified by Microsoft:
https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/nf-sysinfoapi-getsystemtimeasfiletime

The focused contract test verifies the 1601 and 1970 epochs, tick units, write boundaries, pointer rejection and native return state.

The actual pinned Geode DLL is then relocated, its real entrypoint executed in Unicorn, and the reached instructions translated to C and WASM. The reference captures a real wall-clock timestamp; the WASM comparison replays that same timestamp so differing test times do not create false mismatches.

Verified result: **24 startup instructions**, one implemented time-service call, all 16 general registers and the complete 1 MiB native stack matching. The next unimplemented import is **KERNEL32.dll!GetCurrentThreadId**.

- [Verified report](dist/startup-time-service.json)
- [Successful test run](https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42179424930)
- [Repeatable workflow](../../.github/workflows/geode-startup.yml)

The workflow removes unused compiler module elements before applying the existing strict auxiliary-module validation. It does not weaken the game's memory-sharing checks. It runs without repository write permissions, verifies both the official release ZIP and extracted DLL hashes, and retains only the JSON report as an artifact.

TLS callbacks, full DLL initialization, complete Windows services, gameplay and existing mod packages remain unsupported. This is a controlled startup test, not a native Windows runtime or a full Geode loader.
