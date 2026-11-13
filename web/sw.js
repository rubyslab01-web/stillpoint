// Service worker (registered only over HTTPS, which browsers require). Gives the Home Screen app
// an offline shell: the app, your history and settings open without the Mac.
//
//   App files, session files, narration manifest: network first, cached copy when offline,
//     so edits on the Mac show up at once.
//   Narration (content/Narration/*.m4a): cached once fetched, so the live engine can play
//     offline sessions it has already loaded once.
//   Pre-rendered audio (audio/): not intercepted. Safari streams it with range requests and the
//     files are large; offline, sessions fall back to the live engine.

const CACHE = 'stillpoint-v4';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'js/main.js', 'js/app/content.js', 'js/app/store.js', 'js/app/experiment.js', 'js/app/modes.js',
  'js/app/player-stream.js', 'js/app/player-live.js', 'js/app/audio-env.js', 'js/app/sources.js', 'js/app/icons.js', 'js/app/samples.js',
  'js/engine/dsp.js', 'js/engine/session.js', 'js/engine/renderer.js', 'js/engine/worklet.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'assets/silence.m4a', 'assets/tone-left.m4a', 'assets/tone-right.m4a', 'assets/calibration.m4a',
  'content/Sessions/index.json', 'content/Sessions/modules.json', 'content/Narration/manifest.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const path = url.pathname;
  if (path.includes('/audio/')) return; // let Safari stream pre-rendered media itself
  if (req.headers.has('range')) {
    // Media elements ask for byte ranges (e.g. the live engine's silent keep-alive file).
    // Online: straight through. Offline: slice the cached copy into a proper 206 response.
    e.respondWith(fetch(req).catch(async () => (await rangeFromCache(req)) ?? Response.error()));
    return;
  }
  if (path.includes('/content/Narration/') && path.endsWith('.m4a')) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.status === 200) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  e.respondWith(fetch(req).then((res) => {
    if (res.ok && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(async () => (await caches.match(req, { ignoreSearch: true })) ?? (req.mode === 'navigate' ? caches.match('index.html') : Response.error())));
});

async function rangeFromCache(req) {
  const hit = await caches.match(req.url, { ignoreSearch: true });
  if (!hit) return null;
  const buf = await hit.arrayBuffer();
  const size = buf.byteLength;
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
  let start = 0, end = size - 1;
  if (m && m[1] === '' && m[2]) start = Math.max(0, size - Number(m[2]));
  else if (m) { start = Number(m[1] || 0); if (m[2]) end = Math.min(Number(m[2]), size - 1); }
  if (start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': hit.headers.get('Content-Type') || 'application/octet-stream',
      'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes',
    },
  });
}
