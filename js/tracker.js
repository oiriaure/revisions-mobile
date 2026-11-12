/* ------------------------------------------------------------------
   Suivi du temps de révision, objectif du jour, série de jours,
   rappel de pause, journal d'activité.
   - Le temps ne compte que si la fenêtre est au premier plan et que
     l'on a bougé la souris / tapé au clavier dans les 3 dernières minutes.
   - rev:<profil>:time = { "AAAA-MM-JJ": { _total: s, <matière>: s, _prof: s, _notes: s } }
     (temps de CET ordinateur ; la synchronisation ajoute celui des autres)
------------------------------------------------------------------- */
window.Track = (function () {
  "use strict";
  const { $, esc, Store, icon } = U;
  const TICK = 15000, IDLE = 3 * 60000, GAP = 5 * 60000;
  let ctx = { pid: null, sid: null, mode: null };
  let lastAct = Date.now(), lastTick = Date.now(), lastStudy = 0;
  let cont = 0;               // secondes de révision sans vraie pause
  let snoozeUntil = 0;
  const hooks = [], evHooks = [];

  const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const timeKey = pid => `rev:${pid}:time`;

  function setContext(pid, sid, mode) { ctx = { pid, sid, mode }; }
  const studying = () => ctx.pid && (ctx.sid || ctx.mode === "assistant" || ctx.mode === "notes");
  const bucket = () => ctx.sid || (ctx.mode === "assistant" ? "_prof" : ctx.mode === "notes" ? "_notes" : null);

  function tick() {
    const now = Date.now();
    const dt = Math.min(now - lastTick, 2 * TICK);
    lastTick = now;
    const active = !document.hidden && document.hasFocus() && now - lastAct < IDLE;
    if (!active || !studying()) {
      if (now - lastStudy > GAP) cont = 0;     // une vraie pause remet le compteur à zéro
      return;
    }
    const sec = Math.round(dt / 1000);
    if (sec <= 0) return;
    lastStudy = now;
    const k = timeKey(ctx.pid), all = Store.get(k, {}), d = dayKey();
    const day = all[d] || (all[d] = {});
    day._total = (day._total || 0) + sec;
    const b = bucket();
    if (b) day[b] = (day[b] || 0) + sec;
    Store.set(k, all);
    cont += sec;
    checkBreak();
    hooks.forEach(f => f());
  }

  /* ---------- Rappel de pause ---------- */
  function checkBreak() {
    const p = App.prefs();
    if (!p.breakOn || Date.now() < snoozeUntil) return;
    if (cont >= (p.breakEvery || 60) * 60) showBreak();
  }
  function showBreak() {
    let b = $("#pause-pop");
    if (!b) return;
    const mins = Math.max(Math.round(cont / 60), App.prefs().breakEvery || 60);
    const h = mins >= 60 ? `${Math.floor(mins / 60)} h${mins % 60 ? String(mins % 60).padStart(2, "0") : ""}` : `${mins} min`;
    b.innerHTML = `
      <span class="pause-ico">${icon("pause")}</span>
      <div class="pause-body">
        <b>C'est l'heure d'une pause</b>
        <small>Tu révises depuis ${h}. Prends 5 à 10 minutes : lève-toi, bois de l'eau, aère-toi. Ton cerveau retiendra mieux.</small>
        <div class="pause-actions">
          <button class="btn primary small" data-pause="take">${icon("check")}Je fais une pause</button>
          <button class="btn subtle small" data-pause="later">Dans 15 min</button>
        </div>
        <label class="cheer-off"><input type="checkbox" data-pause="off"> Ne plus afficher ce rappel</label>
      </div>
      <button class="icon-btn" data-pause="close" title="Fermer">${icon("x")}</button>`;
    b.className = "show";
    cont = 0;
    snoozeUntil = Date.now() + 10 * 60000;
  }
  function onPauseClick(e) {
    const t = e.target.closest("[data-pause]");
    if (!t) return;
    const b = $("#pause-pop");
    const a = t.dataset.pause;
    if (a === "off") {
      App.setPref("breakOn", !t.checked);
      App.toast(t.checked ? "Rappel de pause désactivé (réactivable dans Réglages › Notifications)" : "Rappel de pause réactivé");
      return;
    }
    if (a === "later") { snoozeUntil = Date.now() + 15 * 60000; cont = (App.prefs().breakEvery || 60) * 60; }
    if (a === "take") { cont = 0; snoozeUntil = Date.now() + 5 * 60000; App.toast("Bonne pause ! Le compteur repart de zéro."); }
    b.className = "";
  }

  /* ---------- Lecture des temps ---------- */
  /* Temps de tous les ordinateurs : celui-ci + ceux reçus par la synchronisation */
  function daysOf(pid) {
    const mine = Store.get(timeKey(pid), {});
    const out = JSON.parse(JSON.stringify(mine));
    const remote = window.Sync ? Sync.remoteTimes(pid) : [];
    remote.forEach(t => {
      Object.keys(t || {}).forEach(d => {
        const o = out[d] || (out[d] = {});
        Object.keys(t[d] || {}).forEach(b => { o[b] = (o[b] || 0) + (t[d][b] || 0); });
      });
    });
    return out;
  }
  function lastDays(pid, n, bucketName) {
    const all = daysOf(pid), res = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const k = dayKey(d);
      res.push({ day: k, date: d, sec: ((all[k] || {})[bucketName || "_total"]) || 0, detail: all[k] || {} });
    }
    return res;
  }
  function totals(pid) {
    const all = daysOf(pid), today = dayKey();
    const wk = lastDays(pid, 7).reduce((a, x) => a + x.sec, 0);
    const bySubject = {};
    let total = 0;
    Object.values(all).forEach(day => Object.keys(day).forEach(b => {
      if (b === "_total") total += day[b]; else bySubject[b] = (bySubject[b] || 0) + day[b];
    }));
    return { today: (all[today] || {})._total || 0, week: wk, total, bySubject, todayBy: all[today] || {} };
  }
  /* Série : jours consécutifs avec au moins 10 minutes (aujourd'hui compte s'il est atteint) */
  function streak(pid) {
    const all = daysOf(pid);
    const ok = d => ((all[dayKey(d)] || {})._total || 0) >= 600;
    const d = new Date();
    let n = 0;
    if (!ok(d)) d.setDate(d.getDate() - 1);
    while (ok(d)) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  /* Durée lisible : 1 h 05, 12 min, 40 s */
  function fmt(sec, short) {
    sec = Math.round(sec || 0);
    if (sec < 60) return sec ? `${sec} s` : "0 min";
    const m = Math.round(sec / 60);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    return short ? `${h} h${r ? String(r).padStart(2, "0") : ""}` : `${h} h ${String(r).padStart(2, "0")}`;
  }

  /* ---------- Journal d'activité (QCM terminés…) ---------- */
  function event(pid, ev) {
    const k = `rev:${pid}:events`;
    const list = Store.get(k, []);
    list.push(Object.assign({ t: Date.now(), id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5) }, ev));
    Store.set(k, list.slice(-600));
    evHooks.forEach(f => { try { f(pid, list[list.length - 1]); } catch (e) { /* un écran ne doit rien bloquer */ } });
    if (window.Sync) Sync.soon(true);
  }
  function events(pid) {
    const mine = Store.get(`rev:${pid}:events`, []);
    const remote = window.Sync ? Sync.remoteEvents(pid) : [];
    const seen = new Set();
    return mine.concat(remote).filter(e => e && !seen.has(e.id) && seen.add(e.id)).sort((a, b) => b.t - a.t);
  }

  function init() {
    ["mousemove", "keydown", "mousedown", "wheel", "touchstart"].forEach(ev =>
      document.addEventListener(ev, () => { lastAct = Date.now(); }, { passive: true, capture: true }));
    window.addEventListener("focus", () => { lastTick = Date.now(); });
    setInterval(tick, TICK);
    document.addEventListener("click", e => { if (e.target.closest("#pause-pop")) onPauseClick(e); });
  }

  return { init, setContext, totals, lastDays, streak, fmt, event, events, dayKey, onTick: f => hooks.push(f), onEvent: f => evHooks.push(f), showBreak };
})();
