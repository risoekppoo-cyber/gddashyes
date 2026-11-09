/* Route online levels through the local launcher when it serves this script. */
(() => {
  const endpoints = new Set([
    'getGJLevels21.php', 'downloadGJLevel22.php', 'getGJSongInfo.php',
    'getGJDailyLevel.php', 'getGJGauntlets21.php', 'getGJMapPacks21.php'
  ]);

  function relayUrl(url) {
    const target = window.__gdProxyTarget?.(String(url));
    if (!target) return null;
    try {
      const upstream = new URL(target);
      if (!['www.boomlings.com', 'boomlings.com'].includes(upstream.host)) return null;
      if (!upstream.pathname.startsWith('/database/') || !endpoints.has(upstream.pathname.slice(10))) return null;
      const local = new URL('/__gd_relay', location.origin);
      local.searchParams.set('url', upstream.href);
      return local.href;
    } catch (_) {
      return null;
    }
  }

  const fetchGame = window.fetch;
  window.fetch = function (input, options) {
    const url = relayUrl(input instanceof Request ? input.url : input);
    if (!url) return fetchGame.call(this, input, options);
    return fetchGame.call(this, input instanceof Request ? new Request(url, input) : url, options);
  };

  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...options) {
    return open.call(this, method, relayUrl(url) || url, ...options);
  };
})();
