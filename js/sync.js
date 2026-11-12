/* ------------------------------------------------------------------
   Synchronisation des profils entre ordinateurs (dépôt GitHub privé).
   Chaque ordinateur dépose un fichier par profil :
     sync/<profil>/<ordinateur>.json
   contenant : son temps de révision, son journal d'activité et une
   copie datée des données du profil (réglages, favoris, notes, QCM…).
   À la lecture : les temps s'additionnent, les journaux se fusionnent,
   et pour chaque donnée la version la plus récente gagne.

   Quasi instantané :
   - envoi ~2 s après une modification (QCM terminé : ~1 s) ;
   - vérification toutes les 4 s (12 s si la fenêtre n'est pas active)
     grâce à une requête conditionnelle (ETag) qui ne coûte rien tant
     que rien n'a changé ; on ne télécharge que les fichiers modifiés.
   Premier démarrage sur un ordinateur : on récupère d'abord les données
   des autres ordinateurs, pour ne pas les écraser avec des réglages vides.
------------------------------------------------------------------- */
window.Sync = (function () {
  "use strict";
  const { Store } = U;
  /* Clé : intégrée à la fabrication (sync-key.js), ou dans la configuration */
  const conf = () => {
    const a = window.SYNC_KEY || (window.APP_CONFIG || {}).sync || {};
    const b = (Store.get("rev:content", null) || {}).sync || {};
    return { repo: a.repo || b.repo || "oiriaure/revisions-sync", token: a.token || b.token || "", branch: a.branch || "main" };
  };
  const CFG = new Proxy({}, { get: (t, k) => conf()[k] });
  const on = () => !!(CFG.repo && CFG.token);
  const API = "https://api.github.com";
  const MTIME = "rev:sync:mtime";       // date de modification de chaque donnée
  const PULL_FAST = 3000, PULL_SLOW = 5000;
  const PUSH_DELAY = 1000, PUSH_SLOW = 75000;      // PUSH_SLOW : temps de révision + présence « en ligne »
  const ONLINE = 210000;                             // signalé il y a moins de 3,5 min = en ligne
  /* écart entre deux envois : court après un moment calme, plus long pendant une frappe continue
     (GitHub limite le nombre d'enregistrements par heure) */
  const pushGap = () => (Date.now() - lastPush < 30000 ? 8000 : 2500);

  /* Identifiant de cet ordinateur */
  let device = Store.get("rev:device", null);
  if (!device) { device = "pc-" + Math.random().toString(36).slice(2, 10); Store.set("rev:device", device); }
  const platform = window.MOBILE ? "iPhone" : (window.appWindow && window.appWindow.platform) === "darwin" ? "Mac" : "Windows";

  /* Données partagées d'un profil : tout « rev:<profil>:… » sauf ce qui est propre à cet ordinateur */
  const isShared = (pid, k) => k.startsWith(`rev:${pid}:`) && !/:(time|events|conv:cur|notes:cur)$/.test(k);
  const pidOf = k => { const m = k.match(/^rev:([a-z0-9_-]+):/); return m && PROFILES.some(p => p.id === m[1]) ? m[1] : null; };

  let mtimes = Store.get(MTIME, {});
  let joined = !!Store.get("rev:sync:joined", false);   // a déjà récupéré les données des autres
  const preJoin = new Set();                              // modifié avant la première récupération
  let applying = false;
  const fast = new Set(), slow = new Set();               // profils à envoyer vite / plus tard
  const seenVal = {};                                     // pour ignorer les enregistrements identiques
  const sig = k => { const v = Store.get(k, null); return v === null ? "∅" : JSON.stringify(v); };

  Store.onChange(k => {
    if (applying || !k.startsWith("rev:") || k === MTIME || k === "rev:content") return;
    const pid = pidOf(k);
    if (!pid) return;
    if (isShared(pid, k)) {
      const s = sig(k);
      if (seenVal[k] === s) return;
      seenVal[k] = s;
      if (joined) mtimes[k] = Date.now(); else { mtimes[k] = 2; preJoin.add(k); }
      saveMt();
      fast.add(pid);
    } else slow.add(pid);
    schedulePush(false);
  });
  let mtTimer = null;
  const saveMt = () => { clearTimeout(mtTimer); mtTimer = setTimeout(() => { applying = true; Store.set(MTIME, mtimes); applying = false; }, 400); };

  /* Fichiers reçus des autres ordinateurs : { pid: { device: data } } */
  const remote = Store.get("rev:sync:remote", {});
  const shas = Store.get("rev:sync:shas", {});      // sha connu de chaque fichier du dépôt
  let state = { last: null, error: null, pushed: null };
  const listeners = [];
  const emit = u => listeners.forEach(f => { try { f(u); } catch (e) { /* un écran ne doit pas bloquer la synchro */ } });

  const headers = () => ({ Authorization: `Bearer ${CFG.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" });
  const b64 = s => { const u = new TextEncoder().encode(s); let b = ""; for (let i = 0; i < u.length; i += 0x8000) b += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(b); };
  const unb64 = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), c => c.charCodeAt(0)));
  const path = (pid, dev) => `sync/${pid}/${dev}.json`;

  function snapshot(pid) {
    const keys = {};
    const all = new Set(Store.keys(`rev:${pid}:`).concat(Object.keys(mtimes).filter(k => k.startsWith(`rev:${pid}:`))));
    all.forEach(k => { if (isShared(pid, k)) keys[k] = { t: mtimes[k] || 1, v: Store.get(k, null) }; });
    const data = { v: 2, pid, device, platform, updated: Date.now(), active: activePid === pid && !document.hidden,
      time: Store.get(`rev:${pid}:time`, {}), events: Store.get(`rev:${pid}:events`, []).slice(-400), keys };
    let s = JSON.stringify(data);
    if (s.length > 700000) { delete keys[`rev:${pid}:convs`]; s = JSON.stringify(data); }   // limite de taille
    return s;
  }

  async function push(pid) {
    const p = path(pid, device);
    const body = { message: `${pid} depuis ${platform}`, content: b64(snapshot(pid)), branch: CFG.branch };
    if (shas[p]) body.sha = shas[p];
    let r = await fetch(`${API}/repos/${CFG.repo}/contents/${p}`, { method: "PUT", headers: headers(), body: JSON.stringify(body) });
    for (let i = 0; i < 2 && (r.status === 409 || r.status === 422); i++) {
      /* la copie connue n'est plus à jour, ou un autre ordinateur écrivait au même moment */
      await new Promise(res => setTimeout(res, 600 + Math.random() * 900));
      const g = await fetch(`${API}/repos/${CFG.repo}/contents/${p}?ref=${CFG.branch}&t=${Date.now()}`, { headers: headers(), cache: "no-store" });
      if (g.ok) body.sha = (await g.json()).sha; else delete body.sha;
      r = await fetch(`${API}/repos/${CFG.repo}/contents/${p}`, { method: "PUT", headers: headers(), body: JSON.stringify(body) });
    }
    if (!r.ok) throw new Error("envoi " + r.status);
    shas[p] = (await r.json()).content.sha;
    Store.set("rev:sync:shas", shas);
  }

  /* --- Lecture : une requête conditionnelle sur la branche, puis seulement ce qui a changé --- */
  let etag = null, headSha = null;
  async function pull() {
    const h = headers();
    if (etag) h["If-None-Match"] = etag;
    const r = await fetch(`${API}/repos/${CFG.repo}/git/ref/heads/${CFG.branch}`, { headers: h, cache: "no-store" });
    if (r.status === 304) return false;
    if (r.status === 404 || r.status === 409) return false;          // dépôt encore vide
    if (!r.ok) throw new Error("lecture " + r.status);
    etag = r.headers.get("ETag") || null;
    const sha = (await r.json()).object.sha;
    if (sha === headSha) return false;
    const t = await fetch(`${API}/repos/${CFG.repo}/git/trees/${sha}?recursive=1`, { headers: headers(), cache: "no-store" });
    if (!t.ok) throw new Error("lecture " + t.status);
    const tree = (await t.json()).tree || [];
    let changed = false;
    for (const f of tree) {
      const m = f.type === "blob" && f.path.match(/^sync\/([a-z0-9_-]+)\/([A-Za-z0-9_-]+)\.json$/);
      if (!m || !PROFILES.some(p => p.id === m[1])) continue;
      const pid = m[1], dev = m[2];
      if (dev === device) { shas[f.path] = f.sha; continue; }
      const known = remote[pid] && remote[pid][dev];
      if (known && known.__sha === f.sha) continue;
      const g = await fetch(`${API}/repos/${CFG.repo}/git/blobs/${f.sha}`, { headers: headers(), cache: "force-cache" });
      if (!g.ok) continue;
      let data;
      try { data = JSON.parse(unb64((await g.json()).content)); } catch (e) { continue; }
      data.__sha = f.sha;
      (remote[pid] || (remote[pid] = {}))[dev] = data;
      apply(pid, data);
      changed = true;
    }
    headSha = sha;
    Store.set("rev:sync:shas", shas);
    if (changed) Store.set("rev:sync:remote", strip(remote));
    return changed;
  }
  /* On garde en local ce qui sert à l'affichage (temps, activité), pas les copies complètes */
  function strip(r) {
    const o = {};
    Object.keys(r).forEach(pid => { o[pid] = {}; Object.keys(r[pid]).forEach(d => {
      const x = r[pid][d]; o[pid][d] = { __sha: x.__sha, device: x.device, platform: x.platform, updated: x.updated, active: x.active, time: x.time, events: x.events };
    }); });
    return o;
  }

  /* Applique les données plus récentes que les nôtres */
  function apply(pid, data) {
    if (!data || !data.keys) return;
    const fresh = [];
    applying = true;
    try {
      Object.keys(data.keys).forEach(k => {
        if (!isShared(pid, k)) return;
        const e = data.keys[k];
        /* avant la première récupération, ce qui existe ailleurs l'emporte sur les valeurs par défaut d'ici */
        if (e && (e.t > (mtimes[k] || 0) || (!joined && preJoin.has(k)))) {
          if (e.v === null) Store.del(k); else Store.set(k, e.v);
          mtimes[k] = e.t; seenVal[k] = sig(k); preJoin.delete(k); fresh.push(k);
        }
      });
      Store.set(MTIME, mtimes);
    } finally { applying = false; }
    /* Nouveaux QCM terminés sur un autre ordinateur */
    const seen = Store.get("rev:sync:seenEvents", []);
    const news = (data.events || []).filter(ev => ev && ev.type === "qcm" && !seen.includes(ev.id) && Date.now() - ev.t < 3 * 864e5);
    if (news.length) {
      Store.set("rev:sync:seenEvents", seen.concat(news.map(e => e.id)).slice(-400));
      news.forEach(ev => emit({ kind: "event", pid, ev }));
    }
    if (fresh.length) emit({ kind: "data", pid, keys: fresh });
    else emit({ kind: "remote", pid });     // temps / activité des autres ordinateurs
  }

  /* --- File d'attente : une seule opération réseau à la fois --- */
  let queue = Promise.resolve(), lastPush = 0, pushTimer = null, pushAt = 0;
  const enqueue = job => (queue = queue.then(job, job));

  async function doPush() {
    if (!joined) return;                      // on attend d'avoir récupéré les données des autres
    const now = Date.now();
    const list = Array.from(new Set([...fast, ...(now - lastPush > PUSH_SLOW || fast.size ? slow : [])]));
    if (!list.length) return;
    list.forEach(pid => { fast.delete(pid); slow.delete(pid); });
    lastPush = now;
    for (const pid of list) await push(pid);
    state.pushed = Date.now();
  }
  function schedulePush(urgent) {
    if (!on() || !started) return;
    const now = Date.now();
    let at;
    if (urgent) at = now + 800;
    else if (fast.size) at = Math.max(now + PUSH_DELAY, lastPush + pushGap());
    else at = Math.max(now + PUSH_DELAY, lastPush + PUSH_SLOW);
    if (pushTimer && pushAt <= at && !urgent) return;
    clearTimeout(pushTimer);
    pushAt = at;
    pushTimer = setTimeout(() => { pushTimer = null; enqueue(() => guard(doPush)); }, at - now);
  }

  async function guard(fn) {
    if (!on() || !navigator.onLine) return;
    try {
      await fn();
      state.last = Date.now(); state.error = null;
    } catch (e) {
      state.error = String(e.message || e);
      /* l'envoi n'a pas abouti : on réessaie plus tard */
      if (fn === doPush) { PROFILES.forEach(p => { if (Store.keys(`rev:${p.id}:`).length) fast.add(p.id); }); setTimeout(() => schedulePush(false), /40[13]|429/.test(state.error) ? 60000 : 15000); }
    }
    emit({ kind: "status" });
  }

  async function doPull() {
    await pull();
    if (!joined) {
      /* Premier démarrage sur cet ordinateur : ce qui a été modifié ici et n'existait pas ailleurs devient « récent » */
      joined = true; Store.set("rev:sync:joined", true);
      const now = Date.now();
      preJoin.forEach(k => { mtimes[k] = now; });
      preJoin.clear(); saveMt();
      PROFILES.forEach(p => { if (Store.keys(`rev:${p.id}:`).length) fast.add(p.id); });
      schedulePush(false);
    }
  }

  let pullTimer = null, gen = 0;
  function loop() {
    const g = ++gen;
    clearTimeout(pullTimer);
    enqueue(() => guard(doPull)).then(() => {
      if (g === gen) pullTimer = setTimeout(loop, document.hasFocus() ? PULL_FAST : PULL_SLOW);
    });
  }

  /* Appelé par l'application : true = événement important (QCM terminé), envoi immédiat */
  function soon(now) {
    if (!on() || !started) return;
    if (now) {
      slow.forEach(pid => fast.add(pid));
      schedulePush(true);
      loop();
    } else schedulePush(false);
  }

  let started = false;
  function init() {
    if (started) return;
    if (!on()) { setTimeout(init, 30000); return; }   // pas de clé dans cette version
    started = true;
    /* Valeurs actuelles, pour ne réagir qu'aux vrais changements */
    PROFILES.forEach(p => Store.keys(`rev:${p.id}:`).forEach(k => { if (isShared(p.id, k)) seenVal[k] = sig(k); }));
    if (!joined) {
      /* Les données déjà présentes sur cet ordinateur passent après celles des autres */
      PROFILES.forEach(p => Store.keys(`rev:${p.id}:`).forEach(k => { if (isShared(p.id, k)) { mtimes[k] = 2; preJoin.add(k); } }));
    }
    PROFILES.forEach(p => { if (Store.keys(`rev:${p.id}:`).length) fast.add(p.id); });
    loop();
    schedulePush(false);
    window.addEventListener("online", () => soon(true));
    window.addEventListener("focus", () => loop());
    /* Présence : on se signale régulièrement tant qu'un profil est ouvert */
    setInterval(() => { if (activePid && !document.hidden) { slow.add(activePid); schedulePush(false); } }, 30000);
    document.addEventListener("visibilitychange", () => { if (activePid) { fast.add(activePid); schedulePush(false); } });
  }

  /* Profil ouvert sur cet appareil (pour « en ligne ») */
  let activePid = null;
  function setActive(pid) {
    if (pid === activePid) return;
    [activePid, pid].forEach(p => { if (p) fast.add(p); });
    activePid = pid;
    schedulePush(false);
  }
  /* En ligne : un autre appareil a ce profil ouvert et s'est signalé récemment */
  function presence(pid) {
    if (activePid === pid) return { online: true, here: true, platform };
    const devs = Object.values(remote[pid] || {}).filter(d => d && d.updated);
    const live = devs.filter(d => d.active && Date.now() - d.updated < ONLINE).sort((a, b) => b.updated - a.updated)[0];
    if (live) return { online: true, platform: live.platform, at: live.updated };
    const last = devs.sort((a, b) => b.updated - a.updated)[0];
    return { online: false, at: last ? last.updated : 0, platform: last && last.platform };
  }

  const others = () => {
    const devs = new Set();
    Object.values(remote).forEach(byDev => Object.keys(byDev).forEach(d => devs.add(d)));
    return devs.size;
  };

  return {
    init, soon, setActive, presence, enabled: on, status: () => Object.assign({ others: others(), joined }, state), device: () => device,
    onUpdate: f => listeners.push(f),
    remoteTimes: pid => Object.values(remote[pid] || {}).map(d => d.time || {}),
    remoteEvents: pid => [].concat(...Object.values(remote[pid] || {}).map(d => d.events || [])),
    lastSeen: pid => Math.max(0, ...Object.values(remote[pid] || {}).map(d => d.updated || 0))
  };
})();
