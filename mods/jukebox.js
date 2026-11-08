/* Browser song replacement using Jukebox's public Song File Hub index. */
(() => {
  'use strict';
  if (window.GDJukebox) return;
  const SOURCE = 'https://raw.githubusercontent.com/FlafyDev/auto-nong-indexes/v2/sfh-index.min.json';
  const MAX_BYTES = 32 * 1024 * 1024;
  // Captured before the launcher's local-MP3 fetch override is installed.
  const networkFetch = window.fetch.bind(window);
  let panel, status, results, activeList, target, field, busy = false, catalog, catalogPromise;
  let previewURL, currentSearch = 0;
  const originals = new Map(), active = new Map();
  let audioAdapter;
  const dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('gd-browser-jukebox', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('data');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error('Close other game tabs to enable song storage.'));
  });
  // Attach a rejection handler immediately; operations still surface storage errors.
  dbPromise.catch(() => {});
  async function db(mode, action) {
    const database = await dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('data', mode);
      const request = action(transaction.objectStore('data'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () => reject(transaction.error || request.error || Error('Song storage failed.'));
    });
  }
  const read = key => db('readonly', store => store.get(key));
  const write = (key, value) => db('readwrite', store => store.put(value, key));
  const remove = key => db('readwrite', store => store.delete(key));
  const ready = new Promise(resolve => {
    const timer = setInterval(() => {
      if (!window.__gdRuntimeReady || !window.__gdSavesRestored || !window.Module?.FS) return;
      clearInterval(timer); resolve(window.Module.FS);
    }, 200);
  });
  const equal = (a, b) => a?.length === b?.length && a.every((byte, i) => byte === b[i]);
  const pathFor = name => {
    if (!/^[a-zA-Z0-9_ .-]{1,90}\.mp3$/.test(name) || name.includes('..')) throw Error('Invalid game song filename.');
    return '/Resources/' + name;
  };
  function songID(value) {
    if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > 2147483647) throw Error('Enter the song ID shown on the level, not the level ID.');
    return Number(value);
  }
  function message(value) { if (status) status.textContent = value; }
  async function run(task) {
    if (busy) return;
    busy = true; panel?.setAttribute('aria-busy', 'true');
    panel?.querySelectorAll('button[data-action]').forEach(button => { button.disabled = true; });
    try { return await task(); }
    catch (error) { message(error.name === 'AbortError' ? 'Request timed out. Try again.' : error.message); }
    finally {
      busy = false; panel?.removeAttribute('aria-busy');
      panel?.querySelectorAll('button[data-action]').forEach(button => { button.disabled = button.dataset.unsupported === 'true'; });
    }
  }
  async function download(url, label) {
    if (new URL(url).protocol !== 'https:') throw Error('The song server supplied an unsupported URL.');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 90000);
    try {
      const response = await networkFetch(url, {mode: 'cors', credentials: 'omit', signal: controller.signal});
      if (!response.ok) throw Error('Song server returned HTTP ' + response.status + '.');
      const total = Number(response.headers.get('Content-Length'));
      if (total > MAX_BYTES) throw Error('This download exceeds the 32 MB limit.');
      const reader = response.body.getReader(), chunks = []; let length = 0;
      try {
        while (true) {
          const {done, value} = await reader.read(); if (done) break;
          length += value.length;
          if (length > MAX_BYTES) throw Error('This download exceeds the 32 MB limit.');
          chunks.push(value);
          message(label + ' · ' + (total ? Math.round(length / total * 100) + '%' : (length / 1048576).toFixed(1) + ' MB'));
        }
      } finally { await reader.cancel().catch(() => {}); }
      const bytes = new Uint8Array(length); let position = 0;
      for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.length; }
      return bytes;
    } finally { clearTimeout(timer); controller.abort(); }
  }
  async function getCatalog() {
    if (catalog) return catalog;
    if (catalogPromise) return catalogPromise;
    catalogPromise = (async () => {
      let cached;
      try { cached = await read('index'); } catch (_) { /* Network search still works. */ }
      let data = cached?.data;
      if (!data || Date.now() - cached.time > 86400000) {
        try {
          data = JSON.parse(new TextDecoder().decode(await download(SOURCE, 'Connecting to Song File Hub')));
          if (data.manifest !== 1 || !data.nongs?.hosted) throw Error('The server index format has changed.');
          await write('index', {time: Date.now(), data}).catch(() => {});
        } catch (error) {
          if (!cached?.data?.nongs?.hosted) throw error;
          data = cached.data; message('Server unavailable. Using the saved Song File Hub index.');
        }
      }
      catalog = Object.entries(data.nongs.hosted).map(([key, song]) => ({...song, key}));
      return catalog;
    })();
    try { return await catalogPromise; } finally { catalogPromise = null; }
  }
  async function search(value) {
    const id = songID(value), songs = await getCatalog();
    return songs.filter(song => Array.isArray(song.songs) && song.songs.some(value => Number(value) === id) && typeof song.url === 'string' && song.url.startsWith('https://'));
  }
  function fsBytes(fs, path) { return fs.analyzePath(path).exists ? fs.readFile(path).slice() : null; }
  function install(fs, record) {
    const path = pathFor(record.filename), previous = fsBytes(fs, path);
    if (!originals.has(record.filename)) originals.set(record.filename, previous);
    fs.mkdirTree('/Resources'); fs.writeFile(path, record.bytes);
    active.set(record.filename, record);
    return previous;
  }
  function putBack(fs, path, bytes) {
    if (bytes) fs.writeFile(path, bytes);
    else if (fs.analyzePath(path).exists) fs.unlink(path);
  }
  function audioFilename(path) {
    return String(path || '').replace(/\\/g, '/').split(/[?#]/)[0].split('/').pop();
  }
  function attachAudio() {
    const engine = window.Module?.__gdAudio;
    if (!engine || audioAdapter === engine) return !!engine;
    if (typeof engine.soundNew !== 'function' || typeof engine.candidates !== 'function') return false;
    const soundNew = engine.soundNew;
    engine.soundNew = function (path, stream) {
      const record = active.get(audioFilename(path));
      const id = soundNew.call(this, record ? pathFor(record.filename) : path, stream);
      // Retain the game's original path so reverting can find downloaded originals.
      if (this.sounds[id]) this.sounds[id].path = path;
      return id;
    };
    audioAdapter = engine;
    return true;
  }
  // FMOD also hands the browser bytes already read by the guest game. Override
  // that exact decode point so an AppData original cannot shadow the selection.
  const patchLoader = window.WestminsterTitle.patchLoader;
  window.WestminsterTitle.patchLoader = function (code) {
    code = patchLoader.call(this, code);
    const start = code.indexOf('function gd_js_audio_sound_data(p, len, name) {');
    const end = code.indexOf('gd_js_audio_sound_data.sig', start);
    const needle = 'var bytes = HEAPU8.slice(p, end);';
    if (start < 0 || end < start || code.slice(start, end).split(needle).length !== 2) throw Error('The game audio bridge changed; Jukebox needs an update.');
    return code.slice(0, start) + code.slice(start, end).replace(needle,
      'var bytes = window.GDJukebox.audioBytes(s.name) || HEAPU8.slice(p, end);') + code.slice(end);
  };
  async function refreshAudio(filename, decoded) {
    if (!attachAudio()) return;
    const engine = audioAdapter, fs = window.Module.FS;
    const sounds = Object.values(engine.sounds).filter(sound => audioFilename(sound.path || sound.name) === filename);
    if (!sounds.length) return;
    for (const sound of sounds) {
      let audio = decoded;
      if (!audio) {
        const override = active.get(filename), originalPath = String(sound.path || sound.name || filename).replace(/\\/g, '/');
        const candidates = override ? [pathFor(filename)] : [pathFor(filename), ...engine.candidates(originalPath), '/AppData/' + filename];
        let bytes;
        for (const candidate of candidates) {
          try { bytes = fs.readFile(candidate); break; } catch (_) { /* Try the next original path. */ }
        }
        if (!bytes) {
          sound.buf = null; sound.len = 0; sound.state = 2;
          for (const channel of Object.values(engine.channels)) if (channel.sound === sound.id) engine.stopCh(channel);
          continue;
        }
        audio = await engine.ensure().decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      }
      const update = () => {
        if (engine.sounds[sound.id] !== sound) return;
        sound.buf = audio; sound.len = Math.round(audio.duration * 1000); sound.state = 1;
        for (const channel of Object.values(engine.channels)) {
          if (channel.sound !== sound.id || !channel.src || channel.paused || channel.pausedByGroup || channel.ended) continue;
          engine.pauseCh(channel, false); engine.unpauseCh(channel, false);
        }
      };
      // An in-flight original decode must finish before replacing its result.
      if (sound.state === 0) { sound.onready ||= []; sound.onready.unshift(update); }
      else update();
    }
  }
  async function activate(idValue, key, filename) {
    const id = songID(idValue), matches = await search(id), song = matches.find(song => song.key === key);
    if (!song) throw Error('This song is no longer in the server index. Search again.');
    if (Number(song.startOffset || 0) !== 0) throw Error('This entry needs a timing offset. Choose a zero-offset version for now.');
    filename = filename || id + '.mp3'; pathFor(filename);
    message('Downloading ' + song.name);
    const bytes = await download(song.url, 'Downloading ' + song.name);
    message('Checking audio…');
    const decoder = new OfflineAudioContext(2, 1, 44100);
    const audio = await decoder.decodeAudioData(bytes.buffer.slice(0));
    if (!(audio.duration > 0)) throw Error('The server returned empty audio.');
    const record = {id, key, filename, name: String(song.name), artist: String(song.artist || ''), bytes, duration: audio.duration, source: song.url};
    const fs = await ready; await restored;
    const priorRecord = active.get(filename), previous = install(fs, record);
    try { await write('song:' + filename, record); }
    catch (error) {
      putBack(fs, pathFor(filename), previous);
      if (priorRecord) active.set(filename, priorRecord); else active.delete(filename);
      throw Error('Could not save this replacement: ' + error.message);
    }
    await refreshAudio(filename, audio);
    renderActive(); message('Active: ' + record.name + '. Restart the level for the correct start position.');
    return {filename, bytes: bytes.length, duration: audio.duration};
  }
  async function revert(filename) {
    const fs = await ready; await restored;
    const record = active.get(filename);
    if (!record) return;
    const path = pathFor(filename), current = fsBytes(fs, path);
    await remove('song:' + filename);
    // Keep files subsequently changed by the game or another tool.
    if (current && equal(current, record.bytes)) putBack(fs, path, originals.get(filename));
    originals.delete(filename); active.delete(filename); await refreshAudio(filename);
    stopPreview(); renderActive();
    message('Original restored for ' + filename + '. Restart the level.');
  }
  function stopPreview() {
    const player = panel?.querySelector('audio'); if (player) { player.pause(); player.removeAttribute('src'); player.load(); }
    if (previewURL) URL.revokeObjectURL(previewURL); previewURL = null;
  }
  function element(tag, text, parent, attributes = {}) {
    const node = document.createElement(tag); if (text != null) node.textContent = text;
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    parent?.append(node); return node;
  }
  function action(label, parent, handler) {
    const button = element('button', label, parent, {type: 'button', 'data-action': ''});
    button.disabled = busy; button.addEventListener('click', () => run(handler)); return button;
  }
  function renderActive() {
    if (!activeList) return; activeList.replaceChildren();
    element('h3', 'Saved replacements', activeList);
    if (!active.size) element('p', 'No replacement active.', activeList);
    for (const record of active.values()) {
      const row = element('div', null, activeList, {class: 'jb-row', 'data-file': record.filename});
      element('strong', record.name, row); element('small', record.filename + ' · ' + record.artist, row);
      action('Preview', row, async () => {
        stopPreview(); previewURL = URL.createObjectURL(new Blob([record.bytes], {type: 'audio/mpeg'}));
        const player = panel.querySelector('audio'); player.src = previewURL; await player.play();
      });
      action('Restore original', row, () => revert(record.filename));
    }
  }
  async function showMatches() {
    const sequence = ++currentSearch, id = songID(field.value);
    results.replaceChildren(); message('Searching Song File Hub…');
    const matches = await search(id); if (sequence !== currentSearch) return;
    message(matches.length ? matches.length + ' replacement(s) found for song ' + id + '.' : 'No hosted replacement found. Check the song ID, rather than the level ID.');
    for (const song of matches) {
      const row = element('div', null, results, {class: 'jb-row', 'data-key': song.key});
      element('strong', song.name, row); element('small', song.artist || 'Unknown artist', row);
      const offset = Number(song.startOffset || 0);
      const button = action('Download & use', row, () => activate(id, song.key, target.value || id + '.mp3'));
      if (offset !== 0) {
        button.dataset.unsupported = 'true'; button.disabled = true;
        element('small', 'Needs a ' + offset + ' ms offset; choose another version for now.', row);
      }
    }
  }
  async function restoreSaved() {
    const fs = await ready;
    try {
      const entries = await db('readonly', store => store.getAll());
      for (const record of entries) {
        if (!record?.filename || !(record.bytes instanceof Uint8Array)) continue;
        try { install(fs, record); await refreshAudio(record.filename); } catch (error) { message('Could not restore ' + record.filename + ': ' + error.message); }
      }
      renderActive();
    } catch (error) { message('Song storage unavailable: ' + error.message); }
    if (target) {
      for (const name of fs.readdir('/Resources').filter(name => /^[a-zA-Z0-9_ .-]+\.mp3$/.test(name) && !/^\d+\.mp3$/.test(name)).sort()) {
        element('option', name, target, {value: name});
      }
    }
    if (!attachAudio()) {
      const timer = setInterval(() => {
        if (!attachAudio()) return;
        clearInterval(timer);
        for (const filename of active.keys()) refreshAudio(filename).catch(error => message(error.message));
      }, 200);
    }
  }
  function open() { if (panel) { panel.hidden = false; field.focus(); } }
  function close() { if (panel) { panel.hidden = true; stopPreview(); document.getElementById('canvas')?.focus(); } }
  // Installed before the game's window capture listeners so typing stays in the picker.
  let escapeHeld = false;
  for (const eventName of ['keydown', 'keyup', 'keypress']) window.addEventListener(eventName, event => {
    if (event.code === 'F2') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (eventName === 'keydown' && !event.repeat) window.GDModMenu ? window.GDModMenu.toggle() : (panel?.hidden ? open() : close());
      return;
    }
    if (event.code === 'Escape' && escapeHeld) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (eventName === 'keyup') escapeHeld = false;
      return;
    }
    if (panel && !panel.hidden && (panel.contains(event.target) || event.code === 'Escape')) {
      event.stopImmediatePropagation();
      if (event.code === 'Escape') { event.preventDefault(); if (eventName === 'keydown') { escapeHeld = true; close(); } }
    }
  }, true);
  window.GDJukebox = {open, close, search, activate, revert, ready: ready.then(() => restored), source: SOURCE,
    audioBytes: name => active.get(audioFilename(name))?.bytes.slice() || null,
    getState: () => ({busy, active: [...active.values()].map(({bytes, ...record}) => ({...record, byteLength: bytes.length}))})};
  let restored;
  function mount() {
    const style = element('style', null, document.head);
    style.textContent = `#jb-toggle,#jb-panel{font:14px system-ui,sans-serif;color:#f5f7ff}#jb-toggle{position:fixed;right:14px;bottom:14px;z-index:10010;background:#293653;border:1px solid #8796b7;border-radius:12px;padding:10px 16px;cursor:pointer}#jb-panel{box-sizing:border-box;position:fixed;right:14px;bottom:66px;width:min(440px,calc(100vw - 28px));max-height:calc(100dvh - 88px);overflow:auto;z-index:10011;background:#152037;border:1px solid #667da8;border-radius:16px;padding:20px;box-shadow:0 16px 60px #0009}#jb-panel[hidden]{display:none}#jb-panel h2{margin:0 0 6px;font-size:22px}#jb-panel h3{font-size:15px;margin:20px 0 8px}#jb-panel p{line-height:1.5;color:#c5d0e6}#jb-panel button,#jb-panel input,#jb-panel select{box-sizing:border-box;font:inherit;color:inherit;border:1px solid #60759b;background:#253751;border-radius:8px;padding:9px 11px}#jb-panel button{cursor:pointer;margin:6px 6px 0 0}#jb-panel button:disabled{opacity:.5;cursor:default}#jb-panel input{width:100%;margin:6px 0}#jb-panel select{width:100%;margin:6px 0 0}#jb-panel label{display:block;margin-top:12px}#jb-panel .jb-row{border-top:1px solid #3c4e6c;padding:12px 0}#jb-panel strong,#jb-panel small{display:block;overflow-wrap:anywhere}#jb-panel small{color:#b3c6e1;margin:5px 0}#jb-panel audio{width:100%;height:34px;margin-top:12px}#jb-panel a{color:#adceff}#jb-panel #jb-close{float:right;margin:-6px -5px 0 0}#jb-status{min-height:42px;font-size:13px}`;
    element('button', '♫ Jukebox', document.body, {id: 'jb-toggle', type: 'button', 'data-west-ui': '', 'aria-controls': 'jb-panel'}).addEventListener('click', () => window.GDModMenu ? window.GDModMenu.toggle() : (panel.hidden ? open() : close()));
    panel = element('section', null, document.body, {id: 'jb-panel', hidden: '', 'data-west-ui': '', 'aria-label': 'Jukebox song replacements'});
    element('button', 'Close', panel, {id: 'jb-close', type: 'button'}).addEventListener('click', close);
    element('h2', 'Jukebox', panel); element('p', 'Find a replacement on Song File Hub, then restart the level to hear it.', panel);
    const form = element('form', null, panel);
    element('label', 'Song ID shown on the level', form, {for: 'jb-song-id'});
    field = element('input', null, form, {id: 'jb-song-id', inputmode: 'numeric', pattern: '[0-9]+', placeholder: 'e.g. 1323633', required: ''});
    element('label', 'Replace in game', form, {for: 'jb-target'});
    target = element('select', null, form, {id: 'jb-target'}); element('option', 'This song ID (usual choice)', target, {value: ''});
    element('button', 'Find replacements', form, {type: 'submit', 'data-action': ''});
    form.addEventListener('submit', event => { event.preventDefault(); run(showMatches); });
    status = element('p', 'Ready. Enter a song ID to connect.', panel, {id: 'jb-status', role: 'status', 'aria-live': 'polite'});
    results = element('div', null, panel, {id: 'jb-results'}); activeList = element('div', null, panel, {id: 'jb-active'});
    element('audio', null, panel, {controls: '', preload: 'none'});
    const attribution = element('p', null, panel); element('a', 'Song File Hub index', attribution, {href: SOURCE, target: '_blank', rel: 'noopener'});
    renderActive(); restored = restoreSaved();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once: true}); else mount();
})();

