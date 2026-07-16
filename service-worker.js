const CACHE = 'espanolia-v2'; // ⚠️ AUMENTE ESTE NÚMERO sempre que atualizar o app,
                               // assim o celular é forçado a baixar a versão nova.
const ASSETS = ['./', './index.html', './style.css', './app.js', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting(); // ativa a nova versão imediatamente, sem esperar
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim(); // assume o controle das abas já abertas
});

self.addEventListener('fetch', e => {
  // Nunca faz cache de chamadas à API (Google Apps Script) ou ao leitor de páginas
  if (e.request.url.includes('script.google.com') || e.request.url.includes('r.jina.ai')) return;

  // Network-first: sempre tenta buscar a versão mais nova primeiro.
  // Só usa o cache como reserva se estiver sem internet.
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const resClone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, resClone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
