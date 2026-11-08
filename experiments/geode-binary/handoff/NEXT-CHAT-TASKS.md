# Latest verified browser mods — 8 November 2026

The normal page now has one **Mods ▾** dropdown (F2), containing Jukebox and
Click Sounds. Click Sounds uses all 20 unmodified original default WAV samples,
with separate press/release selection, volume, previews, toggles and saved settings.
It starts disabled. Enable in Mods → Click Sounds. Sounds play on accepted game
jump controls in both levels and menus. No native Geode execution is claimed.

Combined real Chromium run 42510043252 passes: keyboard/repeat isolation, mouse,
touch, virtual keys, silent UI typing, disabled/release controls, mobile layout and
persisted preferences. The full real-server Jukebox regression also passes through
the shared dropdown. Source commit: 30b555ec672a383615a9e02113e5ee87e1f63a96.
See mods/README.md, mods/clicksounds/result.json and mods/jukebox-result.json.

Do not reimplement these features or resume the native loader for them. Use this
current code and retained evidence. Next prompt setting: Medium.

---

# Verified server replacement — 8 November 2026

**Working and deployed on the normal game page.** The user now permits a simple UI.
Open Jukebox/F2, enter the level's song ID, find replacements, download/use, then
restart the level. Built-in audio files are also selectable. Preview and original
restoration are available. Current scope: zero-offset hosted entries, not YouTube.

Real Chromium run 42501689526 passes at code commit 70ed7acf42ff670939f6ab9a4713554900267074:
- Actual Song File Hub track: 3,214,411 bytes, 109.400816 seconds.
- Existing live game FMOD/Web Audio source switches from 30.040816 to 109.400816
  seconds; it uses the replacement AudioBuffer in a running audio context.
- Fetch/XHR byte hashes match the real downloaded MP3.
- Saved selections survive reload; original MP3 hash and both cached sounds restore.
- AppData originals cannot shadow active replacements at soundNew or the actual
  gd_js_audio_sound_data memory decode entry. Host bytes remain intact after decode.
- Mobile panel fits; keyboard close/open works; game continues to 215 frames.

Evidence: mods/jukebox-result.json and the passing workflow's screenshot artifact.
The UI adapts the browser game; it does not execute the native Geode package.
Do not resume the native loader to maintain this feature. A next useful user check
is to try the specific song/level they want. Next reasoning setting: Medium.

---

# Current priority — direct server song replacement

The latest user explicitly allows a simple browser UI. Original Geode/Jukebox UI
is no longer required for the immediate deliverable. Use mods/jukebox.js on the
normal game page: search the original Song File Hub hosted index, download actual
audio, save it in IndexedDB and inject /Resources/<song ID>.mp3. Built-in MP3
filenames are also offered in the target selector. Restart the level after changing
a song. Restoration preserves the original bytes and later external file changes.

Run integration-tests/jukebox-browser.cjs via Jukebox server song replacement CI.
It tests the real server MP3, game fetch/XHR routing, playback preview, persistence,
original restoration, both built-in/custom targets and continued game frames.
Entries requiring a nonzero startOffset are explicitly disabled in this first
version; zero-offset hosted songs are supported. No YouTube extraction is provided.

Do not resume native _Cnd_signal work to ship this feature. Keep the native loader
experiment and its truthful incomplete flags as a separate, retained research path.
Next prompt reasoning: Medium.

---

# Current continuation — 8 November 2026

Read PARENT-CONTINUATION.md first. The live thread-creation adapter is now
connected for the observed static-TLS component profile; the older notes below
describe prerequisites and earlier checkpoints.

Latest result: the parent resumed for 836 instructions and created four owned
worker contexts (IDs 2–5). It now stops at MSVCP140.dll!_Cnd_signal, RVA 0xa55870.
Native and sliced references and the real browser pass. Original game CPU/stack
preserved; 152 game frames, 17,438 total translated instructions.

Next: implement the required MSVC condition-variable notifications and resume
the SAME retained parent/handles/contexts from this new boundary. Do not replay
thread creation or re-adopt the existing parent. Full CRT/DLL thread callbacks,
full Geode loading and Jukebox UI execution remain unverified/false.

User requirement: original mod UI/functionality and real servers; no remade
menu. Original Jukebox package, compatible upstream build, archive extraction
and real server requests are already verified. Save usage by working only on
the new runtime blocker. Next prompt reasoning: High.

---

# Current continuation — 8 November 2026

## Thread batch now implemented — do not repeat its groundwork

Read ../mods/jukebox/CRITICAL-PATH.md. GuestScheduler.adoptContext and
GuestThreadLifecycle now implement retained parent adoption (including errno),
owned child/ID allocation, handle/poll/exit/join lifetime, and reuse of a worker
that has already advanced. Duplicate adoption and failed-thread polling stop
explicitly. Native UCRT evidence and focused regression tests are recorded.

