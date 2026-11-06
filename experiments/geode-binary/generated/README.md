# Actual Geode-generated patch and trampoline

Run `index.html` through HTTP in Edge/Chrome, click **Run check**, then copy the report. The test uses roughly 352 MB of virtual address space and small downloaded fixtures. It does not start the game or load the Geode mod manager.

The pinned official Geode DLL's native process attachment emits this actual 32-byte original-call trampoline at 0x15000000:

`48895c2408488974241048897c2418ff25000000009f4a670800000000909090`

It patches the primary image at 0x08674a90 with `ff250000000000f212020000000090`, targeting Geode's deferred callback at 0x0212f200. The trampoline preserves the three original stack saves and jumps back to 0x08674a9f. These are observed bytes from the actual DLL, not a synthetic hook fixture.

`build-generated-check.py` extracts the original, patched and trampoline bytes from a completed native startup run, translates their instruction semantics, and builds 24 independent Unicorn CPU/stack references. `build.sh` compiles the three translations. The browser router selects a translation by the complete current code bytes, handles patch restoration, and rejects unknown versions. Each translated instruction also checks its current bytes before execution, rejecting a stale selected translation.

This is a bounded routing component. It does not execute the deferred Geode callback, integrate these translations into the live game's dispatcher, support arbitrary changed instructions or load `.geode` packages. The startup and component checks are separate proofs.
