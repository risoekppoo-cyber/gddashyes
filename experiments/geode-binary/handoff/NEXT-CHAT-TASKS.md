# Small Chat-mode tasks: run one at a time

Verified repository: risoekppoo-cyber/gddashyes at
0318367d08fd09712fe45c6c861478701c100394.

Read ONE task, attach only its listed files, and paste its prompt. Return its
result and changed files for review before the dependent task. If access or an
input is missing, name it and stop. Never invent test outputs; use NOT_RUN.
The source pack preserves repository paths; its reports are in evidence/.

Current checkpoint: 9,633 native instructions and 143 game frames. Full loader
and existing mod packages are unsupported.

Next dependency:

    Instruction RVA 0x12ecf4; IAT RVA 0xfaf1f0
    libcocos2d.dll!?convertToNodeSpace@CCNode@cocos2d@@QEAA?AVCCPoint@2@AEBV32@@Z

## TASK 13 - plan the module lookup

Files: browser-smoke.cjs, setup-browser-result.json, setup-context.mjs,
pe-image.mjs, owned-image.mjs, geode-deferred.yml.

Paste:

> Do only TASK 13. Read these files. Find the smallest read-only method to locate
> the already-loaded libcocos2d module and resolve the exact export above. The
> browser test captures actual game WebAssembly.Memory as __testGameMemory and
> can read Module.FS. Distinguish file bytes from live guest addresses. Specify
> exact PE fields and bounds checks. Do not guess a base, infer free memory from
> zeros, change import resolution or download game binaries. Return
> TASK_13_RESULT.md with facts, unknowns and the precise next edit.

## TASK 14 - capture actual module/export addresses

Files: the same files plus reviewed TASK_13_RESULT.md.

Paste:

> Do only TASK 14 using the reviewed plan. Add a small read-only collector to the
> existing Chromium test. Validate PE signatures, image bounds, export/name/
> ordinal arrays, bounded strings and forwarded exports. Capture module identity,
> actual guest base, export RVA, guest function address and only the exact small
> code excerpt/page needed for this startup probe. Tie the capture to the pinned
> game WASM hash. Preserve existing checks. Do not change import resolution yet.
> Return changed files, TASK_14_RESULT.md and actual captured JSON/log output.
> If unable to execute, mark NOT_RUN and supply the precise run command.

## TASK 15 - bind this one proven import

Files: reviewed Task 14 results/files; build-deferred.py, lift.py, pe-image.mjs,
owned-image.mjs, setup-context.mjs, bundle-services.mjs, deferred-reference.mjs,
windows-*.mjs, ctype-c.mjs.

Paste:

> Do only TASK 15 using the actual reviewed capture. Bind this ONE import to its
> verified live guest address. Validate the module again at setup time. Reproduce
> only necessary captured bytes in the native fixture with explicit ownership/
> bounds. Preserve every other unresolved pointer-read stop, game CPU/stack checks
> and false full-loader flags. Rebuild the native reference and run Chromium.
> Stop at the next unsupported dependency. Return changed files,
> TASK_15_RESULT.md and actual test output with the exact new stop. A longer
> mocked trace alone is not validation.

## TASK 16 - inspect the new dependency

Files: Task 15 actual results and only newly relevant source.

Paste:

> Do only TASK 16. Inspect the dependency Task 15 actually reached. If it is
> RaiseException code 0x406d1388, extract actual arguments, thread-name structure,
> caller, continuation and applicable unwind/handler evidence. Determine a bounded
> host-debugger event or correct guest exception dispatch. Do not replace
> RaiseException with generic success. If the stop differs, investigate that
> dependency instead and do not work on exceptions yet. Return evidence and the
> smallest next implementation task as TASK_16_RESULT.md. Do not implement
> general threading, arbitrary exception suppression or package loading.

## Running checks

Use the repository workflow for native rebuild and Chromium. This source pack
is a review bundle, not a standalone game; it omits the game and generated setup
WASM. Use the verified repository commit when running complete checks.

Official pinned DLL release:
https://github.com/geode-sdk/geode/releases/download/v6.0.0-alpha.1/geode-v6.0.0-alpha.1-win.zip

DLL SHA-256:
ccedc2f1c86baf342f6720b9685991ca31fba246453efe2a1daf609dc40b6499

Game WASM SHA-256:
523d9362955eba27a8ce64ec9b4fda496c8ecc30e6ac9ca1f01cc76c89a5a15a

Do not claim full Geode or existing mod support from partial checkpoints.
