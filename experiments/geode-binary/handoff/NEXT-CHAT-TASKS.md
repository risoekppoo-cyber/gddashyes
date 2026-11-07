# Current continuation

Tasks 13-16 from the earlier source ZIP have been completed directly in this
repository. Do not repeat their old module lookup and thread-naming work.
The old ZIP is a historical snapshot; use current main for further changes.

Current verified checkpoint: 11,073 native startup instructions; eight reference
cases pass; Chromium continues beyond 120 frames. Full loader initialization and
existing .geode packages remain unsupported.

## Next implementation: asynchronous logging pipe

The exact stop is CreateNamedPipeW at Geode RVA 0x125ff1. Read pendingPipeRequest
in the current setup-browser-result.json or nextPipeRequest in setup-manifest.json
for the actual complete request. Source behavior is in upstream Geode
loader/src/platform/windows/console.cpp at v6.0.0-alpha.1.

1. Design an owned in-memory pipe namespace and endpoint/handle lifecycle for
   the observed inbound, overlapped, byte-stream, local-only request.
2. Implement and test server creation plus the paired client/reopen operation
   required by freopen_s. Preserve descriptor duplication: the saved old stdout
   must continue to reference its original channel.
3. Implement actual queued writes, reads, EOF/close behavior and the necessary
   asynchronous completion/consumer integration. Reject unsupported modes and
   operations explicitly. Do not return successful dummy handles or consume
   bytes without delivering them.
4. Extend the native service fixture independently, compare pipe/stdio state,
   rerun the existing reference and Chromium checks, and stop at the next
   unsupported dependency.

Relevant files:
- experiments/geode-binary/windows-stdio.mjs
- experiments/geode-binary/windows-console.mjs
- experiments/geode-binary/windows-files.mjs
- experiments/geode-binary/build-deferred.py
- experiments/geode-binary/setup-context.mjs
- integration-tests/bundle-services.mjs
- integration-tests/deferred-reference.mjs
- integration-tests/browser-smoke.cjs
- .github/workflows/geode-deferred.yml

Preserve allocator ownership, the game CPU snapshot/stack, unresolved import-read
stops, the real Cocos binding and rejection of arbitrary exceptions. Keep full
loader/package-support flags false. Report actual commands/results; use NOT_RUN
for unavailable execution. A mocked trace alone is insufficient validation.
