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
