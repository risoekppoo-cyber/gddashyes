#!/usr/bin/env node
'use strict';
// TASK 08: execute the unmodified, supplied runtime.js in a mocked host.
// No cleanup logic is copied, shimmed, or reimplemented. Only browser/WASM
// dependencies, allocator behaviour, and the test's memory are mocked.
// Usage: node TASK_08_mock_test.cjs [path/to/runtime.js]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const runtimePath = path.resolve(process.argv[2] || path.join(__dirname, 'runtime.js'));
const runtimeSource = fs.readFileSync(runtimePath, 'utf8');
const NativeBytes = Uint8Array;
const NativeWasm = WebAssembly;
const GAME_BASE_SLOT = 346225600;
const RESUME_SLOT = 346324656;
const CPU = 0x20000;
const GUEST_BASE = 0x100000;
const SP = 0x20000;
const STACK = GUEST_BASE + SP - 512;
const SHADOW = 0x300000;
const COMPILER = 0x310000;
const STOP = 0x0212f22d;
const TARGET = 0x00a74a90;
// Real runtime reads fixed 346-million-byte linear-memory control offsets.
// Reuse one ArrayBuffer rather than creating one per scenario.
const memory = {buffer: new ArrayBuffer(RESUME_SLOT + 1024)};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'task08-runtime-'));
const helperPath = path.join(tmp, 'startup-module.mjs');
fs.writeFileSync(helperPath, 'export async function instantiateStartupLift(_bytes, memory) { return globalThis.__task08_context.makeLift(memory); }\n');
const scriptUrl = pathToFileURL(path.join(tmp, 'runtime.js')).href;
const originalGlobals = new Map();
const touchedGlobals = ['location', 'document', 'navigator', 'fetch', 'crypto', 'WebAssembly', 'Uint8Array', 'setInterval', 'clearInterval', 'GDHookPrototype', 'WestminsterHandoffReport', '__task08_context'];

