# Live startup handoff — callback prologue only

Open this folder's `index.html`. It loads the existing game launcher, verifies three exact insertion points, and adds the opt-in handoff only to that page. The root game file is unchanged. Copy the report after the game reaches its menu. A successful handoff reports `LIVE_CALLBACK_PROLOGUE_PASS`, `originalGameCpuPreserved`, `liveStackRestored`, and increasing game frames. Browser/live-game confirmation is pending until observed or submitted by the user.

The pinned game maps native 0x00a74a90 to WASM function 10503, table slot 10972. The standalone loader's installed target 0x08674a90 is the relocated form of this address. Replacing the WASM function entry intercepts direct and table calls. Continuation entries are skipped. The original game wrapper remains responsible for normal execution after the observation.

The probe executes 14 original instructions at Geode callback 0x0212f200, ending BEFORE its first call at 0x0212f22d. It copies live GPRs into an isolated translator CPU shadow, converts flag offsets, uses the same guest memory/base and native stack, and reserves a separate compiler stack. The live CPU is unchanged and the touched native stack window is restored in finally. The module validator rejects start/data initialization, the compiled prologue hash is checked, and eight independent Unicorn contexts check GPRs, arithmetic flags and the complete affected stack window.

SLEIGH omits AF for the reached SUB RSP,0xf0. This component explicitly supplies that instruction's architectural AF computation and tests incoming AF=0/1. This does not establish general AF coverage in the existing translator.

This does not map or attach the complete Geode DLL into the live game. It does not execute the first call or initialize the deferred loader. Continuing requires reserving a compatible DLL/runtime layout in the game's guest space and binding actual dependencies. The current standalone TIB/TLS/helper regions overlap the primary game's actual image range; they cannot be copied into live memory. A zero-filled region is not evidence that it is safe to reserve.
