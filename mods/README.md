# Browser Jukebox

Open the game and click **Jukebox** (or press **F2**). Enter the song ID shown on
the level, click **Find replacements**, then **Download & use**. Restart the level.
The usual target replaces `<song ID>.mp3`; the selector also offers built-in game
MP3 filenames. **Preview** plays the saved replacement. **Restore original** removes
the saved override and restores the original game file. Restart the level again.

Songs and the server index are cached in this browser using IndexedDB. Downloads
come from the hosted URLs in Jukebox’s public Song File Hub index. This feature does
not execute the native Geode package. The first version supports zero-offset hosted
entries; entries needing timing offsets are labelled and disabled. YouTube-only
entries are not downloadable here.

Validation: `.github/workflows/jukebox-browser.yml` runs the actual game in Chromium
with a real index and MP3, without mocked server responses or placeholder audio.