function setGlobal(name, value) {
  if (!originalGlobals.has(name)) originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, {configurable: true, writable: true, value});
}
function restoreGlobals() {
  for (const name of touchedGlobals) {
    const descriptor = originalGlobals.get(name);
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
  originalGlobals.clear();
}
function initializeMemory() {
  const data = new DataView(memory.buffer);
  data.setUint32(GAME_BASE_SLOT, GUEST_BASE, true);
  data.setUint32(RESUME_SLOT, 0, true);
  const cpu = new NativeBytes(memory.buffer, CPU, 208);
  for (let i = 0; i < cpu.length; i++) cpu[i] = (i * 7 + 9) & 255;
  data.setBigUint64(CPU + 32, BigInt(SP), true);
  const stack = new NativeBytes(memory.buffer, STACK, 544);
  for (let i = 0; i < stack.length; i++) stack[i] = (i * 13 + 11) & 255;
  return {cpu: cpu.slice(), stack: stack.slice()};
}
function createNode(tag) {
  return {tag, style: {}, children: [], append(...children) {this.children.push(...children);}, textContent: '', open: false};
}
const manifest = {prologueSha256: '00'.repeat(32), dllSha256: 'mock-dll', gameSha256: 'mock-game',
  gameTarget: {id: 'startup', address: TARGET}, entry: 0x0212f200, stop: STOP};

async function scenario(options = {}) {
  const before = initializeMemory();
  const state = {missingFree: Boolean(options.missingFree), mallocCalls: [], freeCalls: [], freeLookups: 0, liftCalls: 0, beforeCalls: 0, intervalCalls: 0, stage: [], saved: before, frameCount: 0, timeline: [], installReturned: false, instantiateResolved: false};
  const settings = {...options};
  const exports = {memory, malloc(size) {
    state.mallocCalls.push(size);
    const index = state.mallocCalls.length;
    if (settings.failMalloc === index) return 0;
    return index === 1 ? SHADOW : COMPILER;
  }, gd_frames_get() {return state.frameCount;}};
  Object.defineProperty(exports, 'free', {get() {
    state.freeLookups++;
    if (settings.missingFree) return undefined;
    return function(ptr) {
      state.freeCalls.push(ptr);
      const index = state.freeCalls.length;
      if (settings.failFree === index) throw Error(`mock free ${index} failed`);
    };
  }});
  state.makeLift = (mem) => {
    assert.strictEqual(mem, memory, 'actual runtime must pass live game memory to helper');
    return {exports: {
      __stack_pointer: new NativeWasm.Global({value: 'i32', mutable: true}, 0),
      lift_run(shadow, entry, limit, guestBase, stop, mode) {
        state.liftCalls++;
        assert.equal(shadow, SHADOW);
        assert.equal(guestBase, GUEST_BASE);
        assert.equal(stop, BigInt(STOP));
        assert.equal(entry, BigInt(manifest.entry));
        assert.equal(limit, 0x2000000n);
        assert.equal(mode, 32);
        new NativeBytes(memory.buffer, STACK, 544).fill(0xD7); // actual restorer must undo this
        new DataView(memory.buffer).setBigUint64(SHADOW + 192, BigInt(settings.wrongStop ? STOP + 1 : STOP), true);
        if (settings.cpuMismatch) new NativeBytes(memory.buffer, CPU, 1)[0] ^= 0x80;
        if (settings.prologueThrows) throw Error('mock prologue fault');
        return 14;
      }
    }};
  };
  let callback;
  const prototype = {TARGETS: [], patch: async bytes => ({bytes, targets: [manifest.gameTarget]}),
    async install(_instance, _targets, hooks) {
      callback = hooks.before;
      if (settings.duringInstall) {
        state.beforeCalls++;
        callback(manifest.gameTarget, CPU);
      }
      state.installReturned = true;
      return {};
    }};
  const {restoreMode} = settings;
  class InstrumentedBytes extends NativeBytes {
    set(source, offset) {
      if (this.byteOffset === STACK && this.length === 544 && source.length === 544) {
        if (restoreMode === 'throw') throw Error('mock stack restore write failed');
        super.set(source, offset);
        if (restoreMode === 'mismatch') this[0] ^= 0x80;
        return;
      }
      return super.set(source, offset);
    }
  }
  let interval;
  setGlobal('location', {search: '?geodehandoff=1'});
  setGlobal('document', {currentScript: {src: scriptUrl}, body: {append() {}}, createElement: createNode});
  setGlobal('navigator', {userAgent: 'TASK08 mock Node.js'});
  setGlobal('fetch', async url => {
    const name = String(url);
    if (name.endsWith('/manifest.json')) return {ok: true, json: async () => manifest};
    if (name.endsWith('/prologue.wasm')) return {ok: true, arrayBuffer: async () => new ArrayBuffer(8)};
    throw Error('Unexpected mock fetch: ' + name);
  });
  setGlobal('crypto', {subtle: {digest: async () => new ArrayBuffer(32)}});
  setGlobal('WebAssembly', {...NativeWasm, Global: NativeWasm.Global,
    instantiate: async () => ({instance: {exports}})});
  setGlobal('Uint8Array', InstrumentedBytes);
  setGlobal('setInterval', cb => {interval = cb; return 1;});
  setGlobal('clearInterval', () => {});
  setGlobal('GDHookPrototype', prototype);
  setGlobal('__task08_context', state);
  try {
    // This is the exact runtime.js text from the uploaded zip; no source edits.
    new Function(runtimeSource)();
    assert.equal(typeof prototype.instantiate, 'function');
    await prototype.instantiate({arrayBuffer: async () => new ArrayBuffer(8)}, {});
    state.instantiateResolved = true;
    if (settings.mode === 'deferred') {
      assert.equal(settings.duringInstall, undefined, 'deferred mode must not invoke callback during install');
      assert.equal(state.installReturned, true, 'install must resolve before deferred invocation');
      assert.equal(typeof callback, 'function', 'install must save the actual runtime callback');
      const record = event => {
        const report = globalThis.WestminsterHandoffReport;
        state.timeline.push({event, status: report.status, error: report.error,
          gameFrames: report.gameFrames, gameContinuedAfterHandoff: report.gameContinuedAfterHandoff === true,
          callbackPrologueExecuted: report.callbackPrologueExecuted,
          beforeCalls: state.beforeCalls, liftCalls: state.liftCalls,
          mallocCalls: state.mallocCalls.length, freeCalls: state.freeCalls.length});
      };
      record('after-install-and-instantiate');
      for (const step of settings.sequence || []) {
        if (step.type === 'frame') {
          assert.equal(typeof interval, 'function', 'runtime must install its own interval');
          assert.ok(Number.isInteger(step.frames) && step.frames >= 0);
          state.frameCount = step.frames;
          interval(); state.intervalCalls++;
          record(`frame:${step.frames}`);
        } else if (step.type === 'callback') {
          assert.equal(state.instantiateResolved, true, 'deferred callback cannot run before instantiate resolves');
          state.beforeCalls++;
          callback(step.target === 'startup' ? manifest.gameTarget : {id: step.target}, CPU);
          record(`callback:${step.target}`);
        } else throw Error('Invalid deferred step: ' + JSON.stringify(step));
      }
    } else {
      // All 15 Task 07 scenarios retain their original event timing and assertions.
      if (settings.duringInstall) state.stage.push(globalThis.WestminsterHandoffReport.status);
      for (const event of (settings.events || (settings.duringInstall ? [] : ['startup']))) {
        state.beforeCalls++;
        callback(event === 'startup' ? manifest.gameTarget : {id: event}, CPU);
        state.stage.push(globalThis.WestminsterHandoffReport.status);
      }
      // Runtime's interval updates game frames, but must not overwrite terminal state.
      if (interval) { interval(); state.intervalCalls++; }
    }
    const report = {...globalThis.WestminsterHandoffReport};
    return {report, state, originalStackRestored: before.stack.every((b, i) => new NativeBytes(memory.buffer, STACK, 544)[i] === b),
      originalCpuPreserved: before.cpu.every((b, i) => new NativeBytes(memory.buffer, CPU, 208)[i] === b)};
  } finally {
    restoreGlobals();
  }
}

function expectStatus(r, status, error) {
  assert.equal(r.report.status, status);
  if (error) assert.match(r.report.error || '', error);
  else assert.equal(r.report.error, undefined);
}
function expectCleanup(r, malloc, frees, lookups) {
  assert.deepEqual(r.state.mallocCalls, malloc, 'allocator calls');
  assert.deepEqual(r.state.freeCalls, frees, 'free attempts and order');
  assert.equal(r.state.freeLookups, lookups * (r.state.missingFree ? 1 : 2), 'independent free availability checks (typeof plus invocation for callable free)');
}
const cases = [
  ['existing: normal success and no WAITING overwrite', {duringInstall: true}, r => {
    expectStatus(r, 'LIVE_CALLBACK_PROLOGUE_PASS'); expectCleanup(r, [4096, 65536], [SHADOW, COMPILER], 2);
    assert.equal(r.state.liftCalls, 1); assert.equal(r.report.liveStackRestored, true); assert.equal(r.originalStackRestored, true);
    assert.equal(r.originalCpuPreserved, true); assert.equal(r.report.originalGameCpuPreserved, true);
    assert.deepEqual(r.state.stage, ['LIVE_CALLBACK_PROLOGUE_PASS']);
  }],
  ['existing: restoration mismatch', {restoreMode: 'mismatch'}, r => {
    expectStatus(r, 'HANDOFF_STOPPED', /Live stack restoration mismatch/);
    expectCleanup(r, [4096, 65536], [SHADOW, COMPILER], 2);
    assert.equal(r.report.liveStackRestored, false); assert.equal(r.originalStackRestored, false);
  }],
  ['existing: restoration throws', {restoreMode: 'throw'}, r => {
    expectStatus(r, 'HANDOFF_STOPPED', /mock stack restore write failed/);
    expectCleanup(r, [4096, 65536], [SHADOW, COMPILER], 2);
    assert.equal(r.originalStackRestored, false);
  }],
  ['existing: first free throws but second attempted', {failFree: 1}, r => {
    expectStatus(r, 'HANDOFF_STOPPED', /mock free 1 failed/);
    expectCleanup(r, [4096, 65536], [SHADOW, COMPILER], 2);
    assert.equal(r.report.liveStackRestored, true);
  }],
  ['existing: partial allocation failure preserves first error', {failMalloc: 2, failFree: 1}, r => {
    expectStatus(r, 'HANDOFF_STOPPED', /Could not reserve isolated translator state/);
    assert.doesNotMatch(r.report.error, /mock free 1 failed/);
    expectCleanup(r, [4096, 65536], [SHADOW], 1); assert.equal(r.state.liftCalls, 0);
  }],
  ['added: first malloc fails; second allocation cleaned', {failMalloc: 1}, r => {
    expectStatus(r, 'HANDOFF_STOPPED', /Could not reserve isolated translator state/);
    expectCleanup(r, [4096, 65536], [COMPILER], 1); assert.equal(r.state.liftCalls, 0);
  }],
  ['added: missing free records first error and checks both blocks', {missingFree: true}, r => {
    expectStatus(r, 'HANDOFF_STOPPED', /Missing game allocator free/);
    expectCleanup(r, [4096, 65536], [], 2); assert.equal(r.report.liveStackRestored, true);
  }],
  ['added: second free throws', {failFree: 2}, r => {
    expectStatus(r, 'HANDOFF_STOPPED', /mock free 2 failed/);
    expectCleanup(r, [4096, 65536], [SHADOW, COMPILER], 2);
    assert.equal(r.originalStackRestored, true);
  }],
  ['added: prologue throws; first error survives later free failure', {prologueThrows: true, failFree: 2}, r => {
    expectStatus(r, 'HANDOFF_STOPPED', /mock prologue fault/);
    assert.doesNotMatch(r.report.error, /mock free 2 failed/);
    expectCleanup(r, [4096, 65536], [SHADOW, COMPILER], 2);
    assert.equal(r.originalStackRestored, true); assert.equal(r.state.liftCalls, 1);
  }],
  ['added: CPU mismatch detected', {cpuMismatch: true}, r => {
    expectStatus(r, 'HANDOFF_STOPPED', /Original game CPU changed/);
    expectCleanup(r, [4096, 65536], [SHADOW, COMPILER], 2);
    assert.equal(r.originalCpuPreserved, false); assert.equal(r.originalStackRestored, true);
  }],
  ['added: wrong stop PC detected', {wrongStop: true}, r => {
    expectStatus(r, 'HANDOFF_STOPPED', /Deferred prologue did not stop before its first call/);
    expectCleanup(r, [4096, 65536], [SHADOW, COMPILER], 2);
    assert.equal(r.state.liftCalls, 1); assert.equal(r.originalStackRestored, true);
  }],
  ['added: unrelated target ignored; startup still succeeds', {events: ['menu', 'startup']}, r => {
    expectStatus(r, 'LIVE_CALLBACK_PROLOGUE_PASS');
    assert.deepEqual(r.state.stage, ['WAITING_FOR_REAL_GAME_STARTUP', 'LIVE_CALLBACK_PROLOGUE_PASS']);
    assert.equal(r.state.liftCalls, 1); expectCleanup(r, [4096, 65536], [SHADOW, COMPILER], 2);
  }],
  ['added: repeated startup observation ignored', {events: ['startup', 'startup', 'startup']}, r => {
    expectStatus(r, 'LIVE_CALLBACK_PROLOGUE_PASS');
    assert.deepEqual(r.state.stage, Array(3).fill('LIVE_CALLBACK_PROLOGUE_PASS'));
    assert.equal(r.state.liftCalls, 1); expectCleanup(r, [4096, 65536], [SHADOW, COMPILER], 2);
  }],
  ['extra: restoration failure wins over both free failures', {restoreMode: 'mismatch', failFree: 1}, r => {
    expectStatus(r, 'HANDOFF_STOPPED', /Live stack restoration mismatch/);
    assert.doesNotMatch(r.report.error, /mock free/);
    expectCleanup(r, [4096, 65536], [SHADOW, COMPILER], 2);
  }],
  ['extra: failure during hook installation not overwritten by WAITING', {duringInstall: true, wrongStop: true}, r => {
    expectStatus(r, 'HANDOFF_STOPPED', /Deferred prologue did not stop before its first call/);
    assert.deepEqual(r.state.stage, ['HANDOFF_STOPPED']);
    expectCleanup(r, [4096, 65536], [SHADOW, COMPILER], 2);
  }],
  ['deferred: WAITING -> PASS after install resolves', {mode: 'deferred', sequence: [
    {type: 'frame', frames: 1}, {type: 'callback', target: 'startup'}, {type: 'frame', frames: 200}
  ]}, r => {
    expectStatus(r, 'LIVE_CALLBACK_PROLOGUE_PASS');
    assert.deepEqual(r.state.timeline.map(t => t.status), [
      'WAITING_FOR_REAL_GAME_STARTUP', 'WAITING_FOR_REAL_GAME_STARTUP',
      'LIVE_CALLBACK_PROLOGUE_PASS', 'LIVE_CALLBACK_PROLOGUE_PASS']);
    assert.deepEqual(r.state.timeline.map(t => t.event), [
      'after-install-and-instantiate', 'frame:1', 'callback:startup', 'frame:200']);
    assert.equal(r.state.timeline[1].liftCalls, 0, 'not executed before callback');
    assert.equal(r.state.timeline[2].liftCalls, 1);
    assert.equal(r.report.gameFrames, 200);
    assert.equal(r.report.gameContinuedAfterHandoff, true);
    assert.equal(r.originalStackRestored, true); assert.equal(r.originalCpuPreserved, true);
    expectCleanup(r, [4096, 65536], [SHADOW, COMPILER], 2);
  }],
  ['deferred: WAITING -> STOPPED after install resolves', {mode: 'deferred', wrongStop: true,
    failFree: 1, sequence: [{type: 'callback', target: 'startup'}, {type: 'frame', frames: 150}]
  }, r => {
    expectStatus(r, 'HANDOFF_STOPPED', /Deferred prologue did not stop before its first call/);
    assert.doesNotMatch(r.report.error, /mock free 1 failed/, 'first error must win');
    assert.deepEqual(r.state.timeline.map(t => t.status), [
      'WAITING_FOR_REAL_GAME_STARTUP', 'HANDOFF_STOPPED', 'HANDOFF_STOPPED']);
    assert.equal(r.report.gameFrames, 150);
    assert.equal(r.state.liftCalls, 1); assert.equal(r.originalStackRestored, true);
    expectCleanup(r, [4096, 65536], [SHADOW, COMPILER], 2);
  }],
  ['deferred: frames advance without callback, status remains WAITING', {mode: 'deferred', sequence: [
    {type: 'frame', frames: 1}, {type: 'frame', frames: 120}, {type: 'frame', frames: 200}
  ]}, r => {
    expectStatus(r, 'WAITING_FOR_REAL_GAME_STARTUP');
    assert.deepEqual(r.state.timeline.map(t => t.status), Array(4).fill('WAITING_FOR_REAL_GAME_STARTUP'));
    assert.equal(r.report.gameFrames, 200);
    assert.equal(r.report.gameContinuedAfterHandoff, true);
    assert.equal(r.report.callbackPrologueExecuted, false);
    assert.equal(r.state.beforeCalls, 0); assert.equal(r.state.liftCalls, 0);
    expectCleanup(r, [], [], 0);
  }],
  ['deferred: frame ticks and replay never promote STOPPED to PASS', {mode: 'deferred',
    prologueThrows: true, failFree: 2, sequence: [
      {type: 'callback', target: 'startup'}, {type: 'frame', frames: 1},
      {type: 'frame', frames: 200}, {type: 'callback', target: 'startup'},
      {type: 'frame', frames: 240}
    ]}, r => {
    expectStatus(r, 'HANDOFF_STOPPED', /mock prologue fault/);
    assert.doesNotMatch(r.report.error, /mock free 2 failed/, 'first error must survive');
    assert.deepEqual(r.state.timeline.map(t => t.status), [
      'WAITING_FOR_REAL_GAME_STARTUP', 'HANDOFF_STOPPED', 'HANDOFF_STOPPED',
      'HANDOFF_STOPPED', 'HANDOFF_STOPPED', 'HANDOFF_STOPPED']);
    const firstError = r.state.timeline[1].error;
    assert.ok(firstError?.includes('mock prologue fault'));
    assert.ok(r.state.timeline.slice(2).every(t => t.error === firstError), 'failure must be terminal and first error stable');
    assert.ok(r.state.timeline.every(t => t.status !== 'LIVE_CALLBACK_PROLOGUE_PASS'));
    assert.equal(r.state.beforeCalls, 2); assert.equal(r.state.liftCalls, 1);
    assert.equal(r.report.gameFrames, 240); assert.equal(r.originalStackRestored, true);
    expectCleanup(r, [4096, 65536], [SHADOW, COMPILER], 2);
  }],
];

(async () => {
  const hash = require('node:crypto').createHash('sha256').update(runtimeSource).digest('hex');
  console.log('TASK 08 actual-runtime mock tests');
  console.log('source: ' + runtimePath);
  console.log('runtime SHA-256: ' + hash);
  let pass = 0, fail = 0;
  try {
    for (const [name, options, validate] of cases) {
      try {
        const result = await scenario(options);
        validate(result);
        console.log(`PASS ${name} [${result.report.status}]`);
        pass++;
      } catch (e) {
        fail++;
        console.log(`FAIL ${name}: ${e.stack || e}`);
      }
    }
  } finally {
    fs.rmSync(tmp, {recursive: true, force: true});
  }
  console.log(`TOTAL ${pass + fail}: ${pass} PASS, ${fail} FAIL`);
  if (fail) process.exitCode = 1;
})().catch(e => {console.error(e.stack || e); process.exitCode = 1;});
