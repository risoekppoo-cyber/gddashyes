import createTulipEngine from './dist/engine.mjs';

export async function verifyTulip(gameBytes, prototype, modBytes, progress = () => {}) {
  const check = (condition, message) => { if (!condition) throw Error(message); };
  progress('Instrumenting and compiling the actual pinned game module');
  const prepared = await prototype.patch(gameBytes);
  const gameModule = await WebAssembly.compile(prepared.bytes);
  const imports = {};
  for (const item of WebAssembly.Module.imports(gameModule)) {
    check(item.kind === 'function', 'Unexpected game import');
    (imports[item.module] ||= {})[item.name] = () => { throw Error('Unexpected game host call: ' + item.name); };
  }
  const game = await WebAssembly.instantiate(gameModule, imports);
  const e = game.exports, cpu = 4096, stack = 8192, returnAddress = 0x12345678n;
  const reset = () => {
    const v = new DataView(e.memory.buffer);
    new Uint8Array(e.memory.buffer, cpu, 256).fill(0);
    v.setBigUint64(cpu + 32, BigInt(stack), true);
    v.setBigUint64(stack, returnAddress, true);
    v.setBigUint64(346225608, 0n, true);
  };
  const expect = (fn, value) => {
    reset(); fn(cpu);
    const v = new DataView(e.memory.buffer);
    check(v.getBigUint64(cpu, true) === BigInt(value), 'Expected RAX ' + value + ', got ' + v.getBigUint64(cpu, true));
    check(v.getBigUint64(cpu + 32, true) === 8200n, 'Guest stack changed incorrectly');
    check(v.getBigUint64(cpu + 192, true) === returnAddress, 'Guest return address changed incorrectly');
  };
  expect(e.westminster_original_leaf, 480);
  progress('Starting compiled upstream TulipHook in patchless mode');
  const runtime = await createTulipEngine();
  runtime.bridge = {
    original: e.westminster_original_leaf,
    readRax: pointer => Number(new DataView(e.memory.buffer).getBigUint64(pointer, true)),
    writeRax: (pointer, value) => new DataView(e.memory.buffer).setBigUint64(pointer, BigInt(value), true)
  };
  check(runtime._wm_init() === 1, 'Tulip initialization failed: ' + runtime.ccall('wm_error', 'string', [], []));
  const handles = await prototype.install(game, prepared.targets);
  const wrapper = await WebAssembly.instantiate(prototype.bridgeBytes(), {hook: {
    before() {}, original: pointer => runtime._wm_next(pointer), after() {}
  }});
  const table = e.__indirect_function_table;
  table.set(prepared.targets.find(t => t.id === 'leaf').slot, wrapper.instance.exports.run);
  expect(e.westminster_probe_direct, 480);
  progress('Dynamically loading the separately compiled C++ test mod');
  runtime.FS.writeFile('/test-mod.wasm', modBytes);
  check(runtime.ccall('wm_load_mod', 'number', ['string'], ['/test-mod.wasm']) === 1,
    'Mod load failed: ' + runtime.ccall('wm_error', 'string', [], []));
  const direct = e.westminster_probe_direct;
  const indirect = table.get(prototype.TARGETS.find(t => t.id === 'leaf').table);
  expect(direct, 600); expect(indirect, 600);
  progress('Checking hook removal, re-enabling, two-hook chaining and priorities');
  check(runtime._wm_mod_command(0) === 1, 'Disable failed'); expect(direct, 480);
  check(runtime._wm_mod_command(1) === 1, 'Enable failed'); expect(direct, 600);
  check(runtime._wm_mod_command(2) === 1, 'Second hook failed'); expect(direct, 1080);
  check(runtime._wm_mod_command(3) === 1, 'Priority update failed'); expect(direct, 1200);
  check(runtime._wm_mod_command(4) === 1, 'Second hook removal failed'); expect(direct, 600);
  check(runtime._wm_mod_command(0) === 1, 'Final hook removal failed'); expect(direct, 480);
  for (const handle of Object.values(handles)) handle.restore();
  expect(direct, 480);
  return {
    status: 'PASS', module: prototype.PIN,
    upstreamTulipHookCompiled: true, patchlessCommonHandler: true,
    separateCppModDynamicallyLoaded: true, original: 480, modified: 600,
    directCall: true, indirectCall: true, originalCalledFromCpp: true,
    nativeReturnPreserved: true, toggleAndRestore: true,
    twoHookChain: 1080, reorderedHookChain: 1200,
    fullGameBootTested: false, geodeLoaded: false, existingGeodePackagesSupported: false
  };
}
