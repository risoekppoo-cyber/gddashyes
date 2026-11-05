/* Run against the actual pinned game module, without booting graphics or audio. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const prototype = require('./hook-prototype.js');
(async () => {
  const path = process.argv[2];
  if (!path) throw Error('Usage: node experiments/verify-hook.cjs /path/to/gd.wasm');
  const prepared = await prototype.patch(fs.readFileSync(path));
  const mod = await WebAssembly.compile(prepared.bytes);
  const imports = {};
  for (const item of WebAssembly.Module.imports(mod)) {
    assert.equal(item.kind, 'function');
    (imports[item.module] ||= {})[item.name] = () => { throw Error('Unexpected host call: ' + item.name); };
  }
  const instance = await WebAssembly.instantiate(mod, imports), e = instance.exports;
  let seenOriginal = null;
  const handles = await prototype.install(instance, prepared.targets, {
    after(target, cpu) {
      if (target.id !== 'leaf') return;
      const memory = new DataView(e.memory.buffer);
      seenOriginal = memory.getBigUint64(cpu, true);
      memory.setBigUint64(cpu, 600n, true);
    }
  });
  const cpu = 4096, stack = 8192, returnAddress = 0x12345678n;
  function reset() {
    const v = new DataView(e.memory.buffer);
    new Uint8Array(e.memory.buffer, cpu, 256).fill(0);
    v.setBigUint64(cpu + 32, BigInt(stack), true);
    v.setBigUint64(stack, returnAddress, true);
  }
  function result() {
    const v = new DataView(e.memory.buffer);
    return {rax: v.getBigUint64(cpu, true), rsp: v.getBigUint64(cpu + 32, true), rip: v.getBigUint64(cpu + 192, true)};
  }
  reset(); handles.leaf.original(cpu);
  assert.deepEqual(result(), {rax:480n, rsp:8200n, rip:returnAddress});
  reset(); e.westminster_probe_direct(cpu);
  assert.equal(seenOriginal, 480n);
  assert.deepEqual(result(), {rax:600n, rsp:8200n, rip:returnAddress});
  reset(); e.__indirect_function_table.get(prototype.TARGETS[1].table)(cpu);
  assert.equal(seenOriginal, 480n); assert.equal(result().rax, 600n);
  assert.deepEqual([handles.leaf.state.before, handles.leaf.state.after], [2,2]);
  handles.leaf.disable(); reset(); e.westminster_probe_direct(cpu); assert.equal(result().rax, 480n);
  handles.leaf.enable(); reset(); e.westminster_probe_direct(cpu); assert.equal(result().rax, 600n);
  handles.leaf.restore(); reset(); e.westminster_probe_direct(cpu); assert.equal(result().rax, 480n);
  const changed = fs.readFileSync(path); changed[changed.length - 1] ^= 1;
  await assert.rejects(prototype.patch(changed), /pinned GD module/);
  console.log(JSON.stringify({status:'PASS', module:prototype.PIN, original:480, modified:600,
    directCall:true, indirectCall:true, nativeReturnPreserved:true, toggleAndRestore:true,
    modifiedModuleRejected:true, fullGameBootTested:false, geodeLoaded:false}, null, 2));
})().catch(error => {console.error(error); process.exitCode = 1;});
