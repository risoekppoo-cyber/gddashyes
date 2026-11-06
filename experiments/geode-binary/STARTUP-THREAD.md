# Guest thread identity in Geode startup

Implemented `GetCurrentThreadId` using a registry of guest execution contexts. IDs are stable, nonzero DWORDs, unique within the guest runtime while registered; retired contexts cannot be queried. The Win64 adapter zero-extends the result into RAX, restores the native return address, and advances RSP.

The current DLL startup probe has one registered main context. It does not create native threads, run workers, implement synchronization, or supply TLS. These are guest identities, not operating-system IDs from the machine hosting the browser.

The focused test checks stable and distinct IDs, retirement, DWORD return behavior, caller-register preservation and stack bounds. The actual pinned Geode DLL then runs through the time and thread-ID imports: **27 native instructions** translated to WASM, all 16 general registers and the full 1 MiB stack matching the x64 reference model.

The next unimplemented import is `KERNEL32.dll!GetCurrentProcessId`. Full DLL initialization and existing mod packages remain unsupported.

- [Verified report](dist/startup-thread-service.json)
- [Successful run](https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42180134376)
- [Microsoft API contract](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getcurrentthreadid)

Repeat the read-only `Geode DLL startup service test` workflow to reproduce the test.
