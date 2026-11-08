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

# Original Jukebox: current critical path

Read ../../handoff/PARENT-CONTINUATION.md for the verified state and next batch.
Parent/thread integration now works for the observed component profile, and
the next measured blocker is MSVCP140.dll!_Cnd_signal. Resume existing state;
do not rebuild thread foundations or replace the original mod UI.

The previous critical-path planning notes follow for context.

---

# Original Jukebox: critical-path work

The next deliverable is a parent loader that actually continues after its
thread-creation call, followed by original Jukebox initialization. Do not replace
the mod UI, repeat native probes, or increase the idle-worker poll count.

Already done:
- Original source/resources build against Geode 6/GD 2.2091; 177 matching exports.
- Original package extraction, real indexes and hosted audio requests verified.
- Actual Windows UCRT ID/errno/TLS/pending/exit/closed-handle evidence recorded.
- GuestScheduler.adoptContext retains an existing parent's CPU/TIB/stack without
  writes and without taking ownership of its allocations.
- GuestThreadLifecycle supports owned child creation, actual ID-output writes,
  pending/exit polling, handle closure without killing the child, joiner wakeup,
  and registering an existing advanced child without restarting CPU or TLS.
- Focused checks compare the lifecycle with the saved native oracle. The live
  startup service adapter is NOT enabled; full CRT/DLL notifications remain
  unverified. These helpers alone do not mean _beginthreadex now works in-game.

## Next implementation batch — High

1. Use the retained parent CPU and advanced worker rather than creating another
   diagnostic callback. Attach the lifecycle at an idle scheduler boundary;
   never call start while GuestScheduler.runRound is active. Validate the real
   root stack, _beginthreadex arguments, ID-output pointer and return frame
   before committing observable results.
2. Extend the independent native component model through the matching return
   and parent continuation. Keep the static-TLS model explicit and investigate
   needed UCRT/DLL thread notifications. Do not report full CRT support early.
3. Compare parent/child memory, private state and service ordering at both image
   bases, then run the real browser. Publish the measured new frontier.
4. Group the next missing calls by shared subsystem and add the smallest
   required batch. Use native-preflight.json's real dependency list, not guesses.

## Efficiency rules

- One end-to-end route: native package -> actual Geode Mod Loaded -> original
  song-widget popup -> original index -> real download -> active path/offset.
- Test close to each edit; run the complete regression once the batch is ready.
- Keep the known-good DLL, rebuilt mod, caches and recorded evidence. Rebuild
  unchanged upstream source only if its inputs change or a new ABI concern arises.
- Use real API/ABI diagnostics and checks to generate the next work list.
- Do not build a browser menu, fake connection, success-return stub or parallel
  source rewrite to make a milestone appear complete.

Validation: native/reference and actual-browser regression passed in run
42490087686 after the complete batch. This does not enable the live API adapter.

