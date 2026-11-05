/* Shared browser/Node verification against the actual pinned game module. */
(function (root) {
  'use strict';
  async function verify(bytes, prototype, progress = () => {}) {
    const check = (condition, message) => { if (!condition) throw Error(message); };
    progress('Verifying and instrumenting the pinned game module');
    const prepared = await prototype.patch(bytes);
    progress('Compiling the actual game module');
    const mod = await WebAssembly.compile(prepared.bytes);
    const imports = {}, nativeLog = []; let e;
    for (const item of WebAssembly.Module.imports(mod)) {
      check(item.kind === 'function', 'Unexpected non-function import');
      (imports[item.module] ||= {})[item.name] = item.name === 'fd_write' ? (fd, iovs, count, written) => {
        const view = new DataView(e.memory.buffer); let length = 0;
        for (let i = 0; i < count; i++) {
          const pointer = view.getUint32(iovs + i * 8, true), size = view.getUint32(iovs + i * 8 + 4, true);
          nativeLog.push(new TextDecoder().decode(new Uint8Array(e.memory.buffer, pointer, size))); length += size;
        }
        view.setUint32(written, length, true); return 0;
      } : item.name === 'emscripten_asm_const_int' ? code => {
        if (code === 346202866) return 0;
        throw Error('Unexpected inline host request: ' + code);
      } : () => { throw Error('Unexpected host call: ' + item.name + '\n' + nativeLog.join('')); };
    }
    const instance = await WebAssembly.instantiate(mod, imports); e = instance.exports;
    let seenOriginal = null;
    const handles = await prototype.install(instance, prepared.targets, {
      after(target, cpu) {
        if (target.id !== 'leaf') return;
        const view = new DataView(e.memory.buffer);
        seenOriginal = view.getBigUint64(cpu, true); view.setBigUint64(cpu, 600n, true);
      }
    });
    const cpu = 4096, stack = 8192, returnAddress = 0x12345678n;
    function reset() {
      const view = new DataView(e.memory.buffer);
      new Uint8Array(e.memory.buffer, cpu, 256).fill(0);
      view.setBigUint64(cpu + 32, BigInt(stack), true); view.setBigUint64(stack, returnAddress, true);
      view.setBigUint64(346225608, 0n, true);
    }
    function state(expected) {
      const view = new DataView(e.memory.buffer);
      check(view.getBigUint64(cpu, true) === BigInt(expected), 'Incorrect native return value');
      check(view.getBigUint64(cpu + 32, true) === 8200n, 'Native stack was not preserved');
      check(view.getBigUint64(cpu + 192, true) === returnAddress, 'Native return address was not preserved');
    }
    progress('Testing original, direct calls, table calls and hook restoration');
    reset(); handles.leaf.original(cpu); state(480);
    reset(); e.westminster_probe_direct(cpu); state(600); check(seenOriginal === 480n, 'Original was not observed');
    reset(); e.__indirect_function_table.get(prototype.TARGETS[1].table)(cpu); state(600);
    check(handles.leaf.state.before === 2 && handles.leaf.state.after === 2, 'Incorrect hook callback counts');
    handles.leaf.disable(); reset(); e.westminster_probe_direct(cpu); state(480);
    handles.leaf.enable(); reset(); e.westminster_probe_direct(cpu); state(600);
    handles.leaf.restore(); reset(); e.westminster_probe_direct(cpu); state(480);
    progress('Testing calls by original Windows address');
    const callNative = prototype.nativeBridge(instance);
    reset(); await callNative(cpu, 0x717680n); state(480);
    progress('Testing pending translated calls');
    let queued = false;
    const queuedHandles = await prototype.install(instance, prepared.targets, {
      after(target) {
        if (target.id !== 'leaf' || queued) return;
        queued = true;
        const view = new DataView(e.memory.buffer);
        view.setBigUint64(stack + 8, 0x87654321n, true);
        view.setBigUint64(346225608, 1n, true);
        view.setBigUint64(346225616, 0x717680n, true);
      }
    });
    reset(); await callNative(cpu, 0x717680n);
    const view = new DataView(e.memory.buffer);
    check(queuedHandles.leaf.state.before === 2 && queuedHandles.leaf.state.after === 2, 'Pending call did not reach the original game function');
    check(view.getBigUint64(cpu, true) === 480n && view.getBigUint64(cpu + 32, true) === 8208n &&
      view.getBigUint64(cpu + 192, true) === 0x87654321n && view.getBigUint64(346225608, true) === 0n,
      'Pending translated call did not complete correctly');
    for (const handle of Object.values(queuedHandles)) handle.restore();
    progress('Checking that an unexpected game build is rejected');
    const changed = new Uint8Array(bytes).slice(); changed[changed.length - 1] ^= 1;
    let rejected = false;
    try { await prototype.patch(changed); } catch (error) { rejected = /pinned GD module/.test(error.message); }
    check(rejected, 'Unexpected game build was accepted');
    return {status:'PASS', module:prototype.PIN, original:480, modified:600, directCall:true, indirectCall:true,
      nativeReturnPreserved:true, toggleAndRestore:true, modifiedModuleRejected:true, nativeAddressCall:true,
      pendingNativeCall:true, fullGameBootTested:false, geodeLoaded:false};
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = verify;
  else root.verifyWestminsterHooks = verify;
})(globalThis);
