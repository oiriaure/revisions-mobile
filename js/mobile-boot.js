/* ------------------------------------------------------------------
   Version téléphone (iPhone) — démarrage.
   Ce site public ne contient AUCUNE clé ni aucun cours : ils arrivent
   à l'activation (QR code affiché par l'application sur l'ordinateur,
   lien …/#a=<code>), sont gardés sur le téléphone, puis les cours et
   les profils sont téléchargés depuis le dépôt privé.
------------------------------------------------------------------- */
(function () {
  "use strict";
  const KEYS = "rev:mobile:keys";
  const MODELS = ["gemini-flash-latest","gemini-3.8-flash","gemini-3.6-flash","gemini-3.5-flash","gemini-flash-lite-latest","gemini-3.5-flash-lite"];
  const get = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage plein */ } };
  const standalone = !!(navigator.standalone || (window.matchMedia && matchMedia("(display-mode: standalone)").matches));
  document.documentElement.classList.add("mobile");
  if (standalone) document.documentElement.classList.add("standalone");
  window.MOBILE = { ready: false, standalone };

  /* Code d'activation reçu dans le lien */
  const decode = s => {
    try {
      const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
      const j = JSON.parse(decodeURIComponent(Array.from(b, c => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join("")));
      return j && j.r && j.s ? j : null;
    } catch (e) { return null; }
  };
  const m = location.hash.match(/[#&]a=([A-Za-z0-9_-]+)/);
  let fromLink = false;
  if (m) { const k = decode(m[1]); if (k) { set(KEYS, k); fromLink = true; } }
  const keys = get(KEYS);

  if ("serviceWorker" in navigator && location.hostname !== "localhost") addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));

  /* --- Écrans avant l'application --- */
  const icon = '<img class="mb-logo" src="assets/icon.png" alt="">';
  function screen(html) {
    addEventListener("DOMContentLoaded", () => {
      const s = document.getElementById("splash"); if (s) s.remove();
      const d = document.createElement("div");
      d.className = "mb-gate";
      d.innerHTML = html;
      document.body.appendChild(d);
      const f = d.querySelector("form");
      if (f) f.addEventListener("submit", e => {
        e.preventDefault();
        const v = f.querySelector("textarea").value.trim();
        const code = (v.match(/a=([A-Za-z0-9_-]+)/) || [null, v.replace(/\s+/g, "")])[1];
        const k = decode(code);
        if (!k) { f.querySelector(".mb-err").textContent = "Code non reconnu. Recopie-le en entier."; return; }
        set(KEYS, k); location.replace(location.pathname);
      });
      const go = d.querySelector("[data-go]");
      if (go) go.addEventListener("click", () => { sessionStorage.setItem("rev:mobile:safari", "1"); location.reload(); });
    });
  }

  if (!keys) {
    screen(`${icon}<h1>Révisions</h1>
      <p>Sur l'ordinateur, ouvre <b>Réglages › Général › Sur iPhone</b> et scanne le QR code avec l'appareil photo.</p>
      <form><label>Ou colle le code d'activation</label><textarea rows="3" autocapitalize="off" autocorrect="off" spellcheck="false"></textarea>
      <small class="mb-err"></small><button class="btn primary" type="submit">Activer</button></form>`);
    return;
  }
  if (!standalone && fromLink && !sessionStorage.getItem("rev:mobile:safari")) {
    /* On garde le code dans l'adresse : l'icône ajoutée à l'écran d'accueil l'emporte avec elle */
    screen(`${icon}<h1>Installe Révisions</h1>
      <ol class="mb-steps">
        <li>Touche <b>Partager</b> <span class="mb-share"></span> en bas de Safari</li>
        <li>Choisis <b>Sur l'écran d'accueil</b>, puis <b>Ajouter</b></li>
        <li>Ouvre Révisions depuis l'écran d'accueil</li>
      </ol>
      <button class="btn ghost" data-go>Continuer dans Safari</button>`);
    return;
  }
  if (m) history.replaceState(null, "", location.pathname);   // le code ne reste pas affiché

  /* --- Configuration (équivalent de config.js sur l'ordinateur) --- */
  window.APP_CONFIG = { repo: "oiriaure/revisions", branch: "main", token: keys.r, gemini: { key: keys.g || "", models: MODELS } };
  window.SYNC_KEY = { repo: "oiriaure/revisions-sync", token: keys.s };

  function useContent(c) {
    if (!c || !Array.isArray(c.subjects) || !Array.isArray(c.profiles)) return false;
    window.PROFILES = c.profiles.map(p => Object.assign({}, p, { photo: p.photo && c.photos && c.photos[p.id] ? c.photos[p.id] : undefined }));
    window.SUBJECTS = c.subjects.map(window.normalizeSubject);
    window.CONTENT_VERSION = 0;
    return true;
  }
  /* Menu : la barre latérale devient un panneau coulissant */
  function mobileUI() {
    const html = document.documentElement;
    const close = () => html.classList.remove("nav-open");
    const back = document.createElement("div");
    back.className = "mb-backdrop";
    back.addEventListener("click", close);
    document.body.appendChild(back);
    const tb = document.getElementById("titlebar");
    const addBtn = () => {
      if (tb.querySelector(".mb-menu")) return;
      const b = document.createElement("button");
      b.className = "mb-menu"; b.setAttribute("aria-label", "Menu"); b.innerHTML = "<i></i>";
      b.addEventListener("click", () => html.classList.toggle("nav-open"));
      tb.prepend(b);
    };
    new MutationObserver(addBtn).observe(tb, { childList: true });
    addBtn();
    document.getElementById("sidebar").addEventListener("click", e => { if (e.target.closest("a[href], [data-nav], [data-app]")) close(); });
    addEventListener("hashchange", close);
    /* Glisser vers la gauche pour fermer, depuis le bord gauche pour ouvrir */
    let x0 = null, y0 = 0;
    addEventListener("touchstart", e => { const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; }, { passive: true });
    addEventListener("touchend", e => {
      if (x0 == null) return;
      const t = e.changedTouches[0], dx = t.clientX - x0, dy = Math.abs(t.clientY - y0);
      if (dy < 60 && dx < -60 && html.classList.contains("nav-open")) close();
      else if (dy < 60 && dx > 70 && x0 < 30 && !document.getElementById("app").classList.contains("no-sidebar")) html.classList.add("nav-open");
      x0 = null;
    }, { passive: true });
  }

  if (useContent(get("rev:content"))) { window.MOBILE.ready = true; addEventListener("DOMContentLoaded", mobileUI); return; }

  /* Premier lancement : téléchargement des cours */
  screen(`${icon}<h1>Révisions</h1><p class="mb-load">Téléchargement de tes cours…</p><div class="splash-bar"><i></i></div>`);
  fetch(`https://api.github.com/repos/oiriaure/revisions/contents/content/content.json?ref=main&t=${Date.now()}`, {
    cache: "no-store", headers: { Authorization: `Bearer ${keys.r}`, Accept: "application/vnd.github.raw+json", "X-GitHub-Api-Version": "2022-11-28" }
  }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(c => {
      if (!Array.isArray(c.profiles)) throw new Error("profils absents");   // cours publiés avant la version téléphone
      set("rev:content", c); location.reload();
    })
    .catch(() => {
      const p = document.querySelector(".mb-load");
      if (p) p.innerHTML = "Impossible de télécharger les cours. Vérifie ta connexion puis rouvre l'app.";
    });
})();