The actual startup API adapter is still disabled. The next batch must wire
these helpers to the _beginthreadex stop, extend the independent parent native
reference, then compare parent/child state and execute the real browser. Do not
claim thread creation works in-game until that path passes. Do not restart the
existing child or replace the original Jukebox UI.


## Latest user requirement — original mods only

No remade menu or manual-import substitute. Keep the real upstream UI,
functionality and server interactions. Focus Jukebox first. Read
../mods/jukebox/README.md and its retained binary and evidence.

Completed: upstream source built for Geode 6 / GD 2.2091 with all 82 non-manifest
source/resource files unchanged; all 177 Geode imports resolve. Actual package
ZIP/Zstandard extraction passes independent byte checks in Node and Chromium.
Both original indexes and a complete hosted song work from a browser.

Still NOT working: original mod/UI execution and C++ web callbacks. Continue the
actual _beginthreadex lifecycle/parent-resumption task below, then mod discovery,
initialization, Cocos/FMOD hooks and async web delivery. Do not remake the menu,
extend empty worker polling, or repeat already passing server reachability tests.


## User scope update — four mods only

Read TARGET-MODS.md before the older general continuation below. The only mod
targets are Click Sounds Full, Jukebox, QOLMod and Globed, plus required
dependencies. First resolve the declared GD/Geode version mismatches and map
their actual hook/API requirements. Prefer the smallest working integration for
these sources; broad arbitrary-mod compatibility is out of scope. The saved
_beginthreadex task remains necessary if the selected integration uses native
loader execution. Do not spend further turns extending empty worker polling.


Use current main. Older local mirrors and Chat-mode ZIPs may be stale.

## Current verified state

- Parent: 12,223 instructions, stopped at _beginthreadex API entry.
- Real requested callback: entry RVA 0x4ffab0, original argument, ID 2 and owned
  CPU/stack/TIB/TLS. Four empty nonblocking completion polls execute.
- Native worker: 4,383 instructions with deterministic clock profiles.
- Browser worker: 4,379 instructions in the recorded run; 16,602 total.
- Three resumptions run at game frames 1, 2 and 3; the game continues to 142
  frames. Original game CPU, live stack and parent private storage are preserved.
- Slices execute at most 127 native instructions, retaining RIP and state.
  Compiler stack, child context and parent CPU clone retain valid ownership.
- The measured sequence ends runnable at poll-return RVA 0x4f165b. It is bounded,
  not a persistent background loop. No completion data is invented.

40 native-reference cases and 40 sliced counterparts pass at both DLL bases.
Six worker clock-profile cases and six sliced versions cover zero, about 17 ms
and 100 ms pauses. Seven slice-contract checks, 702 worker scheduler slices,
1,032 differential division cases and the real-browser check pass.

## Next immediate task — High reasoning

Implement the observed _beginthreadex lifecycle and resume the saved parent.
Additional empty worker polls are no longer the critical path.

1. Read current thread-boundary.mjs, guest-scheduler.mjs, setup-context.mjs,
   build-deferred.py and the retained-parent ownership model. Discover the UCRT
   initialization requirements for this exact call profile; distinguish
   independently verified requirements from unknown architectural state.
2. Create a small actual-Windows x64 UCRT oracle for security=null, stackSize=0,
   flags=0 and a real callback/argument. Record thread-ID output, callback
   identity, fresh thread errno/TLS, handle/exit/join/close behavior and relevant
   failure output rules. Use bounded subprocess execution and opaque handles.
   This isolated evidence-gathering task can be delegated to Chat mode at Medium.
3. Add lifecycle and ownership only for the verified profile. Adopt the saved
   parent CPU/stack/TIB without resetting its RIP, TLS, argument or private data.
   Preserve existing child state if it is reused; do not create duplicate
   callbacks or run static initialization twice. Retain compiler storage.
4. Differentially compare parent/child continuation and process memory at both
   bases. Advance native tracing to the next actual unsupported frontier.
   Validate the real browser between bounded host turns before publishing.

The current service-entry trap has not returned a handle or written the ID.
Full thread creation, UCRT initialization, exit/join and full-loader/package
support flags remain false. Do not turn them on just because a callback ran.
Keep unsupported failures explicit; do not infer free memory from zero bytes.

## Later, when observed

- Actual timed/blocking waits, port/pipe wakeup and packet delivery.
- Continue loader initialization, hooks, and actual mod loading.
- Full CRT startup, TLS callbacks and additional native state as required.

## Completed — do not repeat

- Resumable instruction export with explicit stop/budget/transfer outcomes.
- Same-CPU child continuation across browser turns, owned compiler lifetime,
  per-thread errors/IDs and shared process services.
- Named-pipe queues, stdio redirection and real completion-packet state.
- Windows-checked empty exception pointers, MSVC mutexes and nonblocking IOCP
  batches with operation status. Monotonic performance clock and unsigned DIV.
- Hash-verified pinned DLL cache with bounded official-download retries in CI.

Read DEFERRED-SETUP.md and RESUMABLE-SLICES.md for evidence and limits. Always
recommend the next prompt's reasoning setting when finishing.


