# Supported mod targets — 8 November 2026

User scope: these four mods and their required dependencies. Arbitrary .geode
package compatibility is not a goal. Preserve the verified game/worker baseline.

| Target | Inspected source commit | Declared Geode / Windows GD |
| --- | --- | --- |
| Click Sounds Full | 3b5389b37c6c1e0db90ed57099fd36910bbdd015 | 5.11.2 / 2.2081 |
| Jukebox (fleym.nongd) | abb0b3c9f87336acb594278de5b25525d9177dcf | 5.11.2 / 2.2091 |
| QOLMod (GeodeMenu) | 06f89b45a80427b5d2b07dee43c06d759375129a | 6.0.0-alpha.1 / 2.2091 |
| Globed | 737d2211b6ce00119f752dc07d0d76d2700b6d08 | template: 5.11.0 / 2.2081 |

These are repository-main declarations, not verification of the uploaded binary
versions. The game is pinned to GD 2.2091 and Geode 6.0.0-alpha.1. Inspect matching
release/branch history or adapt and rebuild selected source before attempting
loading. Do not bypass version checks and call the result compatible.

## Latest clarification — original UI and behavior

Focus Jukebox first. The user rejected a remade browser menu and substitute
features. Preserve the original upstream UI, workflows and server requests;
add required platform support rather than replacing the mod. Read
../mods/jukebox/README.md for verified builds, network tests and remaining
runtime blockers. The four-mod acceptance list below defines eventual scope.

## Acceptance

1. Click Sounds Full: actual gameplay press/release events and selected sound
   packs/settings; exercise keyboard and pointer controls. Its manifest requires
   geode.node-ids >=1.23.0; Happy Textures is optional, not a required target.
2. Jukebox: song selection/replacement, retained imported audio and configured
   index downloads. Verify actual level playback and persistence across reloads.
3. QOLMod: enumerate the chosen version's feature set, hooks and dependencies;
   validate features individually and interaction with the first two mods.
   Its README advertises over 70 features; showing its menu is not completion.
4. Globed: actual authenticated server connection, another player in a shared
   level, room/state synchronization and the other requested shipped features.
   A local menu or simulated second player is not completion. Voice and other
   unfinished features must be identified explicitly, not silently omitted.

All four must operate together on the pinned browser game. Source adaptations
are permitted by this targeted plan, but do not substitute superficial UI or a
different feature set and claim the original mods work.

## Minimize unnecessary compatibility work

Map each selected mod's actual hooks, native imports, settings/resources,
filesystem/audio/network needs and required transitive dependencies. Implement
that dependency closure; defer unrelated Windows services and arbitrary-mod
coverage. Evaluate the existing bridge and source adaptation before committing
to broad native-binary emulation. Keep honest per-feature completion evidence.

Globed's NetworkManagerImpl.cpp already selects a WebSocket ConnectionType, in
addition to TCP/UDP/QUIC; cmake/DownloadNetLibs.cmake links native network
libraries. Verify that WebSocket route and real server compatibility before
designing an additional network gateway. An enum option alone does not prove
a working browser transport or compatibility with every deployed server.

## Sources

- https://github.com/clicksounds/geode-clicksound/tree/3b5389b37c6c1e0db90ed57099fd36910bbdd015
- https://github.com/Fleeym/jukebox/tree/abb0b3c9f87336acb594278de5b25525d9177dcf
- https://github.com/TheSillyDoggo/GeodeMenu/tree/06f89b45a80427b5d2b07dee43c06d759375129a
- https://github.com/GlobedGD/globed2/tree/737d2211b6ce00119f752dc07d0d76d2700b6d08

Read mod.json (Globed: mod.json.template), CMakeLists.txt and README.md at these
pins. Click Sounds hooks PlayerObject::pushButton/releaseButton in src/main.cpp.
Jukebox source is under jukebox/, not src/. Globed networking is under
src/core/net/. Preserve source licenses and attribution for adaptations.

The earlier prompt-count ranges were unmeasured planning guesses. Do not turn
them into a delivery promise. Narrow scope reduces unrelated compatibility
work, but does not remove shared loader/game-hook requirements or Globed's
network/audio work.
