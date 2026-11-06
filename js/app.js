/* ------------------------------------------------------------------
   Application : profils, navigation, réglages, aide clavier.
   Routes :
     #/                         choix du profil
     #/angele                   espace d'Angèle (liste des matières)
     #/angele/<matiere>         vue d'ensemble de la matière
     #/angele/<matiere>/flash   flashcards (+ onglet rappels de cours)
     #/angele/<matiere>/rappels rappels de cours
     #/angele/<matiere>/qcm     QCM
------------------------------------------------------------------- */
window.App = (function () {
  "use strict";
  const { $, $$, esc, Store, icon } = U;

  const FONTS = {
    system: '"Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif',
    georgia: 'Georgia,"Times New Roman",serif',
    trebuchet: '"Trebuchet MS",Tahoma,sans-serif',
    verdana: "Verdana,Geneva,sans-serif",
    mono: '"Courier New",Courier,monospace'
  };
  const DEF = {
    theme: "auto", accentAuto: true, accent: "#c2366e", fs: 18, font: "system",
    speed: 6, dir: "Y", showcat: true, flashbg: true,
    qcmCount: 30, shufq: true, shufo: true, conf: true, cheer: true, kbd: true,
    breakOn: true, breakEvery: 60, goal: 30, remoteNotif: true
  };
  const MODES = { flash: "Flashcards", rappels: "Fiches de cours", qcm: "QCM", assistant: "Prof Susuzouzou", notes: "Notes", stats: "Statistiques" };

  let prefs = Object.assign({}, DEF);
  let cur = { profile: null, subject: null, mode: null };
  let ctrl = null;
  let sidebarFor = null;
  let pendingChapter = null;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");

  const view = () => $("#view");
  const profileById = id => PROFILES.find(p => p.id === id);
  const subjectsOf = pid => SUBJECTS.filter(s => s.profile === pid);
  const isEmpty = S => !S.flash.length && !S.qcm.length && !S.rappels.length;
  const plural = (n, w) => `${n} ${w}${n > 1 ? "s" : ""}`;
  const heart = p => p.heart ? icon("heart", "heart") : "";
  const subjIcon = (s, cls) => s.iconImg ? `<img class="${cls}" src="${esc(s.iconImg)}" alt="">` : "";
  const avatar = (p, cls = "") => `<span class="avatar ${cls}" style="--pc:${p.color}">${
    p.photo ? `<img src="${esc(p.photo)}" alt="">` : esc(p.name.charAt(0))}</span>`;

  /* ---------------- Plateforme ---------------- */
  const bridge = window.appWindow || null;
  if (bridge) {
    document.documentElement.classList.add("electron", bridge.platform === "darwin" ? "platform-mac" : "platform-win");
  }

  /* ---------------- Réglages ---------------- */
  const defaultsFor = pid => Object.assign({}, DEF, (profileById(pid) || {}).defaults || {});
  function loadPrefs(pid) { prefs = Object.assign(defaultsFor(pid), pid ? Store.get(`rev:${pid}:prefs`, {}) : {}); }
  function savePrefs() { if (cur.profile) Store.set(`rev:${cur.profile.id}:prefs`, prefs); }

  function applyPrefs() {
    const r = document.documentElement;
    r.dataset.theme = prefs.theme;
    r.dataset.mode = prefs.theme === "auto" ? (mq.matches ? "dark" : "light") : prefs.theme;
    if (cur.profile) { r.dataset.profile = cur.profile.id; delete r.dataset.screen; }
    else { delete r.dataset.profile; r.dataset.screen = "profiles"; }
    r.style.removeProperty("--accent");
    const auto = cur.subject && cur.subject.color;
    if (!prefs.accentAuto) r.style.setProperty("--accent", prefs.accent);
    else if (auto) r.style.setProperty("--accent", auto);
    r.style.setProperty("--fs", prefs.fs + "px");
    r.style.setProperty("--speed", (prefs.speed / 10) + "s");
    r.style.setProperty("--font", FONTS[prefs.font] || FONTS.system);
    syncWindow();
  }

  /* Couleurs des boutons de fenêtre (Windows) */
  function syncWindow() {
    if (!bridge || !bridge.setTheme) return;
    requestAnimationFrame(() => {
      const cs = getComputedStyle(document.documentElement);
      bridge.setTheme({ bg: cs.getPropertyValue("--titlebar").trim(), symbol: (cs.getPropertyValue("--tb-symbol") || cs.getPropertyValue("--ink")).trim() });
    });
  }

  function prefsToUI() {
    const P = $("#settings");
    $$("[data-pref]", P).forEach(el => {
      const v = prefs[el.dataset.pref];
      if (el.type === "checkbox") el.checked = !!v; else el.value = v;
    });
    $$("[data-pref-set]", P).forEach(b => {
      const k = b.dataset.prefSet, v = b.dataset.value;
      const on = k === "accentChoice" ? (v === "auto" ? prefs.accentAuto : !prefs.accentAuto && prefs.accent.toLowerCase() === v)
        : String(prefs[k]) === v;
      b.setAttribute("aria-pressed", on);
    });
    const preset = $$("[data-pref-set=accentChoice]", P).some(b => b.getAttribute("aria-pressed") === "true");
    $(".swatch.custom", P).classList.toggle("on", !preset);
    $(".swatch.custom", P).style.setProperty("--sw", prefs.accent);
    $("#accent-hint").textContent = prefs.accentAuto ? "Chaque matière garde sa propre couleur." : "La même couleur partout dans ton espace.";
    $("#set-fs-v").textContent = prefs.fs + " px";
    $("#set-speed-v").textContent = (prefs.speed / 10).toFixed(1).replace(".", ",") + " s";
    $("#set-cheer-row").hidden = !(cur.profile && cur.profile.cheers);
    $("#set-cheer-row2").hidden = !(cur.profile && cur.profile.cheers);
    $("#prefs-profile").textContent = cur.profile ? "Profil de " + cur.profile.name : "";
    const ss = document.getElementById("sync-state"); if (ss) ss.textContent = syncText();
    const ds = document.getElementById("data-state"); if (ds) ds.textContent = Store.persistent ? "Enregistrées automatiquement dans un fichier sur cet ordinateur (copie de secours chaque jour)." : "Enregistrées dans le navigateur.";
  }

  const PREF_TABS = {
    look: ["Apparence", "Thème, couleurs et lisibilité"],
    study: ["Révision", "Réglages des flashcards"],
    qcm: ["QCM", "Déroulement des évaluations"],
    notif: ["Notifications", "Pauses, objectif du jour et activité"],
    general: ["Général", "Données, raccourcis et réinitialisation"]
  };
  function prefsTab(t) {
    $$("#settings [data-prefs-tab]").forEach(b => b.setAttribute("aria-selected", b.dataset.prefsTab === t));
    $$("#settings .prefs-pane").forEach(p => { p.hidden = p.dataset.pane !== t; });
    $("#prefs-title").textContent = PREF_TABS[t][0];
    $("#prefs-sub").textContent = PREF_TABS[t][1];
  }

  /* Installation sur iPhone : lien du site + code d'activation (les clés ne sont jamais sur le site public) */
  function iphoneLink() {
    const k = window.SYNC_KEY || {}, g = (CFG.gemini || {}).key;
    if (!CFG.token || !k.token) return null;
    const json = JSON.stringify({ r: CFG.token, s: k.token, g: g || "" });
    const b = btoa(String.fromCharCode(...new TextEncoder().encode(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return "https://oiriaure.github.io/revisions-mobile/#a=" + b;
  }
  function renderIphone() {
    const box = document.getElementById("iphone-block");
    const link = !window.MOBILE && window.qrcode && iphoneLink();
    if (!box || !link) return;
    const q = qrcode(0, "L"); q.addData(link); q.make();
    document.getElementById("iphone-qr").innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    box.hidden = false;
  }

  function syncText() {
    if (!window.Sync || !Sync.enabled()) return "Pas encore activée : il manque la clé de synchronisation.";
    const s = Sync.status();
    if (s.error) return "Hors ligne ou erreur (" + s.error + "). Nouvel essai automatique.";
    const n = s.others, h = t => new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    return s.last ? "Activée en direct · à jour à " + h(s.last) + " · " + (n ? n + (n > 1 ? " autres ordinateurs reliés" : " autre ordinateur relié") : "aucun autre ordinateur pour l'instant") : "Activée · connexion…";
  }

  function onPrefClick(e) {
    const tab = e.target.closest("[data-prefs-tab]");
    if (tab) { prefsTab(tab.dataset.prefsTab); return; }
    const b = e.target.closest("[data-pref-set]");
    if (!b) return;
    const k = b.dataset.prefSet, v = b.dataset.value;
    if (k === "accentChoice") {
      if (v === "auto") prefs.accentAuto = true; else { prefs.accentAuto = false; prefs.accent = v; }
    } else prefs[k] = ["qcmCount", "breakEvery", "goal"].includes(k) ? Number(v) : v;
    savePrefs(); applyPrefs(); prefsToUI();
    if (ctrl && ctrl.refresh) ctrl.refresh();
  }

  function onPrefInput(e) {
    const el = e.target.closest("[data-pref]");
    if (!el) return;
    const k = el.dataset.pref;
    let v = el.type === "checkbox" ? el.checked : el.value;
    if (el.type === "range" || k === "qcmCount") v = Number(v);
    prefs[k] = v;
    if (k === "accent") prefs.accentAuto = false;
    savePrefs(); applyPrefs(); prefsToUI();
    if (ctrl && ctrl.refresh) ctrl.refresh();
  }

  function resetPrefs() {
    prefs = defaultsFor(cur.profile && cur.profile.id);
    savePrefs(); applyPrefs(); prefsToUI();
    if (ctrl && ctrl.refresh) ctrl.refresh();
    toast("Réglages réinitialisés");
  }

  function openSettings(open) {
    const m = $("#settings");
    m.hidden = !open;
    if (open) prefsToUI();
  }
  function toggleHelp(force) {
    const m = $("#help");
    m.hidden = force === undefined ? !m.hidden : !force;
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  /* ---------------- Barre de titre ---------------- */
  function setTitlebar(parts) {
    $("#titlebar").innerHTML = `<div class="tb-crumbs">${parts.map((p, i) => {
      const last = i === parts.length - 1;
      const label = `<span class="${last ? "tb-current" : "tb-crumb"}">${esc(p.label)}</span>`;
      return (i ? `<span class="tb-sep">${icon("right")}</span>` : "") + (p.href && !last ? `<a href="${p.href}">${label}</a>` : label);
    }).join("")}</div>`;
  }

  /* ---------------- Barre latérale ---------------- */
  function renderSidebar(profile) {
    const subs = subjectsOf(profile.id);
    $("#sidebar").innerHTML = `
      <div class="sb-top">
        <a class="sb-profile" href="#/" title="Changer de profil">
          ${avatar(profile, "sm")}
          <span class="sb-profile-txt"><b>${esc(profile.name)}${heart(profile)}</b><small>Changer de profil</small></span>
          ${icon("swap", "sb-swap")}
        </a>
      </div>
      <nav class="sb-nav">
        <a class="sb-item" data-nav="home" href="#/${profile.id}">${icon("home")}<span>Accueil</span></a>
        <a class="sb-item" data-nav="assistant" href="#/${profile.id}/assistant">${icon("sparkle")}<span>Prof Susuzouzou</span><span class="sb-badge">IA</span></a>
        <a class="sb-item" data-nav="notes" href="#/${profile.id}/notes">${icon("note")}<span>Notes</span></a>
        <a class="sb-item" data-nav="stats" href="#/${profile.id}/stats">${icon("chart")}<span>Statistiques</span><span class="sb-time" id="sb-today"></span></a>
        <div class="sb-section">Matières</div>
        ${subs.length ? subs.map(s => `
          <a class="sb-item sb-subject" data-nav="${s.id}" href="#/${profile.id}/${s.id}" style="--sc:${s.color}">
            ${s.iconImg ? subjIcon(s, "sb-icon") : `<span class="sb-dot"></span>`}<span class="sb-label">${esc(s.title)}</span>
          </a>
          <div class="sb-sub" data-sub="${s.id}">
            <a class="sb-item sm" data-nav="${s.id}:home" href="#/${profile.id}/${s.id}">${icon("grid")}<span>Vue d'ensemble</span></a>
            <a class="sb-item sm" data-nav="${s.id}:rappels" href="#/${profile.id}/${s.id}/rappels">${icon("book")}<span>Fiches de cours</span></a>
            <a class="sb-item sm" data-nav="${s.id}:flash" href="#/${profile.id}/${s.id}/flash">${icon("cards")}<span>Flashcards</span></a>
            <a class="sb-item sm" data-nav="${s.id}:qcm" href="#/${profile.id}/${s.id}/qcm">${icon("checklist")}<span>QCM</span></a>
          </div>`).join("") : `<div class="sb-empty">Aucune matière pour l'instant</div>`}
      </nav>
      <div class="sb-foot">
        <button class="sb-item" data-app="tuto">${icon("play")}<span>Tutoriel</span></button>
        <button class="sb-item" data-app="help">${icon("keyboard")}<span>Raccourcis</span><kbd>?</kbd></button>
        <button class="sb-item" data-app="settings">${icon("sliders")}<span>Réglages</span></button>
        ${updateHTML()}
        <div class="sb-credit">created by Clément D.</div>
      </div>`;
    sidebarFor = profile.id;
  }

  function markSidebar() {
    const sid = cur.subject && cur.subject.id;
    const key = ["assistant", "notes", "stats"].includes(cur.mode) ? cur.mode : !sid ? "home" : `${sid}:${cur.mode || "home"}`;
    $$("#sidebar [data-nav]").forEach(a => {
      const n = a.dataset.nav;
      a.classList.toggle("active", n === key);
      if (!n.includes(":") && !["home", "assistant", "notes", "stats"].includes(n)) a.classList.toggle("open", n === sid);
    });
    $$("#sidebar .sb-sub").forEach(d => d.classList.toggle("open", d.dataset.sub === sid));
  }

  /* ---------------- Vues ---------------- */
  function renderProfiles() {
    $("#app").classList.add("no-sidebar");
    sidebarFor = null;
    const dark = document.documentElement.dataset.mode === "dark";
    /* Le bouton va dans la barre de titre : sous elle, la zone de déplacement de la fenêtre bloquerait les clics */
    $("#titlebar").innerHTML = `
      <div class="launch-theme" role="group" aria-label="Thème">
        <button data-launch-theme="light" aria-pressed="${!dark}" title="Thème clair">${icon("sun")}<span>Clair</span></button>
        <button data-launch-theme="dark" aria-pressed="${dark}" title="Thème sombre">${icon("moon")}<span>Sombre</span></button>
      </div>`;
    view().innerHTML = `
      ${LaunchDecor.html()}
      <section class="profiles">
        <div class="profiles-head">
          <div class="brand-row"><img class="app-logo" src="assets/icon.png" alt=""><span>Révisions</span></div>
          <h1>Choisis ton profil</h1>
          <span class="title-bar"></span>
          <p>Flashcards, fiches de cours, QCM et un prof de révision pour réussir tes partiels.</p>
        </div>
        <div class="profile-grid">
          ${PROFILES.map((p, k) => {
            const n = subjectsOf(p.id).length;
            return `
            <a class="profile-card" href="#/${p.id}" data-p="${p.id}" style="--pc:${p.color}">
              <span class="avatar-ring">${avatar(p, "lg")}</span>
              <span class="pname">${esc(p.name)}${heart(p)}</span>
              <span class="pmeta">${n ? plural(n, "matière") : esc(p.tagline)}</span>
              <span class="pgo">Accéder ${icon("right")}</span>
              <kbd class="pkey">${k + 1}</kbd>
            </a>`;
          }).join("")}
        </div>
        ${updateHTML()}
      </section>`;
  }

  /* Thème de l'écran de lancement (indépendant des profils) */
  function setLaunchTheme(t) {
    Store.set("rev:launch:theme", t);
    prefs.theme = t;
    applyPrefs();
    $$(".launch-theme [data-launch-theme]").forEach(b => b.setAttribute("aria-pressed", b.dataset.launchTheme === t));
  }

  /* ---------------- Mises à jour à distance ---------------- */
  const CFG = window.APP_CONFIG || {};
  let update = null; // { version, url }

  function updateHTML() {
    if (!update) return "";
    return `<button class="update-pill" data-app="update">${icon("arrow")}Nouvelle version ${esc(update.version)} — Installer</button>`;
  }

  /* Fenêtre de mise à jour : barre de progression en direct */
  let downloading = false;
  function updDialog(o) {
    const d = $("#upd");
    d.hidden = false;
    const pct = o.pct == null ? null : Math.max(0, Math.min(100, Math.round(o.pct)));
    d.querySelector(".dialog").innerHTML = `
      <div class="upd-body">
        <span class="upd-ico${o.error ? " err" : ""}">${icon(o.error ? "x" : o.done ? "check" : "download")}</span>
        <div class="upd-txt">
          <h3>${esc(o.title)}</h3>
          <p>${esc(o.text || "")}</p>
          ${o.error || o.done ? "" : `<div class="upd-bar${pct == null ? " indet" : ""}"><i style="width:${pct == null ? 35 : pct}%"></i></div>
          <div class="upd-meta"><span>${esc(o.meta || "")}</span><b>${pct == null ? "" : pct + " %"}</b></div>`}
        </div>
      </div>
      ${o.error || o.close ? `<div class="dialog-foot"><span class="spacer"></span><button class="btn primary" data-app="upd-close">${o.error ? "Fermer" : "OK"}</button></div>` : ""}`;
  }
  const mb = n => (n / 1048576).toFixed(1).replace(".", ",") + " Mo";
  async function installUpdate() {
    if (!update || downloading || !bridge || !bridge.downloadUpdate) return;
    downloading = true;
    const mac = bridge.platform === "darwin";
    updDialog({ title: `Mise à jour ${update.version}`, text: "Téléchargement de la nouvelle version…", pct: 0, meta: "Connexion…" });
    const res = await bridge.downloadUpdate({ url: update.url, name: update.name, token: CFG.token });
    downloading = false;
    if (!res || !res.ok) {
      updDialog({ title: "Le téléchargement a échoué", text: "Vérifie ta connexion Internet puis réessaie avec le bouton « Installer ».", error: true });
      return;
    }
    if (res.installed) return; // l'application redémarre toute seule
    updDialog(mac
      ? { title: "Nouvelle version téléchargée", text: "Le fichier s'est ouvert : glisse Révisions dans le dossier Applications pour remplacer l'ancienne version.", done: true, close: true }
      : { title: "Nouvelle version téléchargée", text: "Elle est dans ton dossier Téléchargements : ferme l'application et ouvre « Revisions-Windows.exe ».", done: true, close: true });
  }
  if (bridge && bridge.onUpdateProgress) bridge.onUpdateProgress(p => {
    if (!update) return;
    if (p.phase === "download") updDialog({ title: `Mise à jour ${update.version}`, text: "Téléchargement de la nouvelle version…",
      pct: p.total ? p.got / p.total * 100 : null, meta: p.total ? `${mb(p.got)} sur ${mb(p.total)}` : mb(p.got) });
    else if (p.phase === "install") updDialog({ title: `Mise à jour ${update.version}`, text: "Installation en cours…", pct: null, meta: "Remplacement de l'ancienne version" });
    else if (p.phase === "restart") updDialog({ title: "Mise à jour installée", text: "L'application redémarre…", done: true });
  });

  function useContent(c) {
    if (!c || !Array.isArray(c.subjects)) return false;
    window.SUBJECTS = c.subjects.map(normalizeSubject);
    return true;
  }

  /* Cours : version en cache si plus récente que celle livrée, puis vérification en ligne */
  function loadCachedContent() {
    const cached = Store.get("rev:content", null);
    if (cached && cached.version > (window.CONTENT_VERSION || 0)) useContent(cached);
  }

  async function checkRemote() {
    if (!CFG.repo || !CFG.token) return;
    const auth = { Authorization: `Bearer ${CFG.token}`, "X-GitHub-Api-Version": "2022-11-28" };
    const current = Math.max(window.CONTENT_VERSION || 0, (Store.get("rev:content", null) || {}).version || 0);
    try {
      const r = await fetch(`https://api.github.com/repos/${CFG.repo}/contents/content/content.json?ref=${CFG.branch || "main"}&t=${Date.now()}`,
        { cache: "no-store", headers: Object.assign({ Accept: "application/vnd.github.raw+json" }, auth) });
      if (r.ok) {
        const c = await r.json();
        if (c.version > current && useContent(c)) {
          Store.set("rev:content", c);
          refreshView();
          toast("Cours mis à jour");
        }
      }
    } catch (e) { /* hors ligne : on garde la version locale */ }
    try {
      if (!bridge || !bridge.getVersion) return;
      const mine = await bridge.getVersion();
      const r = await fetch(`https://api.github.com/repos/${CFG.repo}/releases/latest`,
        { cache: "no-store", headers: Object.assign({ Accept: "application/vnd.github+json" }, auth) });
      if (!r.ok) return;
      const rel = await r.json();
      const latest = String(rel.tag_name || "").replace(/^v/, "");
      const want = bridge.platform === "darwin" ? "Revisions-Mac.dmg" : "Revisions-Windows.exe";
      const asset = (rel.assets || []).find(a => a.name === want);
      if (latest && asset && newer(latest, mine)) {
        update = { version: latest, url: asset.url, name: asset.name };
        refreshView();
      }
    } catch (e) { /* idem */ }
  }
  /* Rafraîchit l'affichage sans interrompre une révision en cours */
  function refreshView() {
    if (!ctrl) { sidebarFor = null; route(); }
    else if (cur.profile) { renderSidebar(cur.profile); markSidebar(); }
  }
  function newer(a, b) {
    const pa = a.split(".").map(Number), pb = String(b).split(".").map(Number);
    for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
    return false;
  }

  function subjectStats(profile, S) {
    return {
      chapters: U.chaptersOf(S).length,
      missed: Store.get(`rev:${profile.id}:${S.id}:missed`, []).length,
      qcm: Store.get(`rev:${profile.id}:${S.id}:qcm`, null)
    };
  }

  /* ---------- Tableau de bord de l'accueil ---------- */
  const daysLeft = iso => {
    if (!iso) return null;
    const d = new Date(iso + "T00:00:00"), t = new Date(); t.setHours(0, 0, 0, 0);
    return Math.round((d - t) / 864e5);
  };
  const examTag = n => n == null || n < 0 ? "" : n === 0 ? "Partiel aujourd'hui" : n === 1 ? "Partiel demain" : `Partiel dans ${n} jours`;

  /* Dernière révision interrompue (flashcards ou QCM) */
  function resumeItem(profile) {
    let best = null;
    subjectsOf(profile.id).forEach(S => {
      const f = Store.get(`rev:${profile.id}:${S.id}:fcrun`, null);
      if (f && f.t && !f.done && f.ids && f.ids.length > 1 && (f.i || 0) > 0)
        if (!best || f.t > best.t) best = { t: f.t, S, mode: "flash", ico: "cards", label: `Flashcards · carte ${(f.i || 0) + 1} sur ${f.ids.length}` };
      const q = Store.get(`rev:${profile.id}:${S.id}:qcmrun`, null);
      if (q && q.t && !q.finished && q.deck && q.deck.length)
        if (!best || q.t > best.t) best = { t: q.t, S, mode: "qcm", ico: "checklist", label: `QCM · question ${(q.idx || 0) + 1} sur ${q.deck.length}` };
    });
    return best && Date.now() - best.t < 14 * 864e5 ? best : null;
  }

  function dashboardHTML(profile) {
    const T = Track.totals(profile.id);
    const goal = (prefs.goal || 30) * 60;
    const pct = Math.min(100, Math.round(T.today / goal * 100));
    const streak = Track.streak(profile.id);
    const r = resumeItem(profile);
    const others = PROFILES.filter(p => p.id !== profile.id);
    const feed = [].concat(...PROFILES.map(p => Track.events(p.id).filter(e => e.type === "qcm").map(e => Object.assign({ p }, e))))
      .sort((a, b) => b.t - a.t).slice(0, 4);
    const nf = x => (Math.round(x * 10) / 10).toString().replace(".", ",");
    const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }); };
    return `
      <div class="dash">
        <div class="dash-card goal-card">
          <div class="ring" style="--p:${pct}"><span><b>${pct}%</b><small>objectif</small></span></div>
          <div class="goal-txt">
            <small>Aujourd'hui</small>
            <b>${Track.fmt(T.today)} <span>/ ${Track.fmt(goal)}</span></b>
            <span class="streak">${icon("flame")}${streak ? `Série de ${streak} jour${streak > 1 ? "s" : ""}` : "Révise 10 min pour lancer ta série"}</span>
          </div>
        </div>
        ${r ? `<a class="dash-card resume-card" href="#/${profile.id}/${r.S.id}/${r.mode}" style="--sc:${r.S.color}">
          <span class="step-ico">${icon(r.ico)}</span>
          <span><small>Reprendre là où tu t'es arrêté${profile.id === "angele" ? "e" : ""}</small><b>${esc(r.S.title)}</b><em>${esc(r.label)}</em></span>
          ${icon("arrow", "go")}
        </a>` : `<a class="dash-card resume-card" href="#/${profile.id}/assistant">
          <span class="step-ico">${icon("sparkle")}</span>
          <span><small>Une question ?</small><b>Prof Susuzouzou</b><em>Explications, interrogations, méthode</em></span>
          ${icon("arrow", "go")}
        </a>`}
      </div>
      <div class="dash-row">
        <div class="card-box chart-card">
          <div class="card-head"><h3>${icon("chart")}Temps de révision · 7 jours</h3><a class="chip-btn" href="#/${profile.id}/stats">Détails</a></div>
          ${Stats.profilesChart()}
        </div>
        ${others.length ? `<div class="card-box feed-card">
          <div class="card-head"><h3>${icon("award")}Derniers QCM</h3>${window.Sync && Sync.enabled() ? `<span class="sync-dot" title="Synchronisé entre vos ordinateurs"></span>` : ""}</div>
          ${feed.length ? `<div class="feed">${feed.map(e => `
            <div class="feed-item">
              ${avatar(e.p, "xs")}
              <span><span class="fi-top"><b>${esc(e.p.name)}</b> · ${esc(e.title || "")}</span><small>${ago(e.t)} · ${e.n} questions</small></span>
              <span class="grade-chip ${e.n20 >= 15 ? "ok" : e.n20 >= 10 ? "part" : "ko"}">${nf(e.n20)}<small>/20</small></span>
            </div>`).join("")}</div>` : `<p class="feed-empty">Les QCM terminés par ${others.map(p => esc(p.name)).join(" et ")} et toi apparaîtront ici${window.Sync && Sync.enabled() ? "" : " (synchronisation à activer dans les Réglages)"}.</p>`}
        </div>` : ""}
      </div>`;
  }

  function renderProfileHome(profile) {
    const subs = subjectsOf(profile.id);
    setTitlebar([{ label: "Accueil" }]);
    if (!subs.length) {
      view().innerHTML = `
        <section class="page">
          <div class="page-head"><div><h1>Bonjour ${esc(profile.name)}</h1><p class="page-sub">Ton espace est prêt.</p></div></div>
          <div class="empty">${icon("stack", "empty-ico")}<h3>Aucune matière pour l'instant</h3><p>Les matières apparaîtront ici dès qu'elles seront ajoutées.</p></div>
          <a class="assist-banner" href="#/${profile.id}/assistant" data-scope="none">
            <span class="step-ico">${icon("sparkle")}</span>
            <span><b>En attendant, Prof Susuzouzou est là</b><small>Méthode de travail, organisation, explications : pose-lui tes questions.</small></span>
            <span class="assist-go">Ouvrir Prof Susuzouzou ${icon("arrow")}</span>
          </a>
        </section>`;
      return;
    }
    const meta = Store.get(`rev:${profile.id}:subjmeta`, {});
    const filter = Store.get(`rev:${profile.id}:homefilter`, "all");
    const STAT = { todo: "Pas fait", doing: "En cours", done: "Fait" };
    const items = subs.map((s, k) => ({ s, k, fav: !!(meta[s.id] || {}).fav, status: (meta[s.id] || {}).status || "todo" }))
      .sort((a, b) => (b.fav - a.fav) || (a.k - b.k));
    const match = (o, v) => v === "all" || (v === "fav" ? o.fav : o.status === v);
    const shown = items.filter(o => match(o, filter));
    const FILTERS = [["all", "Toutes"], ["fav", "Favoris"], ["todo", "Pas fait"], ["doing", "En cours"], ["done", "Fait"]];
    const tile = o => {
      const s = o.s, st = subjectStats(profile, s), empty = isEmpty(s);
      const best = st.qcm && st.qcm.best != null ? st.qcm.best : null;
      return `
      <div class="tile" role="link" tabindex="0" data-href="#/${profile.id}/${s.id}" data-status="${o.status}" style="--sc:${s.color}">
        <div class="tile-top">
          <span class="status-pill ${o.status}">${STAT[o.status]}</span>
          ${examTag(daysLeft((meta[s.id] || {}).exam)) ? `<span class="exam-pill${daysLeft((meta[s.id] || {}).exam) <= 7 ? " soon" : ""}">${icon("calendar")}${examTag(daysLeft((meta[s.id] || {}).exam))}</span>` : ""}
          <button class="star${o.fav ? " on" : ""}" data-fav="${s.id}" title="${o.fav ? "Retirer des favoris" : "Ajouter aux favoris"}">${icon("star")}</button>
        </div>
        <div class="tile-art">${s.iconImg ? subjIcon(s, "tile-icon") : `<span class="subject-badge big">${esc(s.abbr || s.title.charAt(0))}</span>`}</div>
        <div class="tile-title">${esc(s.title)}</div>
        <div class="tile-meta">${empty ? `<span class="tag wait">En attente du cours</span>` :
          `${plural(st.chapters, "chapitre")} · ${plural(s.flash.length, "carte")} · ${plural(s.qcm.length, "question")}`}</div>
        <div class="tile-score">
          <span>${icon("award")}${best != null ? `Meilleur QCM : <b>${best} %</b>` : "QCM pas encore fait"}</span>
          <span>${icon("clock")}<b>${Track.fmt(Track.totals(profile.id).bySubject[s.id] || 0, true)}</b></span>
          ${st.missed ? `<span class="warn">${icon("target")}${st.missed} à revoir</span>` : ""}
        </div>
        <div class="status-seg" role="group" aria-label="Statut">
          ${["todo", "doing", "done"].map(v => `<button data-status-set="${v}" data-id="${s.id}" aria-pressed="${v === o.status}">${STAT[v]}</button>`).join("")}
        </div>
        <kbd class="tile-key">${o.k + 1}</kbd>
      </div>`;
    };
    view().innerHTML = `
      <section class="page">
        <div class="page-head"><div><h1>Bonjour ${esc(profile.name)}${heart(profile)}</h1><p class="page-sub">Choisis une matière pour réviser tes partiels.</p></div></div>
        ${dashboardHTML(profile)}
        <h2 class="section-title">Mes matières</h2>
        <div class="home-filters">
          ${FILTERS.map(([v, l]) => `<button class="filter-chip" data-home-filter="${v}" aria-pressed="${v === filter}">${v === "fav" ? icon("star") : ""}${l}<b>${items.filter(o => match(o, v)).length}</b></button>`).join("")}
        </div>
        <div class="tile-grid">
          ${shown.map(tile).join("")}
          ${!shown.length ? `<div class="tile tile-empty">${icon(filter === "fav" ? "star" : "checklist")}<b>Aucune matière ici</b><small>${filter === "fav" ? "Clique sur l'étoile d'une matière pour l'ajouter à tes favoris." : "Change le statut d'une matière avec les boutons en bas de sa tuile."}</small></div>` : ""}
          ${filter === "all" ? `<div class="tile tile-soon">${icon("stack")}<b>Bientôt d'autres matières</b><small>Tes prochains cours apparaîtront ici.</small></div>` : ""}
        </div>
      </section>`;
  }

  /* Accueil : favoris, statut et filtre des matières */
  function setSubjectMeta(id, patch) {
    const key = `rev:${cur.profile.id}:subjmeta`;
    const meta = Store.get(key, {});
    meta[id] = Object.assign({}, meta[id], patch);
    Store.set(key, meta);
    const y = $("#scroller").scrollTop;
    renderProfileHome(cur.profile);
    $("#scroller").scrollTop = y;
  }

  /* Bandeau de la matière : temps passé, date du partiel, notes */
  function subjectInfoHTML(profile, S) {
    const T = Track.totals(profile.id);
    const meta = (Store.get(`rev:${profile.id}:subjmeta`, {})[S.id]) || {};
    const left = daysLeft(meta.exam);
    const nNotes = window.Notes ? Notes.count(profile.id, S.id) : 0;
    return `
      <div class="subj-info">
        <div class="si-item">${icon("clock")}<span><small>Temps passé sur ce cours</small><b>${Track.fmt(T.bySubject[S.id] || 0)}</b></span></div>
        <div class="si-item">${icon("calendar")}<span><small>Aujourd'hui</small><b>${Track.fmt(T.todayBy[S.id] || 0)}</b></span></div>
        <label class="si-item si-exam${left != null && left >= 0 && left <= 7 ? " soon" : ""}">${icon("target")}<span><small>${left != null && left >= 0 ? esc(examTag(left)) : "Date du partiel"}</small>
          <input type="date" data-exam="${S.id}" value="${esc(meta.exam || "")}"></span></label>
        <a class="si-item si-link" href="#/${profile.id}/notes" data-note-subject="${S.id}">${icon("note")}<span><small>Mes notes</small><b>${nNotes ? plural(nNotes, "note") : "Prendre une note"}</b></span>${icon("right", "go")}</a>
      </div>`;
  }

  function renderSubjectHome(profile, S) {
    const st = subjectStats(profile, S);
    const chapters = U.chaptersOf(S);
    const base = `#/${profile.id}/${S.id}`;
    const empty = isEmpty(S);
    setTitlebar([{ label: S.title }]);
    const best = st.qcm && st.qcm.best != null ? st.qcm.best : null;
    view().innerHTML = `
      <section class="page">
        <div class="page-head">
          ${S.iconImg ? subjIcon(S, "page-icon") : ""}
          <div class="page-head-txt">
            <p class="eyebrow">Matière</p>
            <h1>${esc(S.title)}</h1>
            ${empty ? "" : `<p class="page-sub">${plural(st.chapters, "chapitre")} · ${plural(S.rappels.length, "fiche")} · ${plural(S.flash.length, "flashcard")} · ${plural(S.qcm.length, "question")}</p>`}
          </div>
          ${empty ? `<span class="tag wait big">En attente du cours</span>` : ""}
        </div>

        ${subjectInfoHTML(profile, S)}

        <h2 class="section-title">Par où commencer ?</h2>
        <div class="steps">
          <a class="step" href="${base}/rappels">
            <span class="step-top"><span class="step-n">1</span><span class="step-ico">${icon("book")}</span><kbd>1</kbd></span>
            <b>Lire les fiches de cours</b>
            <small>Le résumé de chaque chapitre : points clés, définitions et ce qu'il faut retenir.</small>
            <span class="step-meta">${plural(S.rappels.length, "fiche")}</span>
          </a>
          <a class="step" href="${base}/flash">
            <span class="step-top"><span class="step-n">2</span><span class="step-ico">${icon("cards")}</span><kbd>2</kbd></span>
            <b>S'entraîner avec les flashcards</b>
            <small>Lis la question, réfléchis, retourne la carte. Celles que tu ne sais pas sont mises de côté pour plus tard.</small>
            <span class="step-meta">${plural(S.flash.length, "carte")}${st.missed ? ` · <em>${st.missed} à revoir</em>` : ""}</span>
          </a>
          <a class="step" href="${base}/qcm">
            <span class="step-top"><span class="step-n">3</span><span class="step-ico">${icon("checklist")}</span><kbd>3</kbd></span>
            <b>S'évaluer avec le QCM</b>
            <small>Des questions tirées au hasard, comme le jour du contrôle, avec une note sur 20 et la correction.</small>
            <span class="step-meta">${best != null ? `Meilleur score : <em>${best} %</em>` : plural(S.qcm.length, "question")}</span>
          </a>
        </div>

        ${empty || !Assistant.available() ? "" : `
        <a class="assist-banner" href="#/${profile.id}/assistant" data-scope="${S.id}">
          <span class="step-ico">${icon("sparkle")}</span>
          <span><b>Une question sur le cours ?</b><small>Prof Susuzouzou t'explique une notion, détaille un calcul ou t'interroge.</small></span>
          <span class="assist-go">Demander à Prof Susuzouzou ${icon("arrow")}</span>
        </a>`}

        <h2 class="section-title">Réviser un chapitre</h2>
        ${chapters.length ? `
        <div class="list">
          ${chapters.map(c => {
            const r = S.rappels.find(x => x.chap === c);
            const nf = S.flash.filter(x => x[0] === c).length;
            const nq = S.qcm.filter(x => x[0] === c).length;
            return `<div class="list-row chapter-row">
              <span class="ch-name">${esc(c)}</span>
              <span class="ch-title">${r ? esc(r.titre) : ""}</span>
              <span class="ch-actions">
                ${r ? `<a class="chip-btn" href="${base}/rappels" data-chap="${esc(c)}" title="Lire la fiche">${icon("book")}Fiche</a>` : ""}
                ${nf ? `<a class="chip-btn" href="${base}/flash" data-chap="${esc(c)}" title="Flashcards du chapitre">${icon("cards")}${nf}</a>` : ""}
                ${nq ? `<a class="chip-btn" href="${base}/qcm" data-chap="${esc(c)}" title="QCM du chapitre">${icon("checklist")}${nq}</a>` : ""}
              </span>
            </div>`;
          }).join("")}
        </div>` : `
        <div class="empty slim">${icon("doc", "empty-ico")}<h3>Le cours n'a pas encore été ajouté</h3>
          <p>Les chapitres, flashcards, fiches de rappel et questions de QCM apparaîtront ici.</p></div>`}
      </section>`;
  }

  function renderMode(profile, S, mode) {
    const C = mode === "qcm" ? Qcm : mode === "rappels" ? Rappels : mode === "assistant" ? Assistant : mode === "notes" ? Notes : Flashcards;
    ctrl = C;
    setTitlebar(S ? [{ label: S.title, href: `#/${profile.id}/${S.id}` }, { label: MODES[mode] }] : [{ label: MODES[mode] }]);
    C.mount(view(), { profile, subject: S });
    if (pendingChapter) {
      const sel = $(".chap-select", view());
      if (sel && Array.from(sel.options).some(o => o.value === pendingChapter)) {
        sel.value = pendingChapter;
        sel.dispatchEvent(new Event("change"));
      }
      pendingChapter = null;
    }
  }

  /* ---------------- Tutoriel ---------------- */
  /* Version du tutoriel : l'augmenter le rouvre une fois pour montrer les nouveautés */
  const TUTO_VERSION = 3;
  const TUTO = [
    { ico: "stack", title: "Bienvenue dans Révisions",
      text: "L'application t'aide à préparer tes partiels, matière par matière. Ce petit tour dure une minute et te montre tout ce qu'il faut savoir." },
    { ico: "grid", title: "Ton accueil en tuiles",
      text: "Chaque matière a sa tuile. Clique dessus pour l'ouvrir et commencer à réviser.",
      tips: ["L'étoile ★ met une matière en favori : elle passe en premier", "En bas de la tuile, indique où tu en es : Pas fait, En cours ou Fait", "Les filtres en haut n'affichent que tes favoris ou un statut"] },
    { ico: "book", title: "1. Lis les fiches de cours",
      text: "Chaque chapitre a sa fiche : un résumé, les points clés, les définitions et ce qu'il faut retenir. C'est le point de départ.",
      tips: ["Choisis un chapitre en haut de la page", "Un bouton t'emmène ensuite vers les flashcards de ce chapitre"] },
    { ico: "cards", title: "2. Entraîne-toi avec les flashcards",
      text: "Lis la question, cherche la réponse dans ta tête, puis retourne la carte. Dis honnêtement si tu savais.",
      tips: ["« Je ne savais pas » : la carte est gardée dans « À revoir »", "À la fin du paquet, tu peux revoir seulement les cartes ratées"] },
    { ico: "checklist", title: "3. Évalue-toi avec le QCM",
      text: "Une évaluation tire des questions au hasard, comme le jour du contrôle. Coche une ou plusieurs réponses, puis valide.",
      tips: ["+1 si tout est juste, +½ si c'est incomplet, 0 en cas d'erreur", "À la fin : ta note sur 20, un petit message et la correction de chaque question", "Toutes les 10 questions, un mot d'encouragement apparaît (désactivable)"] },
    { ico: "sparkle", title: "Prof Susuzouzou",
      text: "Ton prof particulier répond à tes questions à partir de ton cours. Il t'explique, il t'interroge et il te donne des méthodes. Toutes tes conversations sont gardées, comme dans une messagerie.",
      tips: ["« Nouvelle conversation » n'efface rien : les anciennes restent dans la liste à gauche", "Les boutons ✨ des flashcards et du QCM l'ouvrent directement ; « Revenir où j'en étais » te ramène à ta carte", "Il a besoin d'Internet ; une réponse peut prendre quelques secondes"] },
    { ico: "chart", title: "Ton temps et tes progrès",
      text: "Le temps de révision est compté tout seul quand tu travailles une matière. Ton accueil montre ton objectif du jour, ta série de jours et un graphique de chaque profil.",
      tips: ["« Statistiques » : temps par cours, total, notes de QCM", "Indique la date de ton partiel sur la page d'une matière : un compte à rebours s'affiche", "« Reprendre » te ramène à la carte ou à la question où tu t'étais arrêté"] },
    { ico: "note", title: "Notes et pauses",
      text: "Dans « Notes », écris tes idées, questions et points à revoir ; tout est enregistré automatiquement. Après une heure de révision, un petit rappel te propose une pause de 5 à 10 minutes.",
      tips: ["Une note peut être rattachée à une matière", "Le rappel de pause se règle dans Réglages › Notifications", "Tout est sauvegardé sur ton ordinateur : rien n'est perdu en fermant l'application"] },
    { ico: "sliders", title: "Quelques astuces",
      text: "Tout se retrouve dans la barre de gauche : l'Assistant, tes matières, puis Fiches, Flashcards et QCM.",
      tips: ["Réglages : thème clair ou sombre, taille du texte, encouragements…", "Touche ? : les raccourcis clavier (Espace, flèches, Entrée)", "Tes cours et l'application se mettent à jour tout seuls", "Ce tutoriel reste disponible dans la barre de gauche"] }
  ];
  let tutoStep = 0;

  function renderTuto() {
    const s = TUTO[tutoStep], last = tutoStep === TUTO.length - 1;
    $("#tuto .dialog").innerHTML = `
      <div class="tuto-art">${icon(s.ico)}</div>
      <div class="tuto-body">
        <h2>${esc(s.title)}</h2>
        <p>${esc(s.text)}</p>
        ${s.tips ? `<ul class="tuto-tips">${s.tips.map(t => `<li>${icon("check")}<span>${esc(t)}</span></li>`).join("")}</ul>` : ""}
      </div>
      <div class="tuto-dots">${TUTO.map((_, i) => `<span class="${i === tutoStep ? "on" : ""}"></span>`).join("")}</div>
      <div class="dialog-foot">
        ${last ? "" : `<button class="btn subtle" data-app="tuto-close">Passer</button>`}
        <span class="spacer"></span>
        ${tutoStep ? `<button class="btn" data-app="tuto-prev">Précédent</button>` : ""}
        <button class="btn primary" data-app="tuto-next">${last ? "C'est parti !" : "Suivant"}${last ? "" : icon("arrow")}</button>
      </div>`;
  }
  function openTuto() { tutoStep = 0; renderTuto(); $("#tuto").hidden = false; }
  function closeTuto() {
    $("#tuto").hidden = true;
    if (cur.profile) Store.set(`rev:${cur.profile.id}:tuto`, TUTO_VERSION);
  }
  function tutoMove(d) {
    if (tutoStep + d >= TUTO.length) { closeTuto(); return; }
    tutoStep = Math.max(0, tutoStep + d); renderTuto();
  }

  /* ---------------- Routeur ---------------- */
  function route() {
    if (ctrl) { ctrl.unmount(); ctrl = null; }
    openSettings(false); toggleHelp(false);
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    const profile = profileById(parts[0]);
    const prevProfile = cur.profile && cur.profile.id;
    cur = { profile: profile || null, subject: null, mode: null };

    if (!profile) {
      Track.setContext(null, null, null);
      loadPrefs(null); prefs.theme = Store.get("rev:launch:theme", "auto"); applyPrefs(); renderProfiles();
      document.title = "Révisions";
      $("#scroller").scrollTop = 0;
      return;
    }
    if (prevProfile !== profile.id) loadPrefs(profile.id);
    $("#app").classList.remove("no-sidebar");
    if (sidebarFor !== profile.id) renderSidebar(profile);

    const page = ["assistant", "notes", "stats"].includes(parts[1]) ? parts[1] : null;
    const general = page === "assistant";
    const S = page ? null : subjectsOf(profile.id).find(s => s.id === parts[1]);
    cur.subject = S || null;
    if (S && parts[2] === "assistant") { pendingScope = S.id; location.replace(`#/${profile.id}/assistant`); return; }
    cur.mode = page || (S && ["flash", "rappels", "qcm"].includes(parts[2]) ? parts[2] : null);
    applyPrefs(); markSidebar();
    Track.setContext(profile.id, S ? S.id : null, cur.mode);
    updateToday();

    const seen = Store.get(`rev:${profile.id}:tuto`, 0);
    if ((seen === true ? 1 : +seen || 0) < TUTO_VERSION && $("#tuto").hidden) setTimeout(openTuto, 350);

    if (page === "stats") { setTitlebar([{ label: "Statistiques" }]); Stats.render(view(), profile); document.title = `Statistiques · ${profile.name}`; }
    else if (page) { renderMode(profile, null, page); document.title = `${MODES[page]} · ${profile.name}`; }
    else if (!S) { renderProfileHome(profile); document.title = `Révisions · ${profile.name}`; }
    else if (!cur.mode) { renderSubjectHome(profile, S); document.title = `${S.title} · Révisions`; }
    else { renderMode(profile, S, cur.mode); document.title = `${S.title} · ${MODES[cur.mode]}`; }
    $("#scroller").scrollTop = 0;
  }

  /* ---------------- Clavier ---------------- */
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (!$("#tuto").hidden) {
      if (e.key === "Escape") closeTuto();
      else if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); tutoMove(1); }
      else if (e.key === "ArrowLeft") tutoMove(-1);
      return;
    }
    if (e.key === "Escape") { toggleHelp(false); openSettings(false); return; }
    if (e.key === "?" || e.key === "h" || e.key === "H") { e.preventDefault(); toggleHelp(); return; }
    if (!$("#help").hidden || !$("#settings").hidden) return;
    if (!prefs.kbd) return;

    if (e.key === "Enter" && e.target.matches && e.target.matches(".tile[data-href]")) { location.hash = e.target.dataset.href; return; }
    if (ctrl) { if (ctrl.onKey(e)) e.preventDefault(); return; }

    const n = e.key >= "1" && e.key <= "9" ? +e.key : 0;
    if (!n) return;
    if (!cur.profile) { const p = PROFILES[n - 1]; if (p) location.hash = `#/${p.id}`; }
    else if (!cur.subject) { const s = subjectsOf(cur.profile.id)[n - 1]; if (s) location.hash = `#/${cur.profile.id}/${s.id}`; }
    else if (n >= 1 && n <= 3) location.hash = `#/${cur.profile.id}/${cur.subject.id}/${["rappels", "flash", "qcm"][n - 1]}`;
  }

  /* ---------------- Démarrage ---------------- */
  function init() {
    $("#settings-x").innerHTML = icon("x");
    document.addEventListener("click", e => {
      const a = e.target.closest("[data-app]");
      if (a) {
        const act = a.dataset.app;
        if (act === "help") { openSettings(false); toggleHelp(true); }
        else if (act === "help-close") toggleHelp(false);
        else if (act === "settings") openSettings(true);
        else if (act === "settings-close") openSettings(false);
        else if (act === "settings-reset") resetPrefs();
        else if (act === "update") installUpdate();
        else if (act === "upd-close") $("#upd").hidden = true;
        else if (act === "data-folder") { if (Store.openFolder) Store.openFolder(); }
        else if (act === "test-break") { openSettings(false); Track.showBreak(); }
        else if (act === "iphone-copy") { const l = iphoneLink(); if (l && navigator.clipboard) navigator.clipboard.writeText(l).then(() => toast("Lien copié")); }
        else if (act === "sync-now") { if (window.Sync) { Sync.soon(true); toast("Synchronisation lancée"); } }
        else if (act === "tuto") { openSettings(false); openTuto(); }
        else if (act === "tuto-close") closeTuto();
        else if (act === "tuto-next") tutoMove(1);
        else if (act === "tuto-prev") tutoMove(-1);
        return;
      }
      const lt = e.target.closest("[data-launch-theme]");
      if (lt) { setLaunchTheme(lt.dataset.launchTheme); return; }
      const fav = e.target.closest("[data-fav]");
      if (fav && cur.profile) { const m = Store.get(`rev:${cur.profile.id}:subjmeta`, {}); setSubjectMeta(fav.dataset.fav, { fav: !(m[fav.dataset.fav] || {}).fav }); return; }
      const ss = e.target.closest("[data-status-set]");
      if (ss && cur.profile) { setSubjectMeta(ss.dataset.id, { status: ss.dataset.statusSet }); return; }
      const hf = e.target.closest("[data-home-filter]");
      if (hf && cur.profile) { Store.set(`rev:${cur.profile.id}:homefilter`, hf.dataset.homeFilter); renderProfileHome(cur.profile); return; }
      const tl = e.target.closest(".tile[data-href]");
      if (tl) { location.hash = tl.dataset.href; return; }
      const sc = e.target.closest("a[data-scope]");
      if (sc) pendingScope = sc.dataset.scope;
      const ch = e.target.closest("a[data-chap]");
      if (ch) pendingChapter = ch.dataset.chap;
      const ns = e.target.closest("a[data-note-subject]");
      if (ns) pendingNoteSubject = ns.dataset.noteSubject;
    });
    document.addEventListener("change", e => {
      const ex = e.target.closest("input[data-exam]");
      if (ex && cur.profile) {
        const key = `rev:${cur.profile.id}:subjmeta`, meta = Store.get(key, {});
        meta[ex.dataset.exam] = Object.assign({}, meta[ex.dataset.exam], { exam: ex.value || null });
        Store.set(key, meta);
        toast(ex.value ? "Date du partiel enregistrée" : "Date du partiel effacée");
        if (cur.subject && !cur.mode) { const y = $("#scroller").scrollTop; renderSubjectHome(cur.profile, cur.subject); $("#scroller").scrollTop = y; }
      }
    });
    ["#settings", "#help"].forEach(id => $(id).addEventListener("mousedown", e => {
      if (e.target === $(id)) { $(id).hidden = true; }
    }));
    $("#tuto").addEventListener("mousedown", e => { if (e.target.id === "tuto") closeTuto(); });
    $$("[data-ico]").forEach(el => { el.outerHTML = icon(el.dataset.ico); });
    $("#settings").addEventListener("click", onPrefClick);
    if (bridge && bridge.getVersion) bridge.getVersion().then(v => { $("#prefs-ver").textContent = "Version " + v; $("#about-ver").textContent = "Version " + v; });
    $("#settings").addEventListener("input", onPrefInput);
    $("#settings").addEventListener("change", onPrefInput);
    document.addEventListener("keydown", onKey);
    window.addEventListener("hashchange", route);
    mq.addEventListener("change", () => { if (prefs.theme === "auto") applyPrefs(); });
    loadCachedContent();
    renderIphone();
    Track.init();
    Track.onTick(updateToday);
    if (window.Sync) {
      Sync.onUpdate(u => {
        if (u.kind === "event" && u.ev.type === "qcm" && prefs.remoteNotif) {
          const p = profileById(u.pid);
          if (p && (!cur.profile || cur.profile.id !== u.pid))
            notice({ avatar: avatar(p, "sm"), title: `${p.name} a terminé un QCM : ${String(u.ev.n20).replace(".", ",")} / 20`, text: `${u.ev.title || ""} · ${u.ev.n} questions` });
        }
        if (u.kind === "data" || u.kind === "event" || u.kind === "remote") {
          if (cur.profile && u.pid === cur.profile.id && u.keys && u.keys.some(k => k.endsWith(":prefs"))) { loadPrefs(cur.profile.id); applyPrefs(); }
          if (ctrl && ctrl.remote && u.keys) ctrl.remote(u.pid, u.keys);
          else if (!ctrl) refreshView();
        }
        const st = document.getElementById("sync-state");
        if (st) st.textContent = syncText();
      });
      Sync.init();
    }
    route();
    checkRemote();
    /* Fin du chargement : on laisse l'animation se jouer au moins ~1,4 s */
    const splash = $("#splash");
    if (splash) {
      const wait = Math.max(0, 1400 - performance.now());
      setTimeout(() => {
        splash.classList.add("hide");
        setTimeout(() => splash.remove(), 600);
      }, wait);
    }
  }

  function setPref(k, v) { prefs[k] = v; savePrefs(); }
  function studyChapter(mode, chap) {
    if (!cur.profile || !cur.subject) return;
    pendingChapter = chap;
    location.hash = `#/${cur.profile.id}/${cur.subject.id}/${mode}`;
  }

  let pendingPrompt = null, pendingScope = null, pendingOpts = null, pendingNoteSubject = null;
  function askAssistant(text, scope, opts) {
    if (!cur.profile) return;
    pendingPrompt = text || null;
    pendingScope = scope || (cur.subject && cur.subject.id) || null;
    pendingOpts = opts || null;
    location.hash = `#/${cur.profile.id}/assistant`;
  }
  function takePendingPrompt() { const p = pendingPrompt; pendingPrompt = null; return p; }
  function takePendingScope() { const s = pendingScope; pendingScope = null; return s; }
  function takePendingOpts() { const o = pendingOpts; pendingOpts = null; return o; }
  function takePendingNoteSubject() { const o = pendingNoteSubject; pendingNoteSubject = null; return o; }

  /* Temps du jour dans la barre latérale */
  function updateToday() {
    const el = document.getElementById("sb-today");
    if (el && cur.profile) { const t = Track.totals(cur.profile.id).today; el.textContent = t >= 60 ? Track.fmt(t, true) : ""; }
  }

  /* Notification en haut à droite (activité des autres profils) */
  function notice(o) {
    const box = $("#notices");
    if (!box) return;
    const n = document.createElement("div");
    n.className = "notice";
    n.innerHTML = `${o.avatar || `<span class="notice-ico">${icon(o.ico || "bell")}</span>`}
      <div class="notice-body"><b>${esc(o.title)}</b><small>${esc(o.text || "")}</small></div>
      <button class="icon-btn" title="Fermer">${icon("x")}</button>`;
    n.querySelector("button").onclick = () => n.remove();
    box.appendChild(n);
    requestAnimationFrame(() => n.classList.add("show"));
    setTimeout(() => { n.classList.remove("show"); setTimeout(() => n.remove(), 400); }, 9000);
  }

  return { init, prefs: () => prefs, setPref, toast, notice, studyChapter, askAssistant, takePendingPrompt, takePendingScope, takePendingOpts, takePendingNoteSubject };
})();

/* Sur téléphone, l'application démarre une fois activée et les cours reçus (mobile-boot.js) */
document.addEventListener("DOMContentLoaded", () => { if (!window.MOBILE || window.MOBILE.ready) App.init(); });
