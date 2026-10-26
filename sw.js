// الواجهة: من الشبكة أولًا (عشان التحديثات توصل) ولو مفيش نت من الكاش.
// صفحات المصحف والخطوط: من الكاش أولًا (مش بتتغير)، وبتتخزّن أول ما تتفتح.
const SHELL = 'mushaf-shell-v4';
const DATA = 'mushaf-data-v1';
const SHELL_FILES = [
  './', 'index.html', 'app.css', 'manifest.json', 'fontmap.json',
  'js/app.js', 'js/store.js', 'js/quran.js', 'js/mushaf.js', 'js/hizb-marker.js',
  'fonts/amiri/amiri-arabic-400-normal.woff2', 'fonts/amiri/amiri-arabic-700-normal.woff2',
  'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== DATA).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (/\/(data|fonts)\//.test(url.pathname)) {
    e.respondWith(caches.open(DATA).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }

  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
