// Real game + public SFH index + real MP3. No network mocks or dummy audio.
const {chromium} = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
  fs.mkdirSync('test-results/jukebox', {recursive: true});
  const browser = await chromium.launch({headless: true, args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required']});
  const page = await browser.newPage({viewport: {width: 1280, height: 800}});
  const report = {status: 'RUNNING', errors: []};
  // The untouched first-run terms dialog does not start menu music. Exercise
  // the game's own FMOD bridge without relying on coordinates or accepting terms.
  const menuAudio = async play => {
    await page.evaluate(({filename, play}) => {
      if (!Module.__gdAudio) gd_js_audio(0, 0, 0, 0, 0);
      const engine = Module.__gdAudio;
      let sound = Object.values(engine.sounds).find(sound => String(sound.path || sound.name || '').replace(/\\/g, '/').split('/').pop() === filename);
      if (!sound) sound = engine.sounds[engine.soundNew('/Resources/' + filename, true)];
      window.__jbProbeSound = sound.id;
      if (play) window.__jbProbeChannel = engine.play(sound.id, 0, false);
    }, {filename: report.baseline.filename, play});
    await page.waitForFunction(() => Module.__gdAudio.sounds[window.__jbProbeSound]?.state === 1, {}, {timeout: 30000});
  };
  page.on('pageerror', error => report.errors.push(String(error)));
  try {
    await page.goto('http://127.0.0.1:8765/index.html?quality=low', {waitUntil: 'domcontentloaded', timeout: 60000});
    await page.waitForFunction(() => window.__gdRuntimeReady && window.__gdSavesRestored && window.Module?._gd_frames_get?.() > 60 && window.GDJukebox, {}, {timeout: 240000});
    await page.evaluate(() => GDJukebox.ready);
    report.framesBefore = await page.evaluate(() => Module._gd_frames_get());
    report.baseline = await page.evaluate(async () => {
      const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
      const dir = '/Resources', names = Module.FS.readdir(dir).filter(name => /\.mp3$/i.test(name));
      const filename = names.includes('menuLoop.mp3') ? 'menuLoop.mp3' : names.find(name => !/^\d+\.mp3$/.test(name));
      if (!filename) throw Error('No built-in song available for original restoration check');
      return {filename, sha256: await hash(Module.FS.readFile(dir + '/' + filename))};
    });
    await menuAudio(true);
    report.gameAudioBefore = await page.evaluate(() => Object.values(Module.__gdAudio.sounds).filter(sound => /menuLoop\.mp3$/.test(sound.path || sound.name)).map(sound => ({id: sound.id, path: sound.path || sound.name, duration: sound.buf?.duration})));
    await page.locator('#jb-toggle').click();
    await page.locator('#mod-jukebox').click();
    await page.locator('#jb-song-id').fill('1323633');
    await page.locator('#jb-panel button[type=submit]').click();
    const row = page.locator('#jb-results [data-key="6ad1c23ecc40bb69f37264f9"]');
    await row.waitFor({timeout: 120000});
    report.server = await row.innerText();
    // Exercise both the real built-in song path and the usual custom-song-ID path.
    await page.locator('#jb-target').selectOption(report.baseline.filename);
    // A failed direct download must leave the current song alone and allow retry,
    // even when the game is configured with a proxy that produces invalid URLs.
    const priorProxies = await page.evaluate(() => {
      const previous = window.__gdProxyBases;
      window.__gdProxyBases = ['https://proxy.invalid'];
      return previous;
    });
    await page.route('https://api.songfilehub.com/song/6ad1c23ecc40bb69f37264f9?*', route => route.abort('failed'), {times: 1});
    await row.getByRole('button', {name: 'Download & use'}).click();
    await page.waitForFunction(() => document.querySelector('#jb-status').textContent.includes('Could not reach the song server') && !GDJukebox.getState().busy);
    assert.equal((await page.evaluate(() => GDJukebox.getState())).active.length, 0);
    await page.evaluate(proxies => { window.__gdProxyBases = proxies; }, priorProxies);
    await row.getByRole('button', {name: 'Download & use'}).click();
    await page.waitForFunction(() => !GDJukebox.getState().busy && GDJukebox.getState().active.length === 1, {}, {timeout: 120000});
    report.first = await page.evaluate(() => GDJukebox.getState());
    assert(report.first.active[0].byteLength > 100000);
    assert(report.first.active[0].duration > 1);
    await page.waitForFunction(() => {
      const engine = Module.__gdAudio;
      return Object.values(engine.channels).some(channel => /menuLoop\.mp3$/.test(engine.sounds[channel.sound]?.path || engine.sounds[channel.sound]?.name) && channel.src?.buffer.duration > 109 && channel.src?.buffer.duration < 110);
    }, {}, {timeout: 30000});
    report.gamePlayback = await page.evaluate(() => {
      const engine = Module.__gdAudio;
      return Object.values(engine.channels).filter(channel => /menuLoop\.mp3$/.test(engine.sounds[channel.sound]?.path || engine.sounds[channel.sound]?.name) && channel.src).map(channel => ({sound: channel.sound, duration: channel.src.buffer.duration, usesUpdatedBuffer: channel.src.buffer === engine.sounds[channel.sound].buf, context: engine.ctx.state}));
    });
    assert(report.gamePlayback.some(channel => channel.usesUpdatedBuffer && channel.context === 'running'));
    report.routing = await page.evaluate(async filename => {
      const path = '/Resources/' + filename, expected = Module.FS.readFile(path);
      const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
      const fetched = new Uint8Array(await (await fetch('https://example.invalid/game/' + filename)).arrayBuffer());
      const xhr = await new Promise((resolve, reject) => {
        const request = new XMLHttpRequest(); request.open('GET', 'https://example.invalid/game/' + filename);
        request.responseType = 'arraybuffer'; request.onload = () => resolve(new Uint8Array(request.response)); request.onerror = reject; request.send();
      });
      return {expected: await hash(expected), fetch: await hash(fetched), xhr: await hash(xhr), bytes: expected.length};
    }, report.baseline.filename);
    assert.equal(report.routing.fetch, report.routing.expected);
    assert.equal(report.routing.xhr, report.routing.expected);
    assert.notEqual(report.routing.expected, report.baseline.sha256);
    await page.locator('#jb-active button').filter({hasText: /^Preview$/}).click();
    await page.waitForFunction(() => {const audio = document.querySelector('#jb-panel audio'); return !audio.paused && audio.currentTime > 0.1;}, {}, {timeout: 30000});
    report.preview = await page.locator('#jb-panel audio').evaluate(audio => ({duration: audio.duration, currentTime: audio.currentTime, error: audio.error?.message || null}));
    await page.screenshot({path: 'test-results/jukebox/desktop.png'});
    await page.setViewportSize({width: 390, height: 844});
    report.mobile = await page.locator('#jb-panel').boundingBox();
    assert(report.mobile.x >= 0 && report.mobile.x + report.mobile.width <= 390);
    await page.screenshot({path: 'test-results/jukebox/mobile.png'});
    await page.setViewportSize({width: 1280, height: 800});
    await page.reload({waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => window.GDJukebox && window.__gdRuntimeReady && window.__gdSavesRestored, {}, {timeout: 240000});
    await page.evaluate(() => GDJukebox.ready);
    await menuAudio(false);
    report.reloaded = await page.evaluate(() => GDJukebox.getState());
    assert.equal(report.reloaded.active[0].key, '6ad1c23ecc40bb69f37264f9');
    await page.locator('#jb-toggle').click();
    await page.locator('#mod-jukebox').click();
    await page.getByRole('button', {name: 'Restore original'}).click();
    await page.waitForFunction(() => !GDJukebox.getState().busy && GDJukebox.getState().active.length === 0);
    report.originalRestored = await page.evaluate(async filename => {
      const bytes = Module.FS.readFile('/Resources/' + filename);
      return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
    }, report.baseline.filename);
    assert.equal(report.originalRestored, report.baseline.sha256);
    report.gameAudioRestored = await page.evaluate(() => Object.values(Module.__gdAudio.sounds).filter(sound => /menuLoop\.mp3$/.test(sound.path || sound.name)).map(sound => ({id: sound.id, duration: sound.buf?.duration})));
    assert.equal(report.gameAudioRestored[0].duration, report.gameAudioBefore[0].duration);
    // Cached index + ordinary song-ID activation. This is still the real server MP3.
    await page.locator('#jb-song-id').fill('1323633');
    await page.locator('#jb-panel button[type=submit]').click();
    await page.locator('#jb-results [data-key="6ad1c23ecc40bb69f37264f9"] button').click();
    await page.waitForFunction(() => !GDJukebox.getState().busy && GDJukebox.getState().active.some(song => song.filename === '1323633.mp3'), {}, {timeout: 120000});
    report.custom = await page.evaluate(() => GDJukebox.getState());
    report.originalPathRouting = await page.evaluate(async filename => {
      const engine = Module.__gdAudio, originalPath = '/AppData/1323633.mp3';
      Module.FS.mkdirTree('/AppData');
      const existed = Module.FS.analyzePath(originalPath).exists, original = existed ? Module.FS.readFile(originalPath).slice() : null;
      Module.FS.writeFile(originalPath, Module.FS.readFile('/Resources/' + filename));
      const id = engine.soundNew(originalPath, true);
      await new Promise((resolve, reject) => {const start = Date.now(); const timer = setInterval(() => {if (engine.sounds[id].state !== 0) {clearInterval(timer); resolve();} else if (Date.now() - start > 30000) {clearInterval(timer); reject(Error('Game decoder timed out'));}}, 50);});
      const sound = engine.sounds[id], result = {duration: sound.buf?.duration, state: sound.state, path: sound.path};
      delete engine.sounds[id];
      if (original) Module.FS.writeFile(originalPath, original); else Module.FS.unlink(originalPath);
      return result;
    }, report.baseline.filename);
    assert.equal(report.originalPathRouting.state, 1);
    assert(Math.abs(report.originalPathRouting.duration - report.custom.active[0].duration) < 0.001);
    report.memoryAudioRouting = await page.evaluate(async filename => {
      const original = Module.FS.readFile('/Resources/' + filename), name = new TextEncoder().encode('/AppData/1323633.mp3\0');
      const dataPointer = Module._malloc(original.length), namePointer = Module._malloc(name.length);
      let id;
      try {
        Module.HEAPU8.set(original, dataPointer); Module.HEAPU8.set(name, namePointer);
        id = gd_js_audio_sound_data(dataPointer, original.length, namePointer);
      } finally {Module._free(dataPointer); Module._free(namePointer);}
      const engine = Module.__gdAudio;
      await new Promise((resolve, reject) => {const start = Date.now(); const timer = setInterval(() => {if (engine.sounds[id]?.state !== 0) {clearInterval(timer); resolve();} else if (Date.now() - start > 30000) {clearInterval(timer); reject(Error('Game memory audio decoder timed out'));}}, 50);});
      const sound = engine.sounds[id], result = {duration: sound?.buf?.duration, state: sound?.state, name: sound?.name, storedBytesIntact: GDJukebox.getState().active[0].byteLength > 100000};
      delete engine.sounds[id]; return result;
    }, report.baseline.filename);
    assert.equal(report.memoryAudioRouting.state, 1);
    assert(Math.abs(report.memoryAudioRouting.duration - report.custom.active[0].duration) < 0.001);
    assert(report.memoryAudioRouting.storedBytesIntact);
    await page.getByRole('button', {name: 'Restore original'}).click();
    await page.waitForFunction(() => !GDJukebox.getState().busy && !GDJukebox.getState().active.length);
    // Typed IDs do not enter the game's keyboard queue; Escape is isolated too.
    await page.locator('#jb-song-id').focus();
    await page.keyboard.press('Escape');
    assert(await page.locator('#jb-panel').isHidden());
    await page.keyboard.press('F2');
    assert(await page.locator('#gd-mod-menu').isVisible());
    await page.locator('#mod-jukebox').click();
    assert(await page.locator('#jb-panel').isVisible());
    await page.keyboard.press('F2');
    assert(await page.locator('#jb-panel').isHidden());
    assert(await page.locator('#gd-mod-menu').isVisible());
    await page.keyboard.press('Escape');
    const before = await page.evaluate(() => Module._gd_frames_get());
    await page.waitForFunction(n => Module._gd_frames_get() > n + 30, before);
    report.framesAfter = await page.evaluate(() => Module._gd_frames_get());
    report.status = 'JUKEBOX_SERVER_REPLACEMENT_PASS';
  } catch (error) {
    report.status = 'FAIL'; report.error = String(error); report.stack = error.stack;
    report.uiStatus = await page.locator('#jb-status').textContent().catch(() => 'missing');
    await page.screenshot({path: 'test-results/jukebox/failure.png'}).catch(() => {});
    process.exitCode = 1;
  } finally {
    fs.writeFileSync('test-results/jukebox/result.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2)); await browser.close();
  }
})();



