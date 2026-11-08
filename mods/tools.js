/* Browser adapters: shared dropdown and original Click Sounds default samples. */
(() => {
  'use strict';
  const base = new URL('.', document.currentScript.src);
  const defaults = {enabled: false, releases: true, volume: 50, press: 'random', release: 'random'};
  let settings;
  try { settings = {...defaults, ...JSON.parse(localStorage.getItem('gd-clicksounds') || '{}')}; } catch (_) { settings = {...defaults}; }
  settings.volume = Math.max(0, Math.min(100, Number(settings.volume) || 0));
  for (const key of ['press', 'release']) if (!/^(random|custom|[1-9]|10)$/.test(settings[key])) settings[key] = 'random';
  const custom = {}, importControls = {};
  const database = new Promise((resolve, reject) => {
    const request = indexedDB.open('gd-clicksounds-audio', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('sounds');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error('Close other game tabs to enable audio imports.'));
  });
  database.catch(() => {});
  async function storage(mode, operation) {
    const db = await database;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sounds', mode), request = operation(tx.objectStore('sounds'));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = tx.onerror = () => reject(tx.error || request.error || Error('Could not save audio.'));
    });
  }
  function renderCustom(key) {
    const controls = importControls[key]; if (!controls) return;
    controls.select.querySelector('[value=custom]')?.remove();
    if (custom[key]) element('option', 'Imported · ' + custom[key].name, controls.select, {value: 'custom'});
    controls.select.value = settings[key];
    controls.name.textContent = custom[key] ? custom[key].name : 'No imported audio.';
    controls.remove.disabled = !custom[key];
  }
  async function importAudio(key, file) {
    if (!file) return;
    if (!file.size || file.size > 16 * 1024 * 1024) throw Error('Choose a non-empty audio file smaller than 16 MB.');
    await prepare();
    const bytes = new Uint8Array(await file.arrayBuffer());
    let buffer;
    try { buffer = await ctx.decodeAudioData(bytes.buffer.slice(0)); }
    catch (_) { throw Error('This file could not be decoded. Try WAV, MP3, OGG or M4A supported by your browser.'); }
    if (!(buffer.duration > 0)) throw Error('The audio file is empty.');
    const record = {key, name: file.name, bytes};
    await storage('readwrite', store => store.put(record, key));
    stop(); custom[key] = {...record, buffer}; settings[key] = 'custom'; save(); renderCustom(key);
    message('Imported ' + key + ' sound: ' + file.name + '. Saved in this browser.');
  }
  let ctx, gain, loading, loaded = false, menu, panel, toggle, status, enabledInput;
  const buffers = {Clicks: [], Releases: []}, held = new Set(), voices = new Set();
  const stats = {press: 0, release: 0, preview: 0, last: null};
  function message(text) { if (status) status.textContent = text; }
  function save() { try { localStorage.setItem('gd-clicksounds', JSON.stringify(settings)); } catch (_) { message('Browser storage unavailable; settings apply to this session.'); } }
  async function prepare() {
    if (!ctx) { ctx = new AudioContext({latencyHint: 'interactive'}); gain = ctx.createGain(); gain.connect(ctx.destination); }
    gain.gain.value = settings.volume / 100;
    if (ctx.state === 'suspended') await ctx.resume();
    if (loaded) return;
    if (!loading) loading = (async () => {
      message('Loading original Click Sounds samples…');
      await Promise.all(['Clicks', 'Releases'].flatMap(kind => Array.from({length: 10}, async (_, index) => {
        const response = await fetch(new URL('clicksounds/' + kind + '/' + (index + 1) + '.wav', base));
        if (!response.ok) throw Error('Could not load sound sample (HTTP ' + response.status + ').');
        buffers[kind][index] = await ctx.decodeAudioData(await response.arrayBuffer());
      })));
      try {
        const records = await storage('readonly', store => store.getAll());
        for (const record of records) {
          if (!['press', 'release'].includes(record.key) || !(record.bytes instanceof Uint8Array)) continue;
          try { custom[record.key] = {...record, buffer: await ctx.decodeAudioData(record.bytes.buffer.slice(0))}; }
          catch (_) { message('Saved import could not be decoded: ' + record.name); }
        }
      } catch (_) { /* Default samples still work when persistent storage is unavailable. */ }
      for (const key of ['press', 'release']) {
        if (settings[key] === 'custom' && !custom[key]) { settings[key] = 'random'; save(); }
        renderCustom(key);
      }
      loaded = true; message('Ready. Sounds play on game jump controls, including menus.');
    })().finally(() => { loading = null; });
    await loading;
  }
  function stop() { for (const source of voices) { try { source.stop(); } catch (_) {} } voices.clear(); }
  function sound(kind, preview = false) {
    if (!loaded || ctx.state !== 'running' || (!preview && !settings.enabled)) return;
    if (kind === 'Releases' && !preview && !settings.releases) return;
    if (settings.volume === 0) return;
    const key = kind === 'Clicks' ? 'press' : 'release', choice = settings[key];
    const imported = choice === 'custom' ? custom[key] : null;
    const index = choice === 'random' || choice === 'custom' ? Math.floor(Math.random() * 10) : Number(choice) - 1;
    if (voices.size >= 32) { const oldest = voices.values().next().value; oldest.stop(); voices.delete(oldest); }
    const source = ctx.createBufferSource(); source.buffer = imported ? imported.buffer : buffers[kind][index]; source.connect(gain);
    source.onended = () => { voices.delete(source); source.disconnect(); };
    source.start(); voices.add(source);
    stats[preview ? 'preview' : kind === 'Clicks' ? 'press' : 'release']++;
    stats.last = {kind, sample: imported ? 'custom' : index + 1, filename: imported?.name, duration: source.buffer.duration, context: ctx.state, gain: gain.gain.value};
  }
  function input(event) {
    const [msg, key, lp] = event;
    let token, down;
    if ((msg === 0x100 || msg === 0x101) && [32, 38, 87].includes(key)) { token = 'key:' + key; down = msg === 0x100; if (down && (lp & 0x40000000)) return; }
    else if (msg === 0x201 || msg === 0x202) { token = 'pointer'; down = msg === 0x201; }
    else return;
    if (down) {
      if (held.has(token)) return;
      held.add(token);
      if (settings.enabled) { if (ctx?.state === 'suspended') ctx.resume().catch(() => {}); sound('Clicks'); }
    } else if (held.delete(token)) sound('Releases');
  }
  function attach() {
    const queue = window.Module?.gdInputQueue; if (!queue) return false;
    const push = queue.push;
    queue.push = function (...events) {
      const result = push.apply(this, events);
      for (const event of events) { try { input(event); } catch (error) { message(error.message); } }
      return result;
    };
    return true;
  }
  const timer = setInterval(() => { if (attach()) clearInterval(timer); }, 100);
  window.addEventListener('blur', () => { held.clear(); stop(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { held.clear(); stop(); } });
  function element(tag, text, parent, attrs = {}) {
    const node = document.createElement(tag); if (text != null) node.textContent = text;
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    parent?.append(node); return node;
  }
  function hideMenu() { if (menu) menu.hidden = true; toggle?.setAttribute('aria-expanded', 'false'); }
  function close() { if (panel) panel.hidden = true; }
  function hideAll() { hideMenu(); close(); window.GDJukebox?.close(); }
  function toggleMenu() { const opening = menu?.hidden; hideAll(); if (opening) { menu.hidden = false; toggle.setAttribute('aria-expanded', 'true'); menu.querySelector('button').focus(); } }
  function select(name) {
    hideAll();
    if (name === 'jukebox') window.GDJukebox.open();
    else { panel.hidden = false; enabledInput.focus(); prepare().catch(error => message(error.message)); }
  }
  let escapeHeld = false;
  for (const name of ['keydown', 'keyup', 'keypress']) window.addEventListener(name, event => {
    if (event.code === 'Escape' && escapeHeld) { event.preventDefault(); event.stopImmediatePropagation(); if (name === 'keyup') escapeHeld = false; return; }
    if ((panel && !panel.hidden && panel.contains(event.target)) || (menu && !menu.hidden)) {
      event.stopImmediatePropagation();
      if (event.code === 'Escape') { event.preventDefault(); if (name === 'keydown') { escapeHeld = true; hideAll(); toggle.focus(); } }
      if (menu && !menu.hidden && name === 'keydown' && ['ArrowDown', 'ArrowUp'].includes(event.code)) {
        event.preventDefault(); const items = [...menu.querySelectorAll('button')], i = items.indexOf(document.activeElement);
        items[(i + (event.code === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
      }
    }
  }, true);
  document.addEventListener('pointerdown', event => { if (menu && !menu.hidden && !menu.contains(event.target) && !toggle.contains(event.target)) hideMenu(); }, true);
  window.GDModMenu = {toggle: toggleMenu, select, close: hideAll};
  window.GDClickSounds = {getState: () => ({settings: {...settings}, loaded, context: ctx?.state, stats: structuredClone(stats), voices: voices.size,
    imports: Object.fromEntries(Object.entries(custom).map(([key, value]) => [key, {name: value.name, duration: value.buffer.duration, bytes: value.bytes.length}]))})};
  function mount() {
    toggle = document.getElementById('jb-toggle'); toggle.textContent = 'Mods ▾';
    toggle.setAttribute('aria-controls', 'gd-mod-menu'); toggle.setAttribute('aria-expanded', 'false');
    const style = element('style', null, document.head);
    style.textContent = `#gd-mod-menu,#cs-panel{box-sizing:border-box;position:fixed;right:14px;bottom:66px;z-index:10012;color:#f5f7ff;background:#152037;border:1px solid #667da8;border-radius:14px;padding:16px;font:14px system-ui,sans-serif;box-shadow:0 16px 60px #0009}#gd-mod-menu{width:220px;padding:8px}#gd-mod-menu[hidden],#cs-panel[hidden]{display:none}#gd-mod-menu button{display:block;width:100%;text-align:left;margin:0;border:0;background:transparent;padding:12px;color:inherit;font:inherit;border-radius:8px;cursor:pointer}#gd-mod-menu button:hover,#gd-mod-menu button:focus{background:#304568}#cs-panel{width:min(400px,calc(100vw - 28px));max-height:calc(100dvh - 88px);overflow:auto;padding:20px}#cs-panel h2{margin:0 0 14px;font-size:22px}#cs-panel p{line-height:1.5;color:#c5d0e6}#cs-panel label{display:block;margin:14px 0}#cs-panel select,#cs-panel button{font:inherit;color:inherit;background:#253751;border:1px solid #60759b;border-radius:8px;padding:9px 11px}#cs-panel select{display:block;width:100%;margin-top:6px}#cs-panel input[type=range]{width:100%;margin-top:10px;accent-color:#9bc5ff}#cs-panel input[type=checkbox]{accent-color:#9bc5ff}#cs-close{float:right}#cs-panel a{color:#adceff}#cs-status{font-size:13px;min-height:36px}`;
    menu = element('nav', null, document.body, {id: 'gd-mod-menu', hidden: '', 'data-west-ui': '', 'aria-label': 'Mods'});
    for (const [id, label] of [['jukebox', 'Jukebox'], ['clicksounds', 'Click Sounds']]) element('button', label, menu, {id: 'mod-' + id, type: 'button'}).addEventListener('click', () => select(id));
    panel = element('section', null, document.body, {id: 'cs-panel', hidden: '', 'data-west-ui': '', 'aria-label': 'Click Sounds settings'});
    element('button', 'Close', panel, {id: 'cs-close', type: 'button'}).addEventListener('click', () => {close(); toggle.focus();});
    element('h2', 'Click Sounds', panel);
    const enabledLabel = element('label', null, panel); enabledInput = element('input', null, enabledLabel, {id: 'cs-enabled', type: 'checkbox'}); enabledInput.checked = !!settings.enabled; enabledLabel.append(' Enable click sounds');
    enabledInput.addEventListener('change', async () => {
      const requested = enabledInput.checked; settings.enabled = false; stop();
      if (requested) { enabledInput.disabled = true; try { await prepare(); settings.enabled = true; } catch (error) { message(error.message); enabledInput.checked = false; } finally {enabledInput.disabled = false;} }
      save();
    });
    const releaseLabel = element('label', null, panel), releases = element('input', null, releaseLabel, {id: 'cs-releases', type: 'checkbox'}); releases.checked = !!settings.releases; releaseLabel.append(' Play release sounds');
    releases.addEventListener('change', () => {settings.releases = releases.checked; save();});
    const volumeLabel = element('label', null, panel); const volumeText = element('span', 'Volume: ' + settings.volume + '%', volumeLabel);
    const volume = element('input', null, volumeLabel, {id: 'cs-volume', type: 'range', min: '0', max: '100', value: settings.volume});
    volume.addEventListener('input', () => {settings.volume = Number(volume.value); volumeText.textContent = 'Volume: ' + settings.volume + '%'; if (gain) gain.gain.value = settings.volume / 100; save();});
    for (const [key, title, kind] of [['press', 'Press sound', 'Clicks'], ['release', 'Release sound', 'Releases']]) {
      const label = element('label', title, panel), select = element('select', null, label, {id: 'cs-' + key});
      element('option', 'Default pack · random sample', select, {value: 'random'});
      for (let i = 1; i <= 10; i++) element('option', 'Default pack · sample ' + i, select, {value: i});
      select.value = settings[key]; select.addEventListener('change', () => {settings[key] = select.value; save();});
      const fileLabel = element('label', 'Import ' + key + ' audio', panel);
      const file = element('input', null, fileLabel, {id: 'cs-import-' + key, type: 'file', accept: 'audio/*,.wav,.mp3,.ogg,.m4a,.flac', 'aria-label': 'Import ' + key + ' audio'});
      file.style.cssText = 'display:block;width:100%;margin-top:8px';
      const name = element('p', 'No imported audio.', panel); name.style.overflowWrap = 'anywhere';
      const remove = element('button', 'Remove imported ' + key, panel, {id: 'cs-remove-' + key, type: 'button'});
      importControls[key] = {select, name, remove}; renderCustom(key);
      file.addEventListener('change', async () => {
        file.disabled = true;
        try { await importAudio(key, file.files[0]); } catch (error) { message(error.message); }
        finally {file.value = ''; file.disabled = false;}
      });
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        try {
          await storage('readwrite', store => store.delete(key)); stop(); delete custom[key];
          if (settings[key] === 'custom') settings[key] = 'random';
          save(); renderCustom(key); message('Imported ' + key + ' removed.');
        } catch (error) {message(error.message); remove.disabled = false;}
      });
      element('button', 'Preview ' + key, panel, {id: 'cs-preview-' + key, type: 'button'}).addEventListener('click', async () => {try {await prepare(); sound(kind, true);} catch (error) {message(error.message);}});
    }
    status = element('p', 'Open a preview or enable sounds to load the default pack.', panel, {id: 'cs-status', role: 'status', 'aria-live': 'polite'});
    const credit = element('p', 'Original default samples: Click Sounds / yesimapotato’s sayo pink switches. ', panel);
    element('a', 'Source & license', credit, {href: 'https://github.com/clicksounds/geode-clicksound', target: '_blank', rel: 'noopener'});
    if (settings.enabled) prepare().catch(error => {settings.enabled = false; enabledInput.checked = false; message(error.message);});
    document.addEventListener('pointerdown', () => {if (ctx?.state === 'suspended') ctx.resume().catch(() => {});}, {capture: true});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once: true}); else mount();
})();

