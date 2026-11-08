const {chromium} = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
  const out = 'test-results/clicksounds'; fs.mkdirSync(out, {recursive: true});
  const browser = await chromium.launch({headless: true, args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required']});
  const page = await browser.newPage({viewport: {width: 1280, height: 800}, hasTouch: true});
  const report = {status: 'RUNNING', errors: []}; page.on('pageerror', e => report.errors.push(String(e)));
  const state = () => page.evaluate(() => GDClickSounds.getState());
  const waitPress = n => page.waitForFunction(n => GDClickSounds.getState().stats.press > n, n);
  try {
    await page.goto('http://127.0.0.1:8765/index.html?quality=low', {waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => window.__gdInputReady && window.GDClickSounds && Module._gd_frames_get() > 60, {}, {timeout: 240000});
    await page.locator('#jb-toggle').click();
    assert(await page.locator('#gd-mod-menu').isVisible());
    await page.locator('#mod-clicksounds').click();
    assert(await page.locator('#cs-panel').isVisible()); assert(await page.locator('#jb-panel').isHidden());
    await page.locator('#cs-enabled').check();
    await page.waitForFunction(() => GDClickSounds.getState().loaded && GDClickSounds.getState().settings.enabled);
    await page.locator('#cs-press').selectOption('2'); await page.locator('#cs-release').selectOption('3');
    await page.locator('#cs-volume').fill('37');
    await page.locator('#cs-preview-press').click();
    await page.waitForFunction(() => GDClickSounds.getState().stats.preview > 0);
    report.preview = await state();
    assert.equal(report.preview.stats.last.sample, 2); assert.equal(report.preview.stats.last.context, 'running'); assert(report.preview.stats.last.duration > 0); assert(Math.abs(report.preview.stats.last.gain - 0.37) < 0.000001);
    await page.screenshot({path: out + '/desktop.png'});
    // Switching through the dropdown closes the other tool and UI typing is silent.
    await page.locator('#jb-toggle').click(); await page.locator('#mod-jukebox').click();
    assert(await page.locator('#cs-panel').isHidden());
    const beforeTyping = await state(); await page.locator('#jb-song-id').fill('1323633'); await page.keyboard.press('Space');
    assert.equal((await state()).stats.press, beforeTyping.stats.press);
    await page.keyboard.press('Escape');
    await page.locator('#canvas').focus();
    let before = await state(); await page.keyboard.down('Space'); await waitPress(before.stats.press);
    await page.keyboard.down('Space'); assert.equal((await state()).stats.press, before.stats.press + 1);
    await page.keyboard.up('Space'); report.keyboard = await state();
    assert.equal(report.keyboard.stats.release, before.stats.release + 1); assert.equal(report.keyboard.stats.last.sample, 3);
    // The game's own virtual keyboard and pointer handlers feed the same queue.
    before = await state(); await page.evaluate(() => {Module.gdVirtualKey('ArrowUp', 'ArrowUp', 38, true, false); Module.gdVirtualKey('ArrowUp', 'ArrowUp', 38, false, false);}); await waitPress(before.stats.press);
    const box = await page.locator('#canvas').boundingBox();
    before = await state(); await page.mouse.click(box.x + 100, box.y + 100); await waitPress(before.stats.press);
    before = await state(); await page.touchscreen.tap(box.x + 120, box.y + 120); await waitPress(before.stats.press);
    report.inputs = await state();
    await page.keyboard.press('F2'); await page.locator('#mod-clicksounds').click();
    await page.locator('#cs-releases').uncheck(); await page.locator('#cs-close').click();
    await page.locator('#canvas').focus(); before = await state(); await page.keyboard.press('Space'); await waitPress(before.stats.press); assert.equal((await state()).stats.release, before.stats.release);
    await page.keyboard.press('F2'); await page.locator('#mod-clicksounds').click(); await page.locator('#cs-enabled').uncheck(); await page.locator('#cs-close').click();
    await page.locator('#canvas').focus(); before = await state(); await page.keyboard.press('Space'); assert.equal((await state()).stats.press, before.stats.press);
    await page.keyboard.press('F2'); await page.locator('#mod-clicksounds').click();
    await page.setViewportSize({width: 390, height: 844}); const panel = await page.locator('#cs-panel').boundingBox(); assert(panel.x >= 0 && panel.x + panel.width <= 390); await page.screenshot({path: out + '/mobile.png'});
    await page.reload({waitUntil: 'domcontentloaded'}); await page.waitForFunction(() => window.__gdInputReady && window.GDClickSounds, {}, {timeout: 240000});
    await page.locator('#jb-toggle').click(); await page.locator('#mod-clicksounds').click();
    report.persisted = await state(); assert.equal(report.persisted.settings.volume, 37); assert.equal(report.persisted.settings.press, '2'); assert.equal(report.persisted.settings.release, '3'); assert.equal(report.persisted.settings.enabled, false); assert.equal(report.persisted.settings.releases, false);
    // Import actual WAV files through the file pickers, then verify playback,
    // rejection of invalid audio, persisted bytes and durable removal.
    await page.waitForFunction(() => GDClickSounds.getState().loaded);
    await page.locator('#cs-import-press').setInputFiles({name: 'my-press.wav', mimeType: 'audio/wav', buffer: fs.readFileSync('mods/clicksounds/Clicks/4.wav')});
    await page.waitForFunction(() => GDClickSounds.getState().settings.press === 'custom');
    await page.locator('#cs-import-release').setInputFiles({name: 'my-release.wav', mimeType: 'audio/wav', buffer: fs.readFileSync('mods/clicksounds/Releases/5.wav')});
    await page.waitForFunction(() => GDClickSounds.getState().settings.release === 'custom');
    await page.locator('#cs-preview-press').click();
    await page.waitForFunction(() => GDClickSounds.getState().stats.last?.filename === 'my-press.wav');
    report.importPreview = await state(); assert.equal(report.importPreview.stats.last.sample, 'custom');
    await page.locator('#cs-import-press').setInputFiles({name: 'broken.wav', mimeType: 'audio/wav', buffer: Buffer.from('invalid audio')});
    await page.waitForFunction(() => document.querySelector('#cs-status').textContent.includes('could not be decoded'));
    assert.equal((await state()).imports.press.name, 'my-press.wav');
    await page.locator('#cs-enabled').check(); await page.locator('#cs-releases').check();
    await page.waitForFunction(() => GDClickSounds.getState().settings.enabled);
    await page.locator('#cs-close').click(); await page.locator('#canvas').focus();
    await page.keyboard.down('Space'); assert.equal((await state()).stats.last.filename, 'my-press.wav');
    await page.keyboard.up('Space'); assert.equal((await state()).stats.last.filename, 'my-release.wav');
    await page.reload({waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => window.GDClickSounds?.getState().loaded && window.__gdInputReady, {}, {timeout: 240000});
    report.importsReloaded = await state(); assert.equal(report.importsReloaded.settings.press, 'custom'); assert.equal(report.importsReloaded.imports.press.name, 'my-press.wav'); assert.equal(report.importsReloaded.imports.release.name, 'my-release.wav');
    await page.locator('#jb-toggle').click(); await page.locator('#mod-clicksounds').click();
    await page.locator('#cs-press').selectOption('2'); await page.locator('#cs-preview-press').click();
    await page.waitForFunction(() => GDClickSounds.getState().stats.last?.sample === 2);
    await page.locator('#cs-remove-press').click(); await page.locator('#cs-remove-release').click();
    await page.waitForFunction(() => !GDClickSounds.getState().imports.press && !GDClickSounds.getState().imports.release);
    await page.screenshot({path: out + '/import-mobile.png'});
    await page.reload({waitUntil: 'domcontentloaded'}); await page.waitForFunction(() => window.GDClickSounds?.getState().loaded, {}, {timeout: 240000});
    report.importsRemoved = await state(); assert.deepEqual(report.importsRemoved.imports, {}); assert.equal(report.importsRemoved.settings.press, '2'); assert.equal(report.importsRemoved.settings.release, 'random');
    const frames = await page.evaluate(() => Module._gd_frames_get()); await page.waitForFunction(n => Module._gd_frames_get() > n + 30, frames); report.framesAfter = await page.evaluate(() => Module._gd_frames_get());
    assert.deepEqual(report.errors, []); report.status = 'CLICK_SOUNDS_DROPDOWN_PASS';
  } catch (e) {report.status = 'FAIL'; report.error = String(e); report.stack = e.stack; report.state = await state().catch(() => null); await page.screenshot({path: out + '/failure.png'}).catch(() => {}); process.exitCode = 1;}
  finally {fs.writeFileSync(out + '/result.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); await browser.close();}
})();

