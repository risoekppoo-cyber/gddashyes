# Deferred setup checkpoint - 7 November 2026

Setup executes 9,633 native instructions and 171 guest service calls across 23
distinct services. Chromium continued for 143 game frames. The game CPU was
preserved and its stack restored.

The pinned DLL uses allocator-owned live game memory, an isolated Windows-aligned
guest stack, a partial one-context TIB, static TLS template, owned heap and an
initialized CRT onexit table. Registered exit callbacks are retained. Complete
CRT startup and TLS callback execution remain unfinished.

Reached services now cover locks, module paths/errors, strings/memory, heap,
C-locale character classification, UTF-8, DOS paths, actual directory metadata,
current directory, onexit registration, empty condition-variable wakes, browser
modifiers and ceilf. The translator handles the reached floating-point, signed
shift and 128-bit operations. Unsupported behavior stops explicitly.

The game PE timestamp is 1792203143 (supported GD 2.2091). The normal Windows
bootstrap saves this before entering the main hook. Our direct hook now performs
this initialization at the pinned DLL RVA 0xfb22a8 from the real live PE header.
Missing it caused the misleading error that 2.2091 needed updating to 2.2091.
Neither the game PE header nor the version comparison is patched.

The next boundary is an unresolved function-pointer read:

    Instruction RVA: 0x12ecf4
    IAT slot RVA:    0xfaf1f0
    DLL:            libcocos2d.dll
    Export:         ?convertToNodeSpace@CCNode@cocos2d@@QEAA?AVCCPoint@2@AEBV32@@Z

It needs the actual loaded Cocos2d module/export address. Direct and indirect
unresolved import probes now stop before a null value can change a branch. A
provisional trace reached thread-naming RaiseException after an unresolved probe;
that is not the current verified continuation.

Generated C uses non-inlined functions for 256-byte native address ranges to
prevent V8 compiler memory exhaustion. Eight native-reference cases at two DLL
bases verify GPRs, XMMs, defined flags, stack, TLS, DLL writes, heap, onexit
registrations, primary header preservation and service order. Cases include
correct bootstrap initialization, its missing-initialization error branch,
SIMD and a negative signed shift.

[Reference and browser checks](https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42366669242)
passed. WASM, content-versioned service code, manifests and results publish only
after these checks pass. The launcher revision has been updated.

**Full Geode initialization and existing .geode packages remain unsupported.**
See [NEXT-CHAT-TASKS.md](NEXT-CHAT-TASKS.md) for the next small tasks.
