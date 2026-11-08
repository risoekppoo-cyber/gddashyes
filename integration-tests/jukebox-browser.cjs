// Real game + public SFH index + real MP3. No network mocks or dummy audio.
const {chromium} = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
  fs.mkdirSync('test-results/jukebox', {recursive: true});
  const browser = await chromium.launch({headless: true, args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required']});
  const page = await browser.newPage({viewport: {width: 1280, height: 800}});
  const report = {status: 'RUNNING', errors: []};
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
    await page.locator('#jb-toggle').click();
    await page.locator('#jb-song-id').fill('1323633');
    await page.locator('#jb-panel button[type=submit]').click();
    const row = page.locator('#jb-results [data-key="6ad1c23ecc40bb69f37264f9"]');
    await row.waitFor({timeout: 120000});
    report.server = await row.innerText();
    // Exercise both the real built-in song path and the usual custom-song-ID path.
    await page.locator('#jb-target').selectOption(report.baseline.filename);
    await row.getByRole('button', {name: 'Download & use'}).click();
    await page.waitForFunction(() => !GDJukebox.getState().busy && GDJukebox.getState().active.length === 1, {}, {timeout: 120000});
    report.first = await page.evaluate(() => GDJukebox.getState());
    assert(report.first.active[0].byteLength > 100000);
    assert(report.first.active[0].duration > 1);
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
    report.reloaded = await page.evaluate(() => GDJukebox.getState());
    assert.equal(report.reloaded.active[0].key, '6ad1c23ecc40bb69f37264f9');
    await page.locator('#jb-toggle').click();
    await page.getByRole('button', {name: 'Restore original'}).click();
    await page.waitForFunction(() => !GDJukebox.getState().busy && GDJukebox.getState().active.length === 0);
    report.originalRestored = await page.evaluate(async filename => {
      const bytes = Module.FS.readFile('/Resources/' + filename);
      return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
    }, report.baseline.filename);
    assert.equal(report.originalRestored, report.baseline.sha256);
    // Cached index + ordinary song-ID activation. This is still the real server MP3.
    await page.locator('#jb-song-id').fill('1323633');
    await page.locator('#jb-panel button[type=submit]').click();
    await page.locator('#jb-results [data-key="6ad1c23ecc40bb69f37264f9"] button').click();
    await page.waitForFunction(() => !GDJukebox.getState().busy && GDJukebox.getState().active.some(song => song.filename === '1323633.mp3'), {}, {timeout: 120000});
    report.custom = await page.evaluate(() => GDJukebox.getState());
    await page.getByRole('button', {name: 'Restore original'}).click();
    await page.waitForFunction(() => !GDJukebox.getState().busy && !GDJukebox.getState().active.length);
    // Typed IDs do not enter the game's keyboard queue; Escape is isolated too.
    await page.locator('#jb-song-id').focus();
    await page.keyboard.press('Escape');
    assert(await page.locator('#jb-panel').isHidden());
    await page.keyboard.press('F2');
    assert(await page.locator('#jb-panel').isVisible());
    await page.keyboard.press('F2');
    assert(await page.locator('#jb-panel').isHidden());
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
