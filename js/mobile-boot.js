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
  /* Interface d'application iPhone : barre de navigation avec retour, onglets, feuille « Plus » */
  function mobileUI() {
    const html = document.documentElement;
    const svg = (p, w) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w || 1.8}" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
    const parts = () => location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    const subjectTitle = id => { const s = (window.SUBJECTS || []).find(x => x.id === id); return s ? s.title : "Retour"; };
    const PAGE = { calendar: "Calendrier", notes: "Notes", stats: "Progrès", history: "Historique", assistant: "Prof Susuzouzou" };
    const ROOTS = ["", "calendar", "notes", "assistant"];

    /* Où mène « retour » depuis l'écran actuel ? */
    function backTarget() {
      const p = parts();
      if (p.length < 2) return null;
      const pid = p[0], second = p[1];
      if (p.length === 2 && ROOTS.includes(second)) return null;
      if (second === "history") return { href: `#/${pid}/stats`, label: "Progrès" };
      if (p.length === 2) return { href: `#/${pid}`, label: PAGE[second] ? "Accueil" : "Accueil" };
      return { href: `#/${pid}/${second}`, label: subjectTitle(second) };
    }

    /* ---- Barre de navigation ---- */
    const tb = document.getElementById("titlebar");
    const syncNav = () => {
      let b = tb.querySelector(".mb-back");
      const t = backTarget();
      if (!t) { if (b) b.remove(); return; }
      if (!b) {
        b = document.createElement("button");
        b.className = "mb-back";
        b.addEventListener("click", () => { const tt = backTarget(); if (tt) location.hash = tt.href; });
        tb.prepend(b);
      }
      const lbl = t.label.length > 13 ? "Retour" : t.label;   // comme sur iPhone : libellé court
      b.innerHTML = svg('<path d="m15 18-6-6 6-6"/>', 2.4) + `<span>${lbl.replace(/[&<>]/g, "")}</span>`;
      b.setAttribute("aria-label", "Retour à " + t.label);
    };
    let busy = false;
    new MutationObserver(() => { if (busy) return; busy = true; syncNav(); busy = false; }).observe(tb, { childList: true });
    syncNav();

    /* Grand titre dans la page ; le petit titre centré apparaît en défilant */
    const scroller = document.getElementById("scroller");
    const view = document.getElementById("view");
    const largeTitle = () => html.classList.toggle("large-title", Array.from(view.querySelectorAll(".page-head h1, .toolbar-title")).some(e => e.offsetParent));
    const onScroll = () => html.classList.toggle("scrolled", scroller.scrollTop > 34);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    new MutationObserver(() => { largeTitle(); onScroll(); }).observe(view, { childList: true });
    largeTitle();

    /* ---- Feuille « Plus » (ancienne barre latérale) ---- */
    const close = () => html.classList.remove("nav-open");
    const head = document.createElement("div");
    head.className = "mb-sheet-head";
    head.innerHTML = `<b>Plus</b><button type="button">OK</button>`;
    head.querySelector("button").addEventListener("click", close);
    document.body.appendChild(head);
    document.getElementById("sidebar").addEventListener("click", e => { if (e.target.closest("a[href], [data-nav], [data-app]")) close(); });

    /* ---- Barre d'onglets ---- */
    const TABS = [["", "Accueil", '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-6h4v6"/>'],
      ["calendar", "Calendrier", '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'],
      ["assistant", "Prof", '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>'],
      ["notes", "Notes", '<path d="M5 3.5h10l4 4V20.5H5z"/><path d="M15 3.5v4h4"/><path d="M8.5 12h7M8.5 15.5h5"/>'],
      ["menu", "Plus", '<circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/>']];
    const bar = document.createElement("nav");
    bar.className = "mb-tabs";
    bar.innerHTML = TABS.map(([r, l, p]) => `<button data-tab="${r}">${svg(p)}<span>${l}</span></button>`).join("");
    document.body.appendChild(bar);
    bar.addEventListener("click", e => {
      const b = e.target.closest("[data-tab]");
      if (!b) return;
      const p = parts()[0]; if (!p) return;
      if (b.dataset.tab === "menu") { html.classList.toggle("nav-open"); markTab(); return; }
      close();
      const h = `#/${p}${b.dataset.tab ? "/" + b.dataset.tab : ""}`;
      if (location.hash === h) scroller.scrollTo({ top: 0, behavior: "smooth" }); else location.hash = h;
    });
    function markTab() {
      const part = parts()[1] || "";
      const key = html.classList.contains("nav-open") ? "menu" : ROOTS.includes(part) ? part : ["stats", "history"].includes(part) ? "menu" : "";
      bar.querySelectorAll("[data-tab]").forEach(b => b.classList.toggle("on", b.dataset.tab === key));
      html.classList.toggle("study", ["flash", "qcm"].includes(parts()[2]));
    }
    addEventListener("hashchange", () => { close(); markTab(); });
    markTab();

    /* ---- Couleur de la barre d'état (heure, batterie) assortie à l'écran ---- */
    const meta = document.querySelector('meta[name="theme-color"]');
    const tint = () => { if (meta) requestAnimationFrame(() => { meta.content = (getComputedStyle(html).getPropertyValue("--bg") || "").trim() || "#f2f2f7"; }); };
    new MutationObserver(tint).observe(html, { attributes: true, attributeFilter: ["data-mode", "data-profile", "data-screen", "style"] });
    tint();

    /* ---- Glisser depuis le bord gauche = retour (comme sur iPhone) ; vers le bas sur « Plus » = fermer ---- */
    let x0 = null, y0 = 0;
    addEventListener("touchstart", e => { const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; }, { passive: true });
    addEventListener("touchend", e => {
      if (x0 == null) return;
      const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
      if (html.classList.contains("nav-open")) { if (dy > 90 && Math.abs(dx) < 60 && y0 < 160) close(); }
      else if (x0 < 24 && dx > 70 && Math.abs(dy) < 60) { const tt = backTarget(); if (tt) location.hash = tt.href; }
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
