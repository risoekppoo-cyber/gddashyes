# MSVC x64 mutex service profile — 8 November 2026

The worker's observed _Mtx_lock now uses tracked ownership and the same guest SRW
registry as the other services. The supported types are 2 (ordinary) and 0x102
(recursive). Supported operations are in-situ initialization/destruction, lock,
try-lock, unlock and current-thread ownership queries. This is a bounded private
CRT ABI profile, not a claim about every MSVC version or every mutex type.

## Evidence

Microsoft's [mutex implementation](https://github.com/microsoft/STL/blob/e1ed302683e5e822f663fbb0f44cee7e9ddc6af0/stl/src/mutex.cpp)
and [thread structures](https://github.com/microsoft/STL/blob/e1ed302683e5e822f663fbb0f44cee7e9ddc6af0/stl/inc/__msvc_threads_core.hpp)
define the operations and storage. The
[real Windows oracle run](https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42428378210)
passed on an x64 runner using msvcp140.dll. Its guarded 80-byte objects verify:

| Field | Offset | Width |
| --- | ---: | ---: |
| Type | 0 | 4 |
| Unused former vptr | 8 | 8 |
| SRW word | 16 | 8 |
| Owner ID | 72 | 4 |
| Recursion count | 76 | 4 |

Idle owner is -1 and count is zero. Successful acquisition records the current
thread and count one; the uncontended SRW word is one. Same-thread repeated lock
and try-lock return busy (3) for type 2. The recursive profile increments the
count instead. A real second Windows thread receives busy from try-lock and does
not own or alter the mutex. Final unlock restores the idle owner/count/SRW state.
In-situ destruction preserves the object's bytes. Guard bytes stay unchanged.

The probe does not test blocking contention. It runs in a private subprocess
with a 20-second timeout. The actual result is committed as
integration-tests/msvc-mutex-native-result.json, alongside the reproducible probe.

## Guest implementation and boundary

The service can adopt the verified pristine layout produced by an inline
constructor. It preserves padding, validates tracked fields and shares the
physical SRW address with the kernel service registry. Wrong-owner unlock,
unsupported types/layouts, corrupted state and recursion overflow fail explicitly.
The profile accepts positive guest thread IDs through INT32_MAX.

A busy try-lock returns busy. A lock owned by another thread stops with a
scheduler-blocking requirement; it does not fabricate successful acquisition.
Normal heap free rejects a containing allocation with an owned mutex. Process
disposal drops the emulated ownership bookkeeping while independently attempting
all normal heap cleanup.

Focused tests compare all 80 bytes against the Windows snapshots, including
ordinary/recursive behavior, thread selection, inline initialization and guards.
Independent native worker comparisons check mutex state and complete heap writes.
Full CRT thread startup, parent continuation and Geode package loading remain
unfinished.
