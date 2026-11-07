#!/usr/bin/env node
'use strict';
// Boundary tests for the ACTUAL Task 06 replacement startup-module.mjs.
// Usage: node TASK_06_tests.cjs  (keep beside startup-module.mjs).
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

function leb(n) {
  const bytes = [];
  do { const low = n & 127; n >>>= 7; bytes.push(low | (n ? 128 : 0)); } while (n);
  return bytes;
}
function name(s) { const b = [...Buffer.from(s)]; return [...leb(b.length), ...b]; }
function section(id, bytes) { return [id, ...leb(bytes.length), ...bytes]; }
function fixture(hasGlobal) {
  const types = section(1, [1, 0x60, 0, 0]); // () -> ()
  const imports = section(2, [2,
    ...name('env'), ...name('memory'), 2, 0, 1, // memory, >= 1 page
    ...name('env'), ...name('lift_fault'), 0, 0 // function type 0
  ]);
  const global = hasGlobal ? section(6, [1, 0x7f, 1, 0x41, 0, 0x0b]) : [];
  const exports = hasGlobal ? section(7, [1, ...name('__stack_pointer'), 3, 0]) : [];
  return Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0,
    ...types, ...imports, ...global, ...exports]);
}

async function main() {
  const {instantiateStartupLift} = await import(pathToFileURL(path.join(__dirname, '../experiments/geode-binary/handoff/startup-module.mjs')).href);
  const withGlobal = fixture(true);
  const withoutGlobal = fixture(false);
  for (const bytes of [withGlobal, withoutGlobal]) {
    const mod = await WebAssembly.compile(bytes); // valid WASM; policy rejection is not compile rejection
    assert.deepEqual(WebAssembly.Module.imports(mod).map(i => [i.module, i.name, i.kind]),
      [['env', 'memory', 'memory'], ['env', 'lift_fault', 'function']]);
  }
  const memory = new WebAssembly.Memory({initial: 1}); // exactly 65536 bytes
  const largeMemory = new WebAssembly.Memory({initial: 144}); // supports default top=0x900000
  let passed = 0;

  async function check(label, {hasGlobal = true, options = {}, mem = memory, accept, expectTop, mustSkipInstantiate = !accept}) {
    const original = WebAssembly.instantiate;
    let attempts = 0;
    WebAssembly.instantiate = function (...args) {
      attempts++;
      return Reflect.apply(original, WebAssembly, args);
    };
    try {
      if (accept) {
        const result = await instantiateStartupLift(hasGlobal ? withGlobal : withoutGlobal, mem, options);
        assert.ok(result instanceof WebAssembly.Instance, `${label}: missing instance`);
        if (hasGlobal) {
          assert.ok(result.exports.__stack_pointer instanceof WebAssembly.Global, `${label}: no global`);
          assert.equal(result.exports.__stack_pointer.value, expectTop, `${label}: wrong stack top`);
        } else {
          assert.equal(result.exports.__stack_pointer, undefined, `${label}: global should remain optional`);
        }
        assert.equal(attempts, 1, `${label}: expected exactly one instantiation`);
      } else {
        await assert.rejects(
          () => instantiateStartupLift(hasGlobal ? withGlobal : withoutGlobal, mem, options),
          e => e instanceof Error && e.message === 'Missing compiler stack export or invalid reservation',
          `${label}: expected stack policy rejection`
        );
        if (mustSkipInstantiate)
          assert.equal(attempts, 0, `${label}: invalid options reached WebAssembly.instantiate`);
      }
      passed++;
      console.log(`PASS ${label}: ${accept ? 'ACCEPT' : 'REJECT'}; instantiate calls=${attempts}`);
    } finally {
      WebAssembly.instantiate = original;
    }
  }

  const ok = (label, top, size) => check(label, {accept: true,
    options: {stackTop: top, stackSize: size}, expectTop: top});
  const bad = (label, top, size) => check(label, {accept: false,
    options: {stackTop: top, stackSize: size}});

  // Valid, closed interval [stackTop - stackSize, stackTop] within WASM memory.
  await ok('smallest aligned top and size; lower boundary exactly zero', 16, 16);
  await ok('top at end of WASM memory; lower boundary exactly zero', 65536, 65536);
  await ok('top at end of WASM memory, one-byte size', 65536, 1);
  await ok('unaligned positive stackSize=1 is allowed', 16, 1);
  await ok('unaligned positive stackSize=3 is allowed', 16, 3);
  await ok('unaligned positive stackSize=15 is allowed', 16, 15);
  await ok('interior aligned top', 32, 17);
  await check('original defaults accepted when memory is large enough',
    {accept: true, options: {}, mem: largeMemory, expectTop: 0x900000});

  // Invalid inputs must be rejected *before* the module is instantiated.
  await bad('top zero with positive size', 0, 1);
  await bad('negative top', -16, 1);
  await bad('top not 16-byte aligned', 17, 1);
  await bad('top not 16-byte aligned near zero', 15, 1);
  await bad('top past memory end', 65552, 1);
  await bad('top greater than safe integer', Number.MAX_SAFE_INTEGER + 1, 1);
  await bad('top fractional', 16.5, 1);
  await bad('top NaN', NaN, 1);
  await bad('top Infinity', Infinity, 1);
  await bad('top string', '16', 1);
  await bad('top BigInt', 16n, 1);
  await bad('size zero', 16, 0);
  await bad('size negative', 16, -1);
  await bad('size exceeds top, producing negative lower boundary', 16, 17);
  await bad('size greater than memory capacity', 65536, 65537);
  await bad('size fractional', 16, 0.5);
  await bad('size NaN', 16, NaN);
  await bad('size Infinity', 16, Infinity);
  await bad('size string', 16, '1');
  await bad('size BigInt', 16, 1n);
  await bad('size greater than safe integer', 16, Number.MAX_SAFE_INTEGER + 1);
  await check('global present, defaults exceed small memory: reject pre-instantiation',
    {accept: false, options: {}});

  // The prior contract applies reservation checks only when a compiler global exists.
  await check('no global: defaults remain accepted on one-page memory',
    {hasGlobal: false, accept: true});
  await check('no global: invalid numeric options remain ignored',
    {hasGlobal: false, options: {stackTop: -16, stackSize: 0}, accept: true});
  await check('no global: non-number options remain ignored',
    {hasGlobal: false, options: {stackTop: 16n, stackSize: 'bad'}, accept: true});

  console.log(`RESULT: ${passed}/${passed} passed; both small WASM fixtures compiled; policy rejection always pre-instantiation.`);
}
main().catch(e => { console.error('FAIL', e); process.exitCode = 1; });
