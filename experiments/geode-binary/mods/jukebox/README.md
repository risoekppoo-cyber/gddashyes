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

# Original Jukebox integration — 8 November 2026

The target is the upstream mod, including its existing Cocos UI, settings,
server/index requests, song selection and playback offsets. A replacement HTML
menu or manually implemented approximation is not an acceptable completion.

The substitute browser menu and its launcher injection were removed at
8ab7c438e6bc9afde3208ada7afa818aebb68fa2. Stored browser data was not deleted.

## Verified and retained

- fleym.nongd.geode is a Windows build from upstream source commit
  abb0b3c9f87336acb594278de5b25525d9177dcf.
- All 82 tracked non-manifest files, including C++ and resources, are unchanged.
  Only mod.json's Geode SDK build target changed to 6.0.0-alpha.1. Win64 codegen
  used the 2.2091 bindings. source-build-receipt.json records every source hash.
- Retained package SHA-256:
  9c27d8049b79dde70345b8444ea857d0fc1d34e4994266b475daa1bba632f66c.
  Git blob SHA: 71070bc3c7085c4926befabd8046033a7f6405c9.
- All 177 Geode imports are exported by the pinned official Geode.dll. The
  package also imports 190 Cocos, four FMOD and 160 Windows/CRT symbols; complete
  names are in native-preflight.json. Export presence is not execution support.
- The official released package targets Geode 5.10.1 / GD 2.2081 and has 21
  missing Geode imports against our loader. It cannot simply be forced to load.
- The official ZIP uses methods 8 and 93 (Deflate and Zstandard). The new
  geode-package.mjs reader handles actual package contents without rewriting
  them. All 16 original members match independent Python zipfile/zstandard
  SHA-256 results in both Node and Chromium. CRC, truncation and bounds checks
  pass. The retained rebuilt package's 12 Deflate entries also match Python.
- Both original configured indexes are reachable from a browser without a
  network proxy. Song File Hub returned 36,715 hosted entries in the recorded
  run. One original hosted song downloaded in full (3,214,411 bytes) and decoded
  into 109.4 seconds of stereo audio at 44.1 kHz. No audio was redistributed.
- Neither raw index exposed ETag/Last-Modified to browser JavaScript in the
  recorded run. The original optional-header logic can fetch fresh and use its
  file cache; this observation does not justify inventing 304 responses.

The Windows build and network tests passed in run 42486119548. Package parity,
network and a second native build passed in run 42486806088. Result JSON is
stored here. The source and fzstd MIT licenses are retained.

## Existing UI and activation path

main.cpp registers the custom indexes setting in $execute. On Mod Loaded it
initializes IndexManager and NongManager. These require real mod ownership,
settings/saved values, an asynchronous task runtime, event listeners, a writable
save directory, Geode web requests and main-thread callback delivery.

CustomSongWidget is modified to add the original disc icon above the song name.
Clicking it calls NongDropdownLayer::create, not a global browser Mods menu.
The upstream popup is 420 by 280 Cocos units, using GJ_square01.png, the original
JB_ListLogo.png title, corner sprites, selectable song rows and download/progress,
add, delete and settings controls. NongList/NongCellUI build those controls.
The old-label setting retains the original alternative song-label entry point.

MusicDownloadManager::pathForSong returns the active NONG's actual saved path.
The FMODAudioEngine hooks add its startOffset to queueStartMusic and seek time.
The integration must preserve this path and timing behavior, original-song
fallback, song-ID grouping, verification and metadata updates.

## Original requests

Source: mod.json, managers/index_manager.cpp and download/hosted.cpp at the pin.

- https://raw.githubusercontent.com/FlafyDev/auto-nong-indexes/v2/auto-nong-index.min.json
- https://raw.githubusercontent.com/FlafyDev/auto-nong-indexes/v2/sfh-index.min.json

IndexManager fetches manifest-1 JSON, supplies the source URL, reads hosted song
metadata, caches successful indexes and optionally uses conditional headers.
Hosted downloads use each index entry's URL and publish progress/completion
events. The successful sampled host was api.songfilehub.com.

YouTube index loading is commented out in upstream IndexManager. The Auto Nong
index's 370 YouTube entries therefore are not proof of supported downloads.
Do not enable that path or replace the configured servers while claiming to
preserve the original behavior. Both reviewed revisions also request the int
request-timeout setting as bool; leave this recorded upstream quirk unchanged
until its actual runtime effect is tested.

## Still blocked — not a working in-game mod yet

The browser probe does not execute Geode's C++ WebRequest/Arc callbacks. The
build does not execute the original popup. Both facts remain false in evidence.
The native Geode startup still stops at _beginthreadex. Required next steps:

1. Finish verified thread creation and parent continuation without restarting
   retained contexts or making up a successful handle/ID.
2. Reach actual loader mod discovery, initialization and resource registration.
3. Bind the required Cocos/FMOD calls and install the original $modify hooks.
   Current guest-call allowlists cover a tiny subset, not all 194 game imports.
4. Route the original Geode web/async API to verified browser transport and
   deliver its results/events back to the real mod on the main thread.
5. Exercise the actual popup, index list, download, selection, offset, reload
   and return-to-original behavior on a real level before claiming completion.

A native DLL remains native code; extracting it or resolving symbol names is
not enough to execute it in WebAssembly. There is no fake connected/success
state and no substitute menu. Preserve the working game's CPU/stack and the
existing verified loader experiment throughout.

Upstream: https://github.com/Fleeym/jukebox/tree/abb0b3c9f87336acb594278de5b25525d9177dcf
