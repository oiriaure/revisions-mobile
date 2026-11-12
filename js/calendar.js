/* ------------------------------------------------------------------
   Calendrier de révision : un calendrier par profil + une vue de tous
   les profils. Séances ajoutées à la main ou générées par
   « Organiser mon programme » (toutes les matières, dates de partiel,
   révisions espacées). Tout se modifie : glisser une séance sur un
   autre jour, cliquer pour la changer, cocher quand c'est fait.
   rev:<profil>:plan = { items: [{ id, date, time, dur, sid, kind, chap,
                          title, note, done, gen }], opts: {…} }
------------------------------------------------------------------- */
window.Plan = (function () {
  "use strict";
  const { $, $$, esc, Store, icon, chaptersOf } = U;
  const KINDS = {
    fiche: { label: "Fiches de cours", short: "Fiche", ico: "book", mode: "rappels" },
    flash: { label: "Flashcards", short: "Flashcards", ico: "cards", mode: "flash" },
    qcm: { label: "QCM", short: "QCM", ico: "checklist", mode: "qcm" },
    review: { label: "Révision espacée", short: "Révision", ico: "reset", mode: "flash" },
    exam: { label: "Partiel", short: "Partiel", ico: "target" },
    perso: { label: "Autre", short: "Séance", ico: "calendar" }
  };
  const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
  const key = pid => `rev:${pid}:plan`;
  const uiKey = pid => `rev:${pid}:planui`;
  const load = pid => Object.assign({ items: [], opts: null }, Store.get(key(pid), {}));
  const save = (pid, d) => Store.set(key(pid), d);
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const parse = s => new Date(s + "T00:00:00");
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const today = () => iso(new Date());
  const dow = s => (parse(s).getDay() + 6) % 7;                 // 0 = lundi
  const monday = s => addDays(s, -dow(s));
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const profile = id => PROFILES.find(p => p.id === id);
  const subject = id => SUBJECTS.find(s => s.id === id);
  const subjectsOf = pid => SUBJECTS.filter(s => s.profile === pid);
  const toMin = t => { const m = String(t || "").match(/^(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
  const hhmm = m => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const durTxt = m => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? String(m % 60).padStart(2, "0") : ""}` : `${m} min`;
  const dayLabel = (s, long) => {
    const d = parse(s), t = today();
    if (s === t) return "Aujourd'hui";
    if (s === addDays(t, 1)) return "Demain";
    if (s === addDays(t, -1)) return "Hier";
    return d.toLocaleDateString("fr-FR", long ? { weekday: "long", day: "numeric", month: "long" } : { weekday: "short", day: "numeric", month: "short" });
  };
  const colorOf = it => (subject(it.sid) || {}).color || (profile(it.pid) || {}).color || "var(--accent)";
  const titleOf = it => it.title || [KINDS[it.kind] ? KINDS[it.kind].label : "Séance", it.chap].filter(Boolean).join(" · ");

  /* Partiels : dates saisies sur la page de chaque matière */
  function exams(pid) {
    const meta = Store.get(`rev:${pid}:subjmeta`, {});
    return subjectsOf(pid).filter(s => meta[s.id] && meta[s.id].exam).map(s => ({
      id: "exam-" + s.id, virtual: true, pid, sid: s.id, kind: "exam", date: meta[s.id].exam, time: "", title: "Partiel · " + s.title
    }));
  }
  function itemsOf(pid) {
    return load(pid).items.map(it => Object.assign({ pid }, it)).concat(exams(pid))
      .sort((a, b) => a.date.localeCompare(b.date) || (toMin(a.time) ?? -1) - (toMin(b.time) ?? -1));
  }

  /* ---------------- État de l'écran ---------------- */
  let st = null;
  let mount = function (el, ctx) {
    const pid = ctx.profile.id;
    const ui = Object.assign({ scope: "me", view: "month", show: PROFILES.map(p => p.id) }, Store.get(uiKey(pid), {}));
    if (window.MOBILE && ui.view === "month" && !Store.get(uiKey(pid), null)) ui.view = "list";
    st = { el, pid, ui, anchor: today() };
    el.innerHTML = `<div class="mode cal-mode"></div>`;
    el.addEventListener("click", onClick);
    el.addEventListener("change", onChange);
    el.addEventListener("dragstart", onDragStart);
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onDrop);
    render();
  }
  function unmount() {
    if (!st) return;
    ["click", "change", "dragstart", "dragover", "dragleave", "drop"].forEach(ev =>
      st.el.removeEventListener(ev, { click: onClick, change: onChange, dragstart: onDragStart, dragover: onDragOver, dragleave: onDragLeave, drop: onDrop }[ev]));
    closeDialog();
    st = null;
  }
  const saveUI = () => Store.set(uiKey(st.pid), st.ui);
  const pids = () => st.ui.scope === "all" ? PROFILES.map(p => p.id).filter(id => st.ui.show.includes(id)) : [st.pid];
  const allItems = () => [].concat(...pids().map(itemsOf));
  const mineEditable = it => it.pid === st.pid && !it.virtual;

  function label() {
    const a = parse(st.anchor);
    if (st.ui.view === "month") return `${MONTHS[a.getMonth()].charAt(0).toUpperCase()}${MONTHS[a.getMonth()].slice(1)} ${a.getFullYear()}`;
    if (st.ui.view === "week") {
      const m = monday(st.anchor), e = addDays(m, 6), dm = parse(m), de = parse(e);
      return dm.getMonth() === de.getMonth() ? `${dm.getDate()} – ${de.getDate()} ${MONTHS[de.getMonth()]} ${de.getFullYear()}`
        : `${dm.getDate()} ${MONTHS[dm.getMonth()].slice(0, 4)}. – ${de.getDate()} ${MONTHS[de.getMonth()].slice(0, 4)}. ${de.getFullYear()}`;
    }
    return "Programme à venir";
  }

  function summaryHTML() {
    const items = itemsOf(st.pid).filter(it => !it.virtual);
    const m = monday(today()), e = addDays(m, 6);
    const wk = items.filter(it => it.date >= m && it.date <= e);
    const done = wk.filter(it => it.done).length;
    const late = items.filter(it => !it.done && it.date < today() && it.date >= addDays(today(), -21));
    const next = exams(st.pid).filter(x => x.date >= today()).sort((a, b) => a.date.localeCompare(b.date))[0];
    const left = next ? Math.round((parse(next.date) - parse(today())) / 864e5) : null;
    const mins = wk.reduce((a, it) => a + (it.dur || 0), 0);
    return `<div class="cal-summary">
      <div class="cs-item">${icon("check")}<span><small>Cette semaine</small><b>${done} / ${wk.length} séance${wk.length > 1 ? "s" : ""}</b></span>
        <span class="cs-bar"><i style="width:${wk.length ? Math.round(done / wk.length * 100) : 0}%"></i></span></div>
      <div class="cs-item">${icon("clock")}<span><small>Temps prévu cette semaine</small><b>${mins ? durTxt(mins) : "—"}</b></span></div>
      <div class="cs-item${left != null && left <= 7 ? " soon" : ""}">${icon("target")}<span><small>Prochain partiel</small><b>${next ? `${esc(subject(next.sid).title)} · ${left === 0 ? "aujourd'hui" : left === 1 ? "demain" : `dans ${left} j`}` : "Aucune date"}</b></span></div>
      ${late.length ? `<button class="cs-item cs-late" data-cal="late">${icon("reset")}<span><small>${late.length} séance${late.length > 1 ? "s" : ""} en retard</small><b>Reporter à aujourd'hui</b></span></button>` : ""}
    </div>`;
  }

  function render() {
    if (!st) return;
    const box = $(".cal-mode", st.el);
    const all = st.ui.scope === "all";
    const empty = !load(st.pid).items.length;
    box.innerHTML = `
      <div class="toolbar">
        <h2 class="toolbar-title">${icon("calendar")}Calendrier</h2>
        <div class="toolbar-right">
          <div class="seg-ctl" role="group" aria-label="Calendrier affiché">
            <button data-cal-scope="me" aria-pressed="${!all}">Mon calendrier</button>
            <button data-cal-scope="all" aria-pressed="${all}">Tous les profils</button>
          </div>
          <button class="btn primary" data-cal="gen">${icon("sparkle")}<span>Organiser mon programme</span></button>
        </div>
      </div>
      ${all ? `<div class="cal-people">${PROFILES.map(p => `<button class="filter-chip person" data-cal-show="${p.id}" aria-pressed="${st.ui.show.includes(p.id)}" style="--pc:${p.color}">${Social.avatar(p, "xxs")}${esc(p.name)}</button>`).join("")}
        <small>Les séances des autres profils sont en lecture seule.</small></div>` : summaryHTML()}
      ${empty && !all ? `<div class="cal-hero">
        <span class="step-ico">${icon("sparkle")}</span>
        <span><b>Crée ton programme de révision en 1 minute</b><small>Choisis tes matières, tes jours et ton temps disponible : les séances sont réparties jusqu'à tes partiels. Tu pourras tout modifier ensuite.</small></span>
        <button class="btn primary" data-cal="gen">Organiser mon programme</button>
      </div>` : ""}
      <div class="cal-bar">
        <div class="cal-nav">
          ${st.ui.view === "list" ? "" : `<button class="icon-btn" data-cal="prev" title="Précédent">${icon("left")}</button>
          <button class="btn small" data-cal="today">Aujourd'hui</button>
          <button class="icon-btn" data-cal="next" title="Suivant">${icon("right")}</button>`}
          <b class="cal-label">${esc(label())}</b>
        </div>
        <div class="seg-ctl" role="group" aria-label="Affichage">
          <button data-cal-view="month" aria-pressed="${st.ui.view === "month"}">Mois</button>
          <button data-cal-view="week" aria-pressed="${st.ui.view === "week"}">Semaine</button>
          <button data-cal-view="list" aria-pressed="${st.ui.view === "list"}">Programme</button>
        </div>
        ${all ? "" : `<button class="btn subtle" data-cal="ics" title="Exporter vers l'agenda du téléphone ou de l'ordinateur (.ics)">${icon("download")}<span>Exporter</span></button>
        <button class="btn" data-cal="add">${icon("plus")}<span>Ajouter</span></button>`}
      </div>
      <div class="cal-body cal-${st.ui.view}${all ? " cal-all" : ""}">${st.ui.view === "month" ? monthHTML() : st.ui.view === "week" ? weekHTML() : listHTML()}</div>`;
  }

  const pillHTML = (it, cls = "") => {
    const p = profile(it.pid), K = KINDS[it.kind] || KINDS.perso;
    const ed = mineEditable(it);
    return `<button class="cal-pill ${it.kind}${it.done ? " done" : ""} ${cls}" style="--c:${colorOf(it)}" data-item="${esc(it.id)}" data-owner="${it.pid}"${ed ? ` draggable="true"` : ""}
      title="${esc(titleOf(it) + (it.time ? " · " + it.time : "") + (st.ui.scope === "all" && p ? " · " + p.name : ""))}">
      ${st.ui.scope === "all" && p ? `<i class="cp-who" style="--pc:${p.color}"></i>` : ""}${it.kind === "exam" ? icon("target") : it.done ? icon("check") : ""}
      ${it.time ? `<em>${esc(it.time)}</em>` : ""}<span>${esc(it.kind === "exam" ? titleOf(it) : (subject(it.sid) ? (subject(it.sid).abbr || subject(it.sid).title) + " · " : "") + (K.short) + (it.chap ? " " + it.chap : ""))}</span>
    </button>`;
  };

  function monthHTML() {
    const a = parse(st.anchor);
    const first = iso(new Date(a.getFullYear(), a.getMonth(), 1));
    const start = monday(first);
    const items = allItems();
    const byDay = {};
    items.forEach(it => (byDay[it.date] || (byDay[it.date] = [])).push(it));
    const t = today();
    let h = `<div class="cm-head">${DAYS.map(d => `<span>${d.slice(0, 3)}.</span>`).join("")}</div><div class="cm-grid">`;
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i);
      if (i === 35 && parse(d).getMonth() !== a.getMonth()) break;
      const list = (byDay[d] || []).sort((x, y) => (x.kind === "exam" ? -1 : 0) - (y.kind === "exam" ? -1 : 0));
      const out = parse(d).getMonth() !== a.getMonth();
      h += `<div class="cm-cell${out ? " out" : ""}${d === t ? " today" : ""}${d < t ? " past" : ""}" data-date="${d}">
        <span class="cm-day">${parse(d).getDate()}</span>
        ${list.slice(0, 3).map(it => pillHTML(it)).join("")}
        ${list.length > 3 ? `<button class="cm-more" data-cal-day="${d}">+${list.length - 3} autre${list.length > 4 ? "s" : ""}</button>` : ""}
      </div>`;
    }
    return h + `</div>`;
  }

  const cardHTML = it => {
    const S = subject(it.sid), K = KINDS[it.kind] || KINDS.perso, p = profile(it.pid);
    const ed = mineEditable(it);
    const go = S && K.mode && it.pid === st.pid ? `#/${it.pid}/${S.id}/${K.mode}` : null;
    return `<div class="cal-card ${it.kind}${it.done ? " done" : ""}" style="--c:${colorOf(it)}" data-item="${esc(it.id)}" data-owner="${it.pid}"${ed ? ` draggable="true"` : ""}>
      ${ed ? `<label class="cc-check" title="${it.done ? "Marquer comme à faire" : "Marquer comme fait"}"><input type="checkbox" data-cal-done="${esc(it.id)}"${it.done ? " checked" : ""}><span>${icon("check")}</span></label>` : `<span class="cc-ico">${icon(K.ico)}</span>`}
      <span class="cc-txt">
        <small>${it.time ? esc(it.time) + (it.dur ? " · " + durTxt(it.dur) : "") : it.kind === "exam" ? "Toute la journée" : it.dur ? durTxt(it.dur) : ""}${st.ui.scope === "all" && p ? ` · <i class="cp-who" style="--pc:${p.color}"></i>${esc(p.name)}` : ""}</small>
        <b>${esc(titleOf(it))}</b>
        ${S && it.kind !== "exam" ? `<em>${esc(S.title)}</em>` : ""}
        ${it.note ? `<span class="cc-note">${esc(it.note)}</span>` : ""}
      </span>
      ${go && !it.done ? `<a class="chip-btn cc-go" href="${go}"${it.chap ? ` data-chap="${esc(it.chap)}"` : ""}>${icon("play")}Commencer</a>` : ""}
    </div>`;
  };

  function weekHTML() {
    const m = monday(st.anchor), items = allItems(), t = today();
    let h = `<div class="cw-grid">`;
    for (let i = 0; i < 7; i++) {
      const d = addDays(m, i), list = items.filter(it => it.date === d);
      h += `<div class="cw-col${d === t ? " today" : ""}${d < t ? " past" : ""}" data-date="${d}">
        <div class="cw-head"><span>${DAYS[i].slice(0, 3)}.</span><b>${parse(d).getDate()}</b>${list.length ? `<small>${durTxt(list.reduce((a, x) => a + (x.dur || 0), 0)) === "0 min" ? "" : durTxt(list.reduce((a, x) => a + (x.dur || 0), 0))}</small>` : ""}</div>
        ${list.map(cardHTML).join("")}
        ${st.ui.scope === "me" ? `<button class="cw-add" data-cal-add="${d}" title="Ajouter une séance">${icon("plus")}</button>` : ""}
      </div>`;
    }
    return h + `</div>`;
  }

  function listHTML() {
    const t = today(), items = allItems();
    const late = items.filter(it => !it.virtual && !it.done && it.date < t && it.date >= addDays(t, -21) && it.pid === st.pid);
    const next = items.filter(it => it.date >= t && it.date <= addDays(t, 45));
    const days = [...new Set(next.map(it => it.date))];
    if (!days.length && !late.length) return `<div class="empty">${icon("calendar", "empty-ico")}<h3>Rien de prévu pour l'instant</h3><p>Ajoute une séance ou laisse l'application organiser ton programme jusqu'à tes partiels.</p>
      <button class="btn primary" data-cal="gen" style="margin-top:16px">${icon("sparkle")}Organiser mon programme</button></div>`;
    return (late.length ? `<div class="cl-day late"><h3>${icon("reset")}En retard <button class="chip-btn" data-cal="late">Tout reporter à aujourd'hui</button></h3>${late.map(cardHTML).join("")}</div>` : "") +
      days.map(d => `<div class="cl-day${d === t ? " today" : ""}"><h3>${esc(dayLabel(d, true))}</h3>${next.filter(it => it.date === d).map(cardHTML).join("")}</div>`).join("");
  }

  /* ---------------- Actions ---------------- */
  function move(n) {
    if (st.ui.view === "month") { const a = parse(st.anchor); st.anchor = iso(new Date(a.getFullYear(), a.getMonth() + n, 1)); }
    else st.anchor = addDays(st.anchor, 7 * n);
    render();
  }
  function setItem(pid, id, patch) {
    const d = load(pid);
    const it = d.items.find(x => x.id === id);
    if (!it) return null;
    Object.assign(it, patch);
    save(pid, d);
    return it;
  }
  function toggleDone(pid, id, done) {
    const it = setItem(pid, id, { done, doneAt: done ? Date.now() : null });
    if (it && done) App.toast("Séance faite, bravo !");
  }
  function reportLate() {
    const d = load(st.pid), t = today();
    let n = 0;
    d.items.forEach(it => { if (!it.done && it.date < t && it.date >= addDays(t, -21)) { it.date = t; n++; } });
    save(st.pid, d);
    App.toast(n ? `${n} séance${n > 1 ? "s" : ""} reportée${n > 1 ? "s" : ""} à aujourd'hui` : "Rien à reporter");
    render();
  }

  function onClick(e) {
    if (!st) return;
    const sc = e.target.closest("[data-cal-scope]");
    if (sc) { st.ui.scope = sc.dataset.calScope; saveUI(); render(); return; }
    const vw = e.target.closest("[data-cal-view]");
    if (vw) { st.ui.view = vw.dataset.calView; saveUI(); render(); return; }
    const sh = e.target.closest("[data-cal-show]");
    if (sh) {
      const id = sh.dataset.calShow;
      st.ui.show = st.ui.show.includes(id) ? st.ui.show.filter(x => x !== id) : st.ui.show.concat(id);
      saveUI(); render(); return;
    }
    if (e.target.closest("[data-cal-done]") || e.target.closest(".cc-check")) return;   // géré par « change »
    if (e.target.closest(".cc-go")) return;
    const more = e.target.closest("[data-cal-day]");
    if (more) { st.anchor = more.dataset.calDay; st.ui.view = "week"; saveUI(); render(); return; }
    const add = e.target.closest("[data-cal-add]");
    if (add) { openItem(null, add.dataset.calAdd); return; }
    const it = e.target.closest("[data-item]");
    if (it) { openItem(it.dataset.item, null, it.dataset.owner); return; }
    const a = e.target.closest("[data-cal]");
    if (a) {
      const act = a.dataset.cal;
      if (act === "prev") move(-1);
      else if (act === "next") move(1);
      else if (act === "today") { st.anchor = today(); render(); }
      else if (act === "add") openItem(null, st.ui.view === "month" && st.anchor.slice(0, 7) !== today().slice(0, 7) ? st.anchor : today());
      else if (act === "gen") openGen();
      else if (act === "late") reportLate();
      else if (act === "ics") {
        const url = URL.createObjectURL(new Blob([ics(st.pid)], { type: "text/calendar" }));
        const l = document.createElement("a");
        l.href = url; l.download = `Revisions-${st.pid}.ics`;
        document.body.appendChild(l); l.click(); l.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        App.toast("Calendrier exporté : ouvre le fichier pour l'ajouter à ton agenda");
      }
      return;
    }
    const cell = e.target.closest(".cm-cell[data-date]");
    if (cell && st.ui.scope === "me") openItem(null, cell.dataset.date);
  }
  function onChange(e) {
    const c = e.target.closest("[data-cal-done]");
    if (c && st) { toggleDone(st.pid, c.dataset.calDone, c.checked); render(); }
  }

  /* Glisser-déposer une séance sur un autre jour */
  let dragId = null;
  function onDragStart(e) {
    const it = e.target.closest("[data-item][draggable]");
    if (!it) return;
    dragId = it.dataset.item;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragId);
  }
  function onDragOver(e) {
    const c = e.target.closest("[data-date]");
    if (!c || !dragId) return;
    e.preventDefault();
    c.classList.add("drop");
  }
  function onDragLeave(e) { const c = e.target.closest("[data-date]"); if (c && !c.contains(e.relatedTarget)) c.classList.remove("drop"); }
  function onDrop(e) {
    const c = e.target.closest("[data-date]");
    if (!c || !dragId) return;
    e.preventDefault();
    setItem(st.pid, dragId, { date: c.dataset.date });
    dragId = null;
    App.toast("Séance déplacée au " + dayLabel(c.dataset.date).toLowerCase());
    render();
  }

  /* ---------------- Fenêtres ---------------- */
  function dialog(html, cls) {
    closeDialog();
    const m = document.createElement("div");
    m.className = "modal";
    m.id = "cal-dlg";
    m.innerHTML = `<div class="dialog ${cls || ""}" role="dialog">${html}</div>`;
    document.body.appendChild(m);
    m.addEventListener("mousedown", e => { if (e.target === m) closeDialog(); });
    return m;
  }
  function closeDialog() { const m = document.getElementById("cal-dlg"); if (m) m.remove(); }
  document.addEventListener("keydown", e => { if (e.key === "Escape" && document.getElementById("cal-dlg")) { e.stopPropagation(); closeDialog(); } }, true);

  function openItem(id, date, owner, preset) {
    const pid = owner || st.pid;
    const all = itemsOf(pid);
    const it = id ? all.find(x => x.id === id) : null;
    if (id && !it) return;
    if (it && (it.virtual || pid !== st.pid)) { showReadOnly(it); return; }
    const o = it || Object.assign({ date: date || today(), time: "18:00", dur: 45, kind: "flash", sid: (subjectsOf(pid)[0] || {}).id || "", chap: "", title: "", note: "" }, preset || {});
    const subs = subjectsOf(pid);
    const chapOpts = sid => { const S = subject(sid); return S ? chaptersOf(S) : []; };
    const m = dialog(`
      <div class="dialog-head"><h2>${it ? "Modifier la séance" : "Nouvelle séance"}</h2></div>
      <form class="dialog-body cal-form">
        <label class="f-row"><span>Matière</span><select name="sid"><option value="">Autre (sans matière)</option>${subs.map(s => `<option value="${s.id}"${s.id === o.sid ? " selected" : ""}>${esc(s.title)}</option>`).join("")}</select></label>
        <div class="f-row"><span>Type</span><div class="seg-ctl wrap" data-kinds>${Object.keys(KINDS).filter(k => k !== "exam").map(k => `<button type="button" data-kind="${k}" aria-pressed="${k === o.kind}">${KINDS[k].short}</button>`).join("")}</div></div>
        <label class="f-row"><span>Chapitre</span><select name="chap"><option value="">Tous les chapitres</option>${chapOpts(o.sid).map(c => `<option${c === o.chap ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
        <label class="f-row"><span>Titre</span><input name="title" type="text" maxlength="80" placeholder="Automatique" value="${esc(o.title || "")}"></label>
        <div class="f-grid">
          <label class="f-row"><span>Jour</span><input name="date" type="date" value="${esc(o.date)}" required></label>
          <label class="f-row"><span>Heure</span><input name="time" type="time" value="${esc(o.time || "")}"></label>
          <label class="f-row"><span>Durée</span><select name="dur">${[15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 240].map(v => `<option value="${v}"${v === (o.dur || 45) ? " selected" : ""}>${durTxt(v)}</option>`).join("")}</select></label>
        </div>
        ${it ? "" : `<label class="f-row"><span>Répéter</span><select name="rep"><option value="0">Une seule fois</option><option value="2">Chaque semaine, 2 fois</option><option value="4">Chaque semaine, 4 fois</option><option value="8">Chaque semaine, 8 fois</option><option value="d5">Chaque jour, 5 jours</option></select></label>`}
        <label class="f-row"><span>Note</span><textarea name="note" rows="2" maxlength="300" placeholder="Ce que tu veux faire pendant cette séance…">${esc(o.note || "")}</textarea></label>
        ${it ? `<label class="f-check"><input type="checkbox" name="done"${it.done ? " checked" : ""}> Séance faite</label>` : ""}
      </form>
      <div class="dialog-foot">
        ${it ? `<button class="btn danger" data-dlg="del">${icon("trash")}Supprimer</button><button class="btn subtle" data-dlg="dup" title="Dupliquer la semaine suivante">Dupliquer</button>` : ""}
        <span class="spacer"></span>
        <button class="btn" data-dlg="cancel">Annuler</button>
        <button class="btn primary" data-dlg="ok">${it ? "Enregistrer" : "Ajouter"}</button>
      </div>`, "cal-dialog");
    const f = $("form", m);
    let kind = o.kind;
    f.sid.addEventListener("change", () => {
      f.chap.innerHTML = `<option value="">Tous les chapitres</option>` + chapOpts(f.sid.value).map(c => `<option>${esc(c)}</option>`).join("");
    });
    m.addEventListener("click", e => {
      const k = e.target.closest("[data-kind]");
      if (k) { kind = k.dataset.kind; $$("[data-kind]", m).forEach(b => b.setAttribute("aria-pressed", b === k)); return; }
      const b = e.target.closest("[data-dlg]");
      if (!b) return;
      const act = b.dataset.dlg;
      if (act === "cancel") { closeDialog(); return; }
      const d = load(pid);
      if (act === "del") {
        const copy = d.items.find(x => x.id === it.id);
        d.items = d.items.filter(x => x.id !== it.id); save(pid, d); closeDialog(); render();
        App.toast("Séance supprimée", { label: "Annuler", action: () => { const dd = load(pid); dd.items.push(copy); save(pid, dd); render(); } });
        return;
      }
      if (act === "dup") { const c = Object.assign({}, d.items.find(x => x.id === it.id), { id: newId(), date: addDays(it.date, 7), done: false, gen: false }); d.items.push(c); save(pid, d); closeDialog(); render(); App.toast("Séance copiée la semaine suivante"); return; }
      if (!f.date.value) { f.date.focus(); return; }
      const val = { date: f.date.value, time: f.time.value, dur: +f.dur.value, sid: f.sid.value || null, kind, chap: f.chap.value || null, title: f.title.value.trim(), note: f.note.value.trim() };
      if (it) {
        Object.assign(d.items.find(x => x.id === it.id), val, { done: f.done.checked });
      } else {
        const rep = f.rep.value;
        const n = rep === "d5" ? 5 : Math.max(1, +rep || 1), step = rep === "d5" ? 1 : 7;
        for (let i = 0; i < n; i++) d.items.push(Object.assign({ id: newId(), done: false, gen: false }, val, { date: addDays(val.date, i * step) }));
      }
      save(pid, d);
      closeDialog();
      render();
      App.toast(it ? "Séance modifiée" : "Séance ajoutée");
    });
    setTimeout(() => f.sid.focus(), 30);
  }

  function showReadOnly(it) {
    const S = subject(it.sid), p = profile(it.pid);
    dialog(`
      <div class="dialog-head"><h2>${esc(titleOf(it))}</h2></div>
      <div class="dialog-body ro-body">
        ${p ? `<p class="ro-who">${Social.avatar(p, "xs")}<span>Calendrier de <b>${esc(p.name)}</b></span></p>` : ""}
        <p>${icon("calendar")}<span>${esc(dayLabel(it.date, true))}${it.time ? " · " + esc(it.time) : ""}${it.dur ? " · " + durTxt(it.dur) : ""}</span></p>
        ${S ? `<p>${icon("book")}<span>${esc(S.title)}</span></p>` : ""}
        ${it.note ? `<p>${icon("note")}<span>${esc(it.note)}</span></p>` : ""}
        ${it.kind === "exam" ? `<p class="ro-hint">La date du partiel se change sur la page de la matière.</p>` : `<p>${icon(it.done ? "check" : "clock")}<span>${it.done ? "Faite" : "À faire"}</span></p>`}
      </div>
      <div class="dialog-foot">${it.kind === "exam" && S && it.pid === st.pid ? `<a class="btn" href="#/${it.pid}/${S.id}">Ouvrir la matière</a>` : ""}<span class="spacer"></span><button class="btn primary" data-dlg="cancel">Fermer</button></div>`, "cal-dialog");
    $("#cal-dlg").addEventListener("click", e => { if (e.target.closest("[data-dlg=cancel], a")) closeDialog(); });
  }

  /* ---------------- Organiser mon programme ---------------- */
  function openGen() {
    const pid = st.pid, subs = subjectsOf(pid).filter(s => s.flash.length || s.qcm.length || s.rappels.length);
    const meta = Store.get(`rev:${pid}:subjmeta`, {});
    if (!subs.length) { App.toast("Aucune matière avec du contenu pour l'instant"); return; }
    const t = today();
    const lastExam = subs.map(s => (meta[s.id] || {}).exam).filter(x => x && x > t).sort().pop();
    const prev = load(pid).opts || {};
    const o = Object.assign({ from: t, to: lastExam || addDays(t, 20), days: [1, 1, 1, 1, 1, 1, 0], perDay: 90, slot: 45, start: "18:00", spaced: true, finalQcm: true, fill: true, prio: {}, off: {} }, prev, { from: t });
    if (o.to < t) o.to = lastExam || addDays(t, 20);
    const m = dialog(`
      <div class="dialog-head"><h2>${icon("sparkle")}Organiser mon programme</h2></div>
      <form class="dialog-body gen-form">
        <p class="gen-intro">Les séances sont réparties entre tes matières selon les dates de partiel : d'abord les fiches, puis les flashcards et les QCM de chaque chapitre, avec des révisions espacées pour bien retenir.</p>
        <div class="f-grid two">
          <label class="f-row"><span>Du</span><input type="date" name="from" value="${o.from}"></label>
          <label class="f-row"><span>Au</span><input type="date" name="to" value="${o.to}"></label>
        </div>
        <div class="f-row"><span>Jours de révision</span><div class="day-chips">${DAYS.map((d, i) => `<button type="button" data-gday="${i}" aria-pressed="${!!o.days[i]}" title="${d}">${d.slice(0, 2)}</button>`).join("")}</div></div>
        <div class="f-grid">
          <label class="f-row"><span>Temps par jour</span><select name="perDay">${[30, 45, 60, 90, 120, 150, 180, 240, 300].map(v => `<option value="${v}"${v === o.perDay ? " selected" : ""}>${durTxt(v)}</option>`).join("")}</select></label>
          <label class="f-row"><span>Séance de</span><select name="slot">${[25, 30, 45, 60, 90].map(v => `<option value="${v}"${v === o.slot ? " selected" : ""}>${durTxt(v)}</option>`).join("")}</select></label>
          <label class="f-row"><span>À partir de</span><input type="time" name="start" value="${o.start}"></label>
        </div>
        <div class="f-row"><span>Matières</span>
          <div class="gen-subs">${subs.map(s => {
            const ex = (meta[s.id] || {}).exam;
            return `<div class="gen-sub" style="--sc:${s.color}">
              <label><input type="checkbox" data-gsub="${s.id}"${o.off[s.id] ? "" : " checked"}><b>${esc(s.title)}</b></label>
              <input type="date" data-gexam="${s.id}" value="${esc(ex || "")}" title="Date du partiel">
              <select data-gprio="${s.id}"><option value="1">Normale</option><option value="2"${o.prio[s.id] === 2 ? " selected" : ""}>Prioritaire</option><option value="0.6"${o.prio[s.id] === 0.6 ? " selected" : ""}>Légère</option></select>
            </div>`;
          }).join("")}</div>
          <small class="f-hint">Indique la date de chaque partiel : la matière est terminée la veille.</small>
        </div>
        <div class="pref-list gen-opts">
          <label class="pref-row"><div><b>Révisions espacées</b><small>Revoir chaque chapitre 2 et 6 jours plus tard</small></div><input type="checkbox" class="switch" name="spaced"${o.spaced ? " checked" : ""}></label>
          <label class="pref-row"><div><b>QCM complet avant le partiel</b><small>Un examen blanc sur tout le cours</small></div><input type="checkbox" class="switch" name="finalQcm"${o.finalQcm ? " checked" : ""}></label>
          <label class="pref-row"><div><b>Compléter les jours libres</b><small>Révisions et QCM d'entraînement une fois les chapitres vus</small></div><input type="checkbox" class="switch" name="fill"${o.fill ? " checked" : ""}></label>
        </div>
        <div class="gen-preview"></div>
      </form>
      <div class="dialog-foot"><span class="gen-keep">Tes séances ajoutées à la main et celles déjà faites sont gardées.</span><span class="spacer"></span><button class="btn" data-dlg="cancel">Annuler</button><button class="btn primary" data-dlg="ok">${icon("sparkle")}Créer le programme</button></div>`, "gen-dialog");
    const f = $("form", m);
    const read = () => {
      const r = { from: f.from.value, to: f.to.value, perDay: +f.perDay.value, slot: +f.slot.value, start: f.start.value || "18:00",
        days: $$("[data-gday]", m).map(b => b.getAttribute("aria-pressed") === "true" ? 1 : 0),
        spaced: f.spaced.checked, finalQcm: f.finalQcm.checked, fill: f.fill.checked, prio: {}, off: {}, exams: {} };
      $$("[data-gsub]", m).forEach(c => { if (!c.checked) r.off[c.dataset.gsub] = true; });
      $$("[data-gprio]", m).forEach(s => { r.prio[s.dataset.gprio] = +s.value; });
      $$("[data-gexam]", m).forEach(i => { r.exams[i.dataset.gexam] = i.value || null; });
      return r;
    };
    const preview = () => {
      const r = read();
      const res = build(pid, r);
      const box = $(".gen-preview", m);
      if (res.error) { box.innerHTML = `<p class="gp-err">${icon("x")}${esc(res.error)}</p>`; return; }
      const nDays = new Set(res.items.map(i => i.date)).size;
      box.innerHTML = `<p class="gp-ok">${icon("calendar")}<span><b>${res.items.length} séances</b> sur ${nDays} jour${nDays > 1 ? "s" : ""}${res.missing ? ` · <em>il manque ${res.missing} séance${res.missing > 1 ? "s" : ""} : ajoute du temps par jour ou des jours</em>` : " · tout le programme tient avant les partiels"}</span></p>`;
    };
    m.addEventListener("click", e => {
      const g = e.target.closest("[data-gday]");
      if (g) { g.setAttribute("aria-pressed", g.getAttribute("aria-pressed") !== "true"); preview(); return; }
      const b = e.target.closest("[data-dlg]");
      if (!b) return;
      if (b.dataset.dlg === "cancel") { closeDialog(); return; }
      const r = read();
      const res = build(pid, r);
      if (res.error) { App.toast(res.error); return; }
      /* dates de partiel saisies ici : enregistrées sur les matières */
      const mk = `rev:${pid}:subjmeta`, mt = Store.get(mk, {});
      Object.keys(r.exams).forEach(sid => { mt[sid] = Object.assign({}, mt[sid], { exam: r.exams[sid] }); });
      Store.set(mk, mt);
      const d = load(pid);
      d.items = d.items.filter(x => !x.gen || x.done || x.date < r.from).concat(res.items);
      d.opts = { days: r.days, perDay: r.perDay, slot: r.slot, start: r.start, spaced: r.spaced, finalQcm: r.finalQcm, fill: r.fill, prio: r.prio, off: r.off, to: r.to };
      save(pid, d);
      closeDialog();
      st.ui.view = window.MOBILE ? "list" : st.ui.view; st.anchor = r.from; saveUI();
      render();
      App.toast(`Programme créé : ${res.items.length} séances`);
    });
    m.addEventListener("input", preview);
    m.addEventListener("change", preview);
    preview();
  }

  /* Répartition des séances (plus urgent d'abord, en alternant les matières) */
  function build(pid, o) {
    if (!o.from || !o.to || o.to < o.from) return { error: "Choisis une période valide." };
    const dates = [];
    for (let d = o.from; d <= o.to && dates.length < 400; d = addDays(d, 1)) if (o.days[dow(d)]) dates.push(d);
    if (!dates.length) return { error: "Choisis au moins un jour de révision." };
    const perDaySlots = Math.max(1, Math.floor(o.perDay / o.slot));
    const startMin = toMin(o.start) ?? 18 * 60;
    const meta = Store.get(`rev:${pid}:subjmeta`, {});
    const qs = subjectsOf(pid).filter(S => !o.off[S.id] && (S.flash.length || S.qcm.length || S.rappels.length)).map(S => {
      const exam = (o.exams && o.exams[S.id] !== undefined ? o.exams[S.id] : (meta[S.id] || {}).exam) || null;
      const deadline = exam && exam > o.from ? (addDays(exam, -1) < o.to ? addDays(exam, -1) : o.to) : o.to;
      const done = (meta[S.id] || {}).status === "done";
      const tasks = [];
      chaptersOf(S).forEach(c => {
        const R = S.rappels.some(r => r.chap === c), F = S.flash.some(x => x[0] === c), Q = S.qcm.some(x => x[0] === c);
        if (R && !done) tasks.push({ kind: "fiche", chap: c });
        if (F) tasks.push({ kind: "flash", chap: c });
        if (Q) tasks.push({ kind: "qcm", chap: c });
      });
      if (o.finalQcm && S.qcm.length) tasks.push({ kind: "qcm", chap: null, title: "QCM complet (examen blanc)", final: true });
      return { S, prio: o.prio[S.id] || 1, deadline, exam, tasks, i: 0, reviews: [], used: {}, fillN: 0 };
    });
    if (!qs.length) return { error: "Choisis au moins une matière." };
    const idx = {};
    dates.forEach((d, i) => { idx[d] = i; });
    const slotsBefore = (d, dl) => dates.filter(x => x >= d && x <= dl).length * perDaySlots;
    const items = [];
    let last = null;
    dates.forEach(d => {
      for (let s = 0; s < perDaySlots; s++) {
        let best = null, score = -1, filler = false;
        qs.forEach(q => {
          if (d > q.deadline) return;
          const rev = q.reviews.some(r => r.ready <= d);
          if (q.i >= q.tasks.length && !rev) return;
          const remaining = q.tasks.length - q.i + q.reviews.length;
          let sc = remaining / Math.max(1, slotsBefore(d, q.deadline) - s) * q.prio;
          if (q.used[d]) sc *= .55;
          if (q === last) sc *= .5;
          if (sc > score) { score = sc; best = q; }
        });
        if (!best && o.fill) {
          /* tout est vu : entraînement sur la matière dont le partiel est le plus proche */
          const open = qs.filter(q => d <= q.deadline).sort((a, b) => a.deadline.localeCompare(b.deadline) || a.fillN - b.fillN);
          best = open.find(q => q !== last) || open[0];
          filler = !!best;
        }
        if (!best) continue;
        let task;
        if (filler) {
          task = best.fillN++ % 2 === 0 ? { kind: "review", chap: null, title: "Révision des cartes à revoir" } : { kind: "qcm", chap: null, title: "QCM d'entraînement" };
          if (!best.S.qcm.length) task = { kind: "review", chap: null, title: "Révision des flashcards" };
        } else {
          const ri = best.reviews.findIndex(r => r.ready <= d);
          const mainLeft = best.tasks.length - best.i;
          /* une révision espacée seulement s'il reste assez de place pour finir les chapitres */
          const slack = slotsBefore(d, best.deadline) - s - mainLeft;
          if (ri >= 0 && (mainLeft === 0 || (slack > 0 && (best.tasks[best.i].final || s % 2 === 1)))) task = best.reviews.splice(ri, 1)[0];
          else if (best.i < best.tasks.length) task = best.tasks[best.i++];
          else task = best.reviews.splice(ri, 1)[0];
        }
        if (task.kind === "flash" && o.spaced) {
          best.reviews.push({ kind: "review", chap: task.chap, ready: addDays(d, 2) }, { kind: "review", chap: task.chap, ready: addDays(d, 6) });
        }
        best.used[d] = true;
        last = best;
        items.push({ id: newId(), gen: true, done: false, date: d, time: hhmm(startMin + s * (o.slot + 10)), dur: o.slot,
          sid: best.S.id, kind: task.kind, chap: task.chap, title: task.title || "" });
      }
    });
    const missing = qs.reduce((a, q) => a + (q.tasks.length - q.i), 0);
    return { items, missing };
  }

  /* ---------------- Accueil : séances du jour ---------------- */
  function todayHTML(prof) {
    const t = today();
    const list = itemsOf(prof.id).filter(it => it.date === t);
    const late = itemsOf(prof.id).filter(it => !it.virtual && !it.done && it.date < t && it.date >= addDays(t, -7)).length;
    const done = list.filter(it => it.done).length;
    return `<div class="card-box plan-card" id="plan-today">
      <div class="card-head"><h3>${icon("calendar")}Au programme aujourd'hui</h3><a class="chip-btn" href="#/${prof.id}/calendar">Calendrier</a></div>
      ${list.length ? `<div class="pt-list">${list.map(it => {
        const S = subject(it.sid), K = KINDS[it.kind] || KINDS.perso;
        const go = S && K.mode ? `#/${prof.id}/${S.id}/${K.mode}` : null;
        return `<div class="pt-item${it.done ? " done" : ""}" style="--c:${colorOf(it)}">
          ${it.virtual ? `<span class="cc-ico">${icon("target")}</span>` : `<label class="cc-check"><input type="checkbox" data-plan-done="${esc(it.id)}" data-pid="${prof.id}"${it.done ? " checked" : ""}><span>${icon("check")}</span></label>`}
          <span class="pt-txt"><b>${esc(titleOf(it))}</b><small>${it.time ? esc(it.time) + " · " : ""}${S ? esc(S.title) : ""}</small></span>
          ${go && !it.done && !it.virtual ? `<a class="chip-btn" href="${go}"${it.chap ? ` data-chap="${esc(it.chap)}"` : ""}>${icon("play")}Go</a>` : ""}
        </div>`;
      }).join("")}</div>
      <div class="pt-foot"><span class="cs-bar"><i style="width:${Math.round(done / Math.max(1, list.filter(x => !x.virtual).length) * 100)}%"></i></span><small>${done} / ${list.filter(x => !x.virtual).length} fait${done > 1 ? "es" : "e"}${late ? ` · ${late} en retard` : ""}</small></div>`
      : `<p class="feed-empty">${late ? `${late} séance${late > 1 ? "s" : ""} en retard. ` : "Rien de prévu aujourd'hui. "}<a href="#/${prof.id}/calendar">${load(prof.id).items.length ? "Voir mon calendrier" : "Organiser mon programme de révision"}</a></p>`}
    </div>`;
  }
  document.addEventListener("change", e => {
    const c = e.target.closest("[data-plan-done]");
    if (!c) return;
    toggleDone(c.dataset.pid, c.dataset.planDone, c.checked);
    const card = document.getElementById("plan-today"), p = profile(c.dataset.pid);
    if (card && p) card.outerHTML = todayHTML(p);
  });

  /* Une séance prévue aujourd'hui se coche toute seule quand on fait le QCM / les flashcards correspondants */
  function autoDone(pid, ev) {
    if (!ev || !["qcm", "flash"].includes(ev.type)) return;
    const d = load(pid), t = today();
    const it = d.items.find(x => !x.done && x.sid === ev.sid && x.date <= t && x.date >= addDays(t, -2) &&
      (ev.type === "qcm" ? x.kind === "qcm" : ["flash", "review"].includes(x.kind)) &&
      (!x.chap || ev.chap === "all" || x.chap === ev.chap));
    if (!it) return;
    it.done = true; it.doneAt = Date.now();
    save(pid, d);
    setTimeout(() => App.toast("Séance cochée dans ton calendrier"), 1600);
  }
  if (window.Track && Track.onEvent) Track.onEvent(autoDone);

  /* ---------------- Rappels : « c'est l'heure de ta séance » + compteur de la barre latérale ---------------- */
  let reminded = {};
  function tick() {
    const pid = window.App && App.current && App.current();
    const el = document.getElementById("sb-plan");
    if (!pid) return;
    const t = today(), now = new Date(), mins = now.getHours() * 60 + now.getMinutes();
    const todays = load(pid).items.filter(it => it.date === t && !it.done);
    if (el) { el.textContent = todays.length || ""; el.title = todays.length ? `${todays.length} séance${todays.length > 1 ? "s" : ""} à faire aujourd'hui` : ""; }
    if (!App.prefs().planNotif) return;
    todays.forEach(it => {
      const m = toMin(it.time);
      if (m == null || reminded[it.id] || mins < m - 1 || mins > m + 10) return;
      reminded[it.id] = true;
      const S = subject(it.sid), K = KINDS[it.kind] || KINDS.perso;
      App.notice({ ico: "calendar", title: `C'est l'heure : ${titleOf(it)}`, text: `${it.time} · ${S ? S.title + " · " : ""}${durTxt(it.dur || 45)}`,
        system: true, onClick: () => { if (S && K.mode) { App.studyChapterAt(pid, S.id, K.mode, it.chap); } else location.hash = `#/${pid}/calendar`; } });
    });
  }
  setInterval(tick, 30000);

  /* Données reçues d'un autre appareil */
  function remote(pid, keys) {
    if (st && keys && keys.some(k => k.endsWith(":plan") || k.endsWith(":subjmeta")) && !document.getElementById("cal-dlg")) render();
  }

  /* Export vers le calendrier du téléphone / de l'ordinateur (.ics) */
  function ics(pid) {
    const p = profile(pid);
    const pad = s => s.replace(/[,;\\]/g, m => "\\" + m).replace(/\n/g, "\\n");
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Revisions//FR", "CALSCALE:GREGORIAN", `X-WR-CALNAME:Révisions · ${p ? p.name : ""}`];
    itemsOf(pid).forEach(it => {
      const S = subject(it.sid);
      const day = it.date.replace(/-/g, "");
      lines.push("BEGIN:VEVENT", `UID:${it.id}-${pid}@revisions`, `DTSTAMP:${stamp}`);
      if (it.time) {
        const a = toMin(it.time), b = a + (it.dur || 45);
        const tt = m => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}${String(m % 60).padStart(2, "0")}00`;
        lines.push(`DTSTART:${day}T${tt(a)}`, `DTEND:${day}T${tt(b)}`);
      } else lines.push(`DTSTART;VALUE=DATE:${day}`);
      lines.push(`SUMMARY:${pad(titleOf(it) + (S && it.kind !== "exam" ? " – " + S.title : ""))}`);
      if (it.note) lines.push(`DESCRIPTION:${pad(it.note)}`);
      lines.push("END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
  }

  /* Nouvelle séance demandée depuis une autre page (matière, fin de paquet de flashcards…) */
  let pendingNew = null;
  function planNew(pid, o) { pendingNew = o; location.hash = `#/${pid}/calendar`; }
  function addQuick(pid, o) {
    const d = load(pid);
    d.items.push(Object.assign({ id: newId(), done: false, gen: false, time: "18:00", dur: 30, kind: "review", chap: null, title: "", note: "" }, o));
    save(pid, d);
  }
  const _mount = mount;
  mount = function (el, ctx) { _mount(el, ctx); if (pendingNew) { const o = pendingNew; pendingNew = null; setTimeout(() => openItem(null, o.date || today(), null, o), 50); } tick(); };

  return { mount: (el, ctx) => mount(el, ctx), unmount, onKey: () => false, refresh: render, remote, todayHTML, itemsOf, ics, KINDS, tick, planNew, addQuick, addDays, today };
})();
