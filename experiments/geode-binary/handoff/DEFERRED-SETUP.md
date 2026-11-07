# Verified startup checkpoint - 7 November 2026

The current setup executes 11,073 native instructions. Native-reference and real
Chromium checks pass; the game continues for at least 120 frames, with the
original CPU snapshot preserved and the live stack restored. Full Geode
initialization and existing .geode package loading remain unsupported.

## Completed continuation

- Located the actual Cocos2d image at guest base 0x10000000. Its identity and
  mapping are corroborated by 856 primary-game import references.
- Resolved convertToNodeSpace to RVA 0x2e90, guest address 0x10002e90. The live
  module, export and captured code page are validated before binding. Native
  reference tests use the same captured bytes; other unresolved probes stop.
- Delivered the documented MSVC thread-name event (0x406d1388) to a bounded guest
  debugger. The observed thread is 1, named Main. A real Windows exception probe
  verifies continuation after handling this exact event. Other exceptions,
  noncontinuable events and foreign thread identities remain rejected.
- Added detached-console query/attach semantics. Windows standard handles are
  absent in this browser profile; failures report proper errors and do not claim
  console output succeeded.
- Added owned opaque FILE identities, standard descriptors, duplication,
  fdopen/get_osfhandle/close and logical process identity. Duplicate descriptors
  own distinct handles to the same channel. Native Windows probes and unit tests
  check the identity/ownership rules. This does not claim a full UCRT FILE layout
  or working redirected output.

The primary game timestamp bootstrap, static TLS template, partial TIB, onexit
registration and allocator-owned DLL/stack/heap remain in place. Full CRT startup,
TLS callbacks and general native threading are still unfinished. Binding the
Cocos export for address inspection does not implement arbitrary native Cocos
method execution.

## Next exact boundary

    KERNEL32.dll!CreateNamedPipeW
    Geode instruction RVA: 0x125ff1

The native fixture and real browser agree on the complete request:

    path:            \\.\pipe\geode-stdout-1
    openMode:        0x40000001 (inbound, overlapped)
    pipeMode:        0x8 (local clients only)
    maxInstances:    1
    outBufferSize:   0
    inBufferSize:    1024
    defaultTimeout:  0
    security:        null

The report exposes pendingPipeRequest, guestThreadNames, boundGameImports and
guestStdioDescriptors. This operation is not implemented. The next phase needs
real queued pipe endpoints, CRT reopen ownership and asynchronous completion/
consumer behavior; returning a dummy successful handle would invalidate startup.

## Validation

[Native reference and Chromium validation](https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42389806053)
passes eight cases at two Geode image bases. It checks registers, XMMs, defined
flags, stack, TLS, DLL/heap writes, callback registration, thread-name delivery,
stdio object/descriptor ownership and unchanged captured Cocos code.

The ordinary handoff regression checks also pass. The workflow publishes
generated code and evidence only after reference and actual-browser checks pass.
The launcher uses the setup-stdio-20261107 revision.

Tasks 13-16 from the earlier Chat-mode pack have been completed directly. See
NEXT-CHAT-TASKS.md for the current remaining scope. The older ZIP records the
previous checkpoint and should not be used to restart those completed tasks.
