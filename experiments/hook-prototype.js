/* Experimental WASM entry interception. This is not the Geode loader. */
(function (root) {
  'use strict';
  const PIN = '523d9362955eba27a8ce64ec9b4fda496c8ecc30e6ac9ca1f01cc76c89a5a15a';
  const TARGETS = [
    {id: 'menu', name: 'MenuLayer::init', address: 0x8720c0, table: 8004, function: 14163},
    {id: 'leaf', name: 'GJBaseGameLayer::getHitboxTrailMax', address: 0x717680, table: 5341, function: 6726}
  ];
  function u32(value) {
    const out = [];
    do { const byte = value & 127; value >>>= 7; out.push(byte | (value ? 128 : 0)); } while (value);
    return new Uint8Array(out);
  }
  function join(parts) {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of parts) { out.set(part, at); at += part.length; }
    return out;
  }
  function reader(bytes) {
    return {bytes, pos: 0, byte() { if (this.pos >= bytes.length) throw Error('Truncated WASM'); return bytes[this.pos++]; },
      uint() { let n = 0, shift = 0; for (let i = 0; i < 5; i++) { const b = this.byte(); n += (b & 127) * 2 ** shift; if (b < 128) return n; shift += 7; } throw Error('Invalid u32'); },
      name() { const size = this.uint(); const s = new TextDecoder().decode(bytes.subarray(this.pos, this.pos + size)); this.pos += size; return s; }};
  }
  function name(value) { const data = new TextEncoder().encode(value); return join([u32(data.length), data]); }
  function section(id, data) { return join([new Uint8Array([id]), u32(data.length), data]); }
  function sections(bytes) {
    if (bytes.length < 8 || bytes.slice(0, 8).some((v, i) => v !== [0,97,115,109,1,0,0,0][i])) throw Error('Invalid WASM header');
    const r = reader(bytes); r.pos = 8;
    const result = [];
    while (r.pos < bytes.length) {
      const id = r.byte(), length = r.uint(), start = r.pos;
      r.pos += length;
      if (r.pos > bytes.length) throw Error('Truncated section');
      result.push({id, data: bytes.subarray(start, r.pos)});
    }
    return result;
  }
  async function sha256(bytes) {
    return Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  }
  async function patch(bytes) {
    bytes = new Uint8Array(bytes);
    if (await sha256(bytes) !== PIN) throw Error('Hook prototype only supports the pinned GD module; module was not changed');
    const ss = sections(bytes), get = id => ss.find(s => s.id === id).data;
    const imports = reader(get(2)), importCount = imports.uint();
    for (let i = 0; i < importCount; i++) { imports.name(); imports.name(); if (imports.byte() !== 0) throw Error('Unexpected import kind'); imports.uint(); }
    const fr = reader(get(3)), definedCount = fr.uint(), types = [];
    for (let i = 0; i < definedCount; i++) types.push(fr.uint());
    const tr = reader(get(4));
    if (tr.uint() !== 1 || tr.byte() !== 0x70 || tr.uint() !== 1) throw Error('Unexpected table layout');
    const tableSize = tr.uint(), tableMax = tr.uint();
    if (tableSize !== 25363 || tableMax !== tableSize) throw Error('Unexpected table size');
    const originalBodies = [], cr = reader(get(10)), functionCount = cr.uint();
    if (functionCount !== definedCount) throw Error('Function/code count mismatch');
    const bodies = [];
    for (let i = 0; i < functionCount; i++) {
      const size = cr.uint(), body = cr.bytes.subarray(cr.pos, cr.pos + size); cr.pos += size;
      bodies.push(body);
    }
    const exportsReader = reader(get(7)), exportCount = exportsReader.uint();
    const extraExports = [], targetInfo = [];
    for (let i = 0; i < TARGETS.length; i++) {
      const target = TARGETS[i], index = target.function - importCount;
      if (types[index] !== 0) throw Error('Unexpected target signature');
      const originalIndex = importCount + definedCount + i;
      const slot = tableSize + i;
      originalBodies.push(bodies[index]);
      // Replace the entry, so existing direct calls and table calls both reach the hook.
      bodies[index] = join([new Uint8Array([0, 0x20, 0, 0x41]), u32(slot), new Uint8Array([0x11, 0, 0, 0x0b])]);
      extraExports.push(join([name('westminster_original_' + target.id), new Uint8Array([0]), u32(originalIndex)]));
      extraExports.push(join([name('westminster_entry_' + target.id), new Uint8Array([0]), u32(target.function)]));
      targetInfo.push({...target, slot, originalIndex});
    }
    const directProbeIndex = importCount + definedCount + TARGETS.length;
    extraExports.push(join([name('westminster_probe_direct'), new Uint8Array([0]), u32(directProbeIndex)]));
    // Existing translated runtime helpers: preserve guest x86-64 calling state.
    extraExports.push(join([name('westminster_dispatch'), new Uint8Array([0]), u32(24579)]));
    extraExports.push(join([name('westminster_drain_pending'), new Uint8Array([0]), u32(24585)]));
    const directProbe = join([new Uint8Array([0, 0x20, 0, 0x10]), u32(TARGETS[1].function), new Uint8Array([0x0b])]);
    const replacements = new Map([
      [3, join([u32(definedCount + TARGETS.length + 1), ...types.map(u32), ...TARGETS.map(() => u32(0)), u32(0)])],
      [4, join([u32(1), new Uint8Array([0x70, 1]), u32(tableSize + TARGETS.length), u32(tableSize + TARGETS.length)])],
      [7, join([u32(exportCount + extraExports.length), get(7).subarray(exportsReader.pos), ...extraExports])],
      [10, join([u32(definedCount + TARGETS.length + 1), ...bodies.concat(originalBodies, [directProbe]).map(body => join([u32(body.length), body]))])]
    ]);
    return {bytes: join([bytes.subarray(0, 8), ...ss.map(s => section(s.id, replacements.get(s.id) || s.data))]), targets: targetInfo};
  }
  // A compiled, typed wrapper calls before -> original WASM -> after. No JS
  // function is inserted directly into a funcref table.
  function bridgeBytes() {
    const type = new Uint8Array([1, 0x60, 1, 0x7f, 0]);
    const imports = join([u32(3), ...['before', 'original', 'after'].map(n => join([name('hook'), name(n), new Uint8Array([0, 0])]))]);
    const body = new Uint8Array([0, 0x20,0, 0x10,0, 0x20,0, 0x10,1, 0x20,0, 0x10,2, 0x0b]);
    return join([new Uint8Array([0,97,115,109,1,0,0,0]), section(1,type), section(2,imports), section(3,new Uint8Array([1,0])),
      section(7,join([u32(1),name('run'),new Uint8Array([0,3])])), section(10,join([u32(1),u32(body.length),body]))]);
  }
  async function install(instance, targets, callbacks = {}) {
    const e = instance.exports, table = e.__indirect_function_table, handles = {};
    for (const target of targets) {
      const original = e['westminster_original_' + target.id];
      const state = {before: 0, after: 0, enabled: true};
      const wrapped = await WebAssembly.instantiate(bridgeBytes(), {hook: {
        before(cpu) { state.before++; if (state.enabled) callbacks.before?.(target, cpu, e); },
        original,
        after(cpu) { state.after++; if (state.enabled) callbacks.after?.(target, cpu, e); }
      }});
      table.set(target.slot, wrapped.instance.exports.run);
      handles[target.id] = {state, original, enable() { state.enabled = true; }, disable() { state.enabled = false; },
        restore() { table.set(target.slot, original); state.enabled = false; }};
    }
    return handles;
  }
  function nativeBridge(instance) {
    // (i32 CPU, i64 guest address) -> dispatch -> drain pending translated calls.
    // This bridge takes an already prepared guest CPU/stack; it does not marshal
    // C++ objects or make Windows DLLs compatible with WASM.
    const types = new Uint8Array([2,0x60,2,0x7f,0x7e,0,0x60,1,0x7f,0]);
    const imports = join([u32(3), name('guest'), name('dispatch'), new Uint8Array([0,0]),
      name('guest'),name('drain'),new Uint8Array([0,1]),name('guest'),name('memory'),new Uint8Array([2,0,1])]);
    const body = join([new Uint8Array([0,0x20,0,0x20,1,0x10,0,0x02,0x40,0x03,0x40,0x41]),
      u32(346225608),new Uint8Array([0x29,3,0,0x50,0x0d,1,0x20,0,0x10,1,0x0c,0,0x0b,0x0b,0x0b])]);
    const bytes = join([new Uint8Array([0,97,115,109,1,0,0,0]),section(1,types),section(2,imports),
      section(3,new Uint8Array([1,0])),section(7,join([u32(1),name('call'),new Uint8Array([0,2])])),
      section(10,join([u32(1),u32(body.length),body]))]);
    const e = instance.exports;
    const bridge = new WebAssembly.Instance(new WebAssembly.Module(bytes), {guest:{
      dispatch:e.westminster_dispatch,drain:e.westminster_drain_pending,memory:e.memory}});
    const invoke = typeof WebAssembly.promising === 'function' ? WebAssembly.promising(bridge.exports.call) : bridge.exports.call;
    return (cpu, address) => invoke(cpu, BigInt(address));
  }
  const api = {PIN, TARGETS, patch, install, bridgeBytes, nativeBridge};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GDHookPrototype = api;
  if (typeof document === 'undefined' || new URLSearchParams(location.search).get('hooktest') !== '1') return;
  api.enabled = true;
  const hud = document.createElement('output');
  hud.dataset.westUi = 'hook-test'; hud.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:100001;background:#111e;color:#cfff85;padding:10px 14px;border:1px solid #78984b;border-radius:10px;font:13px system-ui;pointer-events:none;max-width:330px';
  hud.textContent = 'Experimental menu hook: preparing…';
  document.body.appendChild(hud);
  api.instantiate = async function (response, imports) {
    try {
      hud.textContent = 'Experimental menu hook: verifying module…';
      const prepared = await patch(await response.arrayBuffer());
      const out = await WebAssembly.instantiate(prepared.bytes, imports);
      let menuEntries = 0, menuReturns = 0;
      api.handles = await install(out.instance, prepared.targets, {
        before(target) { if (target.id === 'menu') menuEntries++; },
        after(target, cpu, e) {
          if (target.id !== 'menu') return;
          menuReturns++;
          const rax = new DataView(e.memory.buffer).getBigUint64(cpu, true);
          hud.textContent = 'Menu WASM entry ' + menuEntries + ' · body returned ' + menuReturns + ' · RAX ' + rax;
          document.dispatchEvent(new CustomEvent('westminster-menu-hook', {detail: {menuEntries, menuReturns, rax: String(rax)}}));
        }
      });
      hud.textContent = 'Experimental menu hook: installed; waiting for menu…';
      return out;
    } catch (error) { hud.textContent = 'Hook experiment stopped: ' + error.message; throw error; }
  };
})(globalThis);
