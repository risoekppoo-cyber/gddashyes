#!/usr/bin/env node
'use strict';
// Small, valid WASM fixtures. Tests import the ACTUAL replacement startup-module.mjs.
// Usage: node TASK_05_tests.cjs (keep next to startup-module.mjs).
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

function leb(n) {
  const out = [];
  do { const byte = n & 0x7f; n >>>= 7; out.push(byte | (n ? 0x80 : 0)); } while (n);
  return out;
}
function encName(s) { const b = [...Buffer.from(s, 'utf8')]; return [...leb(b.length), ...b]; }
function section(id, payload) { return [id, ...leb(payload.length), ...payload]; }
const memory = (module = 'env', name = 'memory') => ({module, name, kind: 'memory'});
const func = (name, module = 'env') => ({module, name, kind: 'function'});
const globalImport = (name, module = 'env') => ({module, name, kind: 'global'});

function fixture(imports, {global = false} = {}) {
  // Type[0] is a valid () -> () function. The validator does not inspect function signatures.
  const types = section(1, [1, 0x60, 0, 0]);
  const descriptors = imports.flatMap(i => {
    const prefix = [...encName(i.module), ...encName(i.name)];
    switch (i.kind) {
      case 'memory': return [...prefix, 2, 0, 1]; // min 1 page, no maximum
      case 'function': return [...prefix, 0, 0]; // type 0
      case 'global': return [...prefix, 3, 0x7f, 0]; // immutable i32 global
      default: throw Error(`Unknown fixture import kind ${i.kind}`);
    }
  });
  const importsSection = section(2, [...leb(imports.length), ...descriptors]);
  const globalSection = global ? section(6, [1, 0x7f, 1, 0x41, 0, 0x0b]) : [];
  const importedGlobalCount = imports.filter(i => i.kind === 'global').length;
  const exportSection = global ? section(7, [1, ...encName('__stack_pointer'), 3, ...leb(importedGlobalCount)]) : [];
  return Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0, ...types, ...importsSection, ...globalSection, ...exportSection]);
}

async function main() {
  const modulePath = pathToFileURL(path.join(__dirname, '../experiments/geode-binary/handoff/startup-module.mjs')).href;
  const {instantiateStartupLift} = await import(modulePath);
  const nativeMemory = new WebAssembly.Memory({initial: 1});
  const good = [memory(), func('lift_fault')];
  const write = () => {};
  let pass = 0;

  async function check(label, imports, {accept, options = {}, hasGlobal = false, expectedStack} = {}) {
    const bytes = fixture(imports, {global: hasGlobal});
    // Ensure a rejection is a POLICY decision, not a WebAssembly.compile failure.
    const compiled = await WebAssembly.compile(bytes);
    assert.deepEqual(WebAssembly.Module.imports(compiled).map(i => [i.module, i.name, i.kind]),
      imports.map(i => [i.module, i.name, i.kind]), `${label}: incorrect fixture`);
    if (accept) {
      const instance = await instantiateStartupLift(bytes, nativeMemory, options);
      assert.ok(instance instanceof WebAssembly.Instance, `${label}: missing WASM instance`);
      if (expectedStack !== undefined)
        assert.equal(instance.exports.__stack_pointer.value, expectedStack, `${label}: stack global not initialized`);
    } else {
      await assert.rejects(() => instantiateStartupLift(bytes, nativeMemory, options),
        e => e instanceof Error && e.message === 'Unexpected startup module imports',
        `${label}: expected import-policy rejection`);
    }
    pass++;
    console.log(`PASS ${label} (${accept ? 'ACCEPT' : 'REJECT'})`);
  }

  await check('required imports only', good, {accept: true});
  await check('optional code_write callable', [...good, func('code_write')], {accept: true, options: {codeWrite: write}});
  await check('reordered imports', [func('lift_fault'), memory(), func('code_write')], {accept: true, options: {codeWrite: write}});
  await check('extraneous callable option without code_write import remains allowed', good, {accept: true, options: {codeWrite: write}});
  await check('existing optional compiler global preserved', good, {
    accept: true, hasGlobal: true, options: {stackTop: 0x2000, stackSize: 0x1000}, expectedStack: 0x2000
  });
  await check('missing env.memory', [func('lift_fault'), func('code_write')], {accept: false, options: {codeWrite: write}});
  await check('missing env.lift_fault', [memory(), func('code_write')], {accept: false, options: {codeWrite: write}});
  await check('duplicate env.lift_fault', [memory(), func('lift_fault'), func('lift_fault')], {accept: false});
  await check('duplicate env.code_write', [...good, func('code_write'), func('code_write')], {accept: false, options: {codeWrite: write}});
  await check('wrong kind: env.memory as function', [func('memory'), func('lift_fault')], {accept: false});
  await check('wrong kind: env.lift_fault as global', [memory(), globalImport('lift_fault')], {accept: false});
  await check('wrong kind: env.code_write as global', [...good, globalImport('code_write')], {accept: false, options: {codeWrite: write}});
  await check('wrong module for memory', [memory('other'), func('lift_fault')], {accept: false});
  await check('wrong module for lift_fault', [memory(), func('lift_fault', 'other')], {accept: false});
  await check('extra import name', [...good, func('unexpected')], {accept: false});
  await check('optional code_write with absent callback', [...good, func('code_write')], {accept: false});
  await check('optional code_write with non-callable callback', [...good, func('code_write')], {accept: false, options: {codeWrite: 7}});
  console.log(`RESULT: ${pass}/${pass} passed. All WASM fixtures compiled successfully.`);
}
main().catch(e => { console.error('FAIL', e); process.exitCode = 1; });
