# Browser mods

Open the game and click **Mods ▾**, or press **F2**. Choose **Jukebox** or
**Click Sounds**. Escape closes the open tool or dropdown. Opening one tool closes
the other. Both panels fit narrow screens.

## Jukebox

Enter the song ID shown on the level, find a replacement, then **Download & use**.
Restart the level for the correct start position. The target selector also offers
built-in game MP3 files. Preview and original restoration are available. Songs and
the Song File Hub index are saved in IndexedDB. This version supports hosted songs
with zero timing offset; entries needing an offset are labelled and disabled.

The adapter updates existing game audio buffers and overrides both URL-based and
guest-memory-based FMOD decoding. Downloaded original files cannot shadow an active
selection. It does not execute the native Geode package.

## Click Sounds

Enable **Click Sounds** in its panel. Select separate press/release samples or use
random selection from the original default pack. Volume, release toggle and both
previews are available. Settings are saved in this browser. Sounds start disabled.

The adapter observes the game's accepted input queue for Space, Up, W, mouse/touch
and virtual keyboard inputs. UI typing and key repeats do not create extra sounds.
It plays on game jump controls in both levels and menus. It does not reproduce the
native mod's complete sound-pack catalog or execute its Geode binary.

Twenty original unmodified default WAV samples, source revision, credits, hashes
and upstream MIT license are retained under clicksounds/.

## Validation

The browser workflow runs the real game in Chromium. Jukebox uses a real Song File
Hub index and MP3, checks live game playback, persistence, both decoding paths and
restoration. Click Sounds checks actual decoded sample playback, volume, repeated
keys, mouse, touch, virtual keys, UI input isolation, disabling, mobile layout and
persisted preferences. See integration-tests/*-browser.cjs.
