/* Fonctionnement hors ligne : l'interface est gardée sur le téléphone.
   Version mw57oz66 : à chaque publication, l'ancienne copie est remplacée. */
const CACHE = "revisions-mw57oz66";
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(["./","styles.css","vendor/katex/fonts/KaTeX_AMS-Regular.woff2","vendor/katex/fonts/KaTeX_Caligraphic-Bold.woff2","vendor/katex/fonts/KaTeX_Caligraphic-Regular.woff2","vendor/katex/fonts/KaTeX_Fraktur-Bold.woff2","vendor/katex/fonts/KaTeX_Fraktur-Regular.woff2","vendor/katex/fonts/KaTeX_Main-Bold.woff2","vendor/katex/fonts/KaTeX_Main-BoldItalic.woff2","vendor/katex/fonts/KaTeX_Main-Italic.woff2","vendor/katex/fonts/KaTeX_Main-Regular.woff2","vendor/katex/fonts/KaTeX_Math-BoldItalic.woff2","vendor/katex/fonts/KaTeX_Math-Italic.woff2","vendor/katex/fonts/KaTeX_SansSerif-Bold.woff2","vendor/katex/fonts/KaTeX_SansSerif-Italic.woff2","vendor/katex/fonts/KaTeX_SansSerif-Regular.woff2","vendor/katex/fonts/KaTeX_Script-Regular.woff2","vendor/katex/fonts/KaTeX_Size1-Regular.woff2","vendor/katex/fonts/KaTeX_Size2-Regular.woff2","vendor/katex/fonts/KaTeX_Size3-Regular.woff2","vendor/katex/fonts/KaTeX_Size4-Regular.woff2","vendor/katex/fonts/KaTeX_Typewriter-Regular.woff2","vendor/katex/katex.min.css","vendor/katex/katex.min.js","vendor/katex/LICENSE","js/app.js","js/assistant.js","js/flashcards.js","js/launch-decor.js","js/notes.js","js/qcm.js","js/rappels.js","js/registry.js","js/stats.js","js/sync.js","js/tracker.js","js/util.js","assets/cours-electricite.png","assets/cours-institutions.png","assets/cours-intro-analyse.png","assets/icon.png","js/mobile-boot.js","mobile.css","index.html"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;   // GitHub, assistant : toujours en ligne
  if (e.request.mode === "navigate") {
    /* page : la version en ligne d'abord (mises à jour), sinon la copie */
    e.respondWith(fetch(e.request).catch(() => caches.match("index.html")));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
