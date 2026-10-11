/* Cache do app para funcionar offline.
 *
 * Cuidado central: um service worker mal feito prende o usuário numa versão
 * antiga, e um reload comum NÃO passa por cima dele. Por isso:
 *  - a rede vem primeiro e com `no-store`, para não cair no cache HTTP;
 *  - o cache só entra quando a rede falha (offline de verdade);
 *  - o SW novo assume na hora (skipWaiting + claim) e a página recarrega
 *    sozinha uma vez, para o código novo valer imediatamente.
 *
 * Ao mudar os arquivos do app, troque a versão abaixo. */
const CACHE = 'soundpad-v3';
const ASSETS = ['./', 'index.html', 'styles.css', 'app.js',
                'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', e => {
  if (e.data === 'pular-espera') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    fetch(req, { cache: 'no-store' })
      .then(r => {
        if (r && r.ok) {
          const copia = r.clone();
          caches.open(CACHE).then(c => c.put(req, copia)).catch(() => {});
        }
        return r;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('index.html')))
  );
});
