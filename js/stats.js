/* ------------------------------------------------------------------
   Statistiques : temps passé (par cours, total, par jour), QCM,
   et graphiques SVG aux couleurs de l'application.
------------------------------------------------------------------- */
window.Stats = (function () {
  "use strict";
  const { esc, Store, icon } = U;
  const fmt = (s, short) => Track.fmt(s, short);
  const DAYS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
  const label = d => DAYS[d.getDay()] + " " + d.getDate();

  /* Graduation lisible (minutes) */
  function niceMax(sec) {
    const m = Math.max(12, Math.ceil(sec / 60));
    const steps = [12, 20, 40, 60, 120, 180, 240, 360, 480, 600, 720, 960];
    return (steps.find(s => s >= m) || Math.ceil(m / 240) * 240) * 60;
  }
  const axisLabel = sec => sec === 0 ? "0" : sec >= 3600 && sec % 1800 === 0 ? (sec / 3600).toString().replace(".", ",") + " h" : Math.round(sec / 60) + " min";

  /* Barres groupées (une couleur par série) ou empilées. series : [{ name, color, values:[sec] }] */
  function barChart(days, series, opt = {}) {
    const W = 720, H = opt.h || 230, L = 52, R = 10, T = 14, B = 34;
    const n = days.length, iw = W - L - R, ih = H - T - B;
    const stacked = !!opt.stacked;
    const maxV = niceMax(Math.max(1, ...days.map((_, i) => stacked
      ? series.reduce((a, s) => a + (s.values[i] || 0), 0)
      : Math.max(...series.map(s => s.values[i] || 0)))));
    const y = v => T + ih - v / maxV * ih;
    const slot = iw / n, gw = Math.min(slot * .7, stacked ? 34 : 18 * series.length + 6);
    let g = "";
    for (let k = 0; k <= 4; k++) {
      const v = maxV * k / 4, yy = y(v);
      g += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" class="ch-grid"/>
            <text x="${L - 8}" y="${yy + 4}" class="ch-y">${axisLabel(v)}</text>`;
    }
    days.forEach((d, i) => {
      const cx = L + slot * i + slot / 2;
      g += `<text x="${cx}" y="${H - 12}" class="ch-x${d.today ? " today" : ""}">${esc(d.label)}</text>`;
      if (stacked) {
        let acc = 0;
        series.forEach(s => {
          const v = s.values[i] || 0; if (!v) return;
          const y1 = y(acc + v), y0 = y(acc);
          g += `<rect x="${cx - gw / 2}" y="${y1}" width="${gw}" height="${Math.max(1, y0 - y1)}" rx="3" fill="${s.color}" class="ch-bar"><title>${esc(s.name)} · ${esc(d.label)} : ${fmt(v)}</title></rect>`;
          acc += v;
        });
      } else {
        const bw = (gw - 4 * (series.length - 1)) / series.length;
        series.forEach((s, j) => {
          const v = s.values[i] || 0;
          const x = cx - gw / 2 + j * (bw + 4);
          const yy = y(v);
          g += `<rect x="${x}" y="${v ? yy : T + ih - 2}" width="${bw}" height="${v ? T + ih - yy : 2}" rx="${Math.min(5, bw / 2)}" fill="${s.color}" class="ch-bar${v ? "" : " zero"}"><title>${esc(s.name)} · ${esc(d.label)} : ${fmt(v)}</title></rect>`;
        });
      }
    });
    const legend = series.length > 1 || opt.legend ? `<div class="ch-legend">${series.map(s =>
      `<span><i style="background:${s.color}"></i>${esc(s.name)}<b>${fmt(s.values.reduce((a, b) => a + b, 0), true)}</b></span>`).join("")}</div>` : "";
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.aria || "Temps de révision")}">${g}</svg>${legend}</div>`;
  }

  function daysAxis(n) {
    const out = [];
    for (let i = n - 1; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); out.push({ date: d, label: i === 0 ? "auj." : label(d), today: i === 0 }); }
    return out;
  }

  /* Accueil : temps de révision de chaque profil, 7 derniers jours */
  function profilesChart() {
    const days = daysAxis(7);
    const series = PROFILES.map(p => ({ name: p.name, color: p.color, values: Track.lastDays(p.id, 7).map(x => x.sec) }));
    return barChart(days, series, { aria: "Temps de révision de chaque profil sur 7 jours", h: 210, legend: true });
  }

  const subjName = (pid, b) => b === "_prof" ? "Prof Susuzouzou" : b === "_notes" ? "Notes" :
    ((SUBJECTS.find(s => s.profile === pid && s.id === b) || {}).title || "Autre");
  const subjColor = (pid, b, k) => b === "_prof" ? "#9a7bd6" : b === "_notes" ? "#8a9aa8" :
    ((SUBJECTS.find(s => s.profile === pid && s.id === b) || {}).color || ["#4453c9", "#17807b", "#d16a1e"][k % 3]);

  /* Page Statistiques d'un profil */
  function render(el, profile) {
    const pid = profile.id;
    const T = Track.totals(pid);
    const streak = Track.streak(pid);
    const subs = SUBJECTS.filter(s => s.profile === pid);
    const n = 14;
    const last = Track.lastDays(pid, n);
    const buckets = Array.from(new Set([...subs.map(s => s.id), "_prof", "_notes"]))
      .filter(b => last.some(d => d.detail[b]));
    const series = buckets.map((b, k) => ({ name: subjName(pid, b), color: subjColor(pid, b, k), values: last.map(d => d.detail[b] || 0) }));
    const goal = (App.prefs().goal || 30) * 60;
    const pct = Math.min(100, Math.round(T.today / goal * 100));
    const qrows = subs.map(s => {
      const h = Store.get(`rev:${pid}:${s.id}:qcmhist`, []);
      const avg = h.length ? h.reduce((a, x) => a + x.n20, 0) / h.length : null;
      const best = h.length ? Math.max(...h.map(x => x.n20)) : null;
      return { s, h, avg, best, time: T.bySubject[s.id] || 0, today: T.todayBy[s.id] || 0 };
    });
    const nf = x => x == null ? "—" : (Math.round(x * 10) / 10).toString().replace(".", ",");
    const recent = [].concat(...subs.map(s => Store.get(`rev:${pid}:${s.id}:qcmhist`, []).map(x => Object.assign({ s }, x)))).sort((a, b) => b.t - a.t).slice(0, 8);
    el.innerHTML = `
      <section class="page">
        <div class="page-head"><div><h1>Statistiques</h1><p class="page-sub">Ton temps de révision et tes résultats${window.Sync && Sync.enabled() ? ", sur tous tes appareils" : ""}.</p></div>
          <a class="btn" href="#/${pid}/history">${icon("award")}Historique des QCM</a></div>
        <div class="kpis">
          <div class="kpi"><span class="kpi-ico">${icon("clock")}</span><small>Aujourd'hui</small><b>${fmt(T.today)}</b>
            <div class="kpi-bar"><i style="width:${pct}%"></i></div><em>${pct >= 100 ? "Objectif atteint !" : `Objectif : ${fmt(goal)}`}</em></div>
          <div class="kpi"><span class="kpi-ico">${icon("calendar")}</span><small>7 derniers jours</small><b>${fmt(T.week)}</b><em>${fmt(T.week / 7)} par jour en moyenne</em></div>
          <div class="kpi"><span class="kpi-ico">${icon("stack")}</span><small>Tous les cours</small><b>${fmt(T.total)}</b><em>depuis le début</em></div>
          <div class="kpi"><span class="kpi-ico flame">${icon("flame")}</span><small>Série</small><b>${streak} jour${streak > 1 ? "s" : ""}</b><em>au moins 10 min par jour</em></div>
        </div>

        <h2 class="section-title">Temps de révision · ${n} derniers jours</h2>
        <div class="card-box">${series.length ? barChart(daysAxis(n), series, { stacked: true, legend: true }) :
          `<div class="empty slim">${icon("chart", "empty-ico")}<h3>Pas encore de temps enregistré</h3><p>Le temps compte automatiquement quand tu révises une matière, que tu parles à Prof Susuzouzou ou que tu prends des notes.</p></div>`}</div>

        <h2 class="section-title">Par matière</h2>
        <div class="list stats-list">
          <div class="list-row stats-row head"><span>Matière</span><span>Temps total</span><span>Aujourd'hui</span><span>QCM faits</span><span>Moyenne</span><span>Meilleure note</span></div>
          ${qrows.map(r => `
          <a class="list-row stats-row" href="#/${pid}/${r.s.id}">
            <span class="st-name">${r.s.iconImg ? `<img class="sb-icon" src="${esc(r.s.iconImg)}" alt="">` : ""}${esc(r.s.title)}</span>
            <span>${fmt(r.time)}</span><span>${fmt(r.today)}</span><span>${r.h.length}</span>
            <span>${r.avg == null ? "—" : nf(r.avg) + " / 20"}</span><span>${r.best == null ? "—" : nf(r.best) + " / 20"}</span>
          </a>`).join("")}
          ${T.bySubject._prof ? `<div class="list-row stats-row"><span class="st-name">${icon("sparkle")}Prof Susuzouzou</span><span>${fmt(T.bySubject._prof)}</span><span>${fmt(T.todayBy._prof || 0)}</span><span>—</span><span>—</span><span>—</span></div>` : ""}
          ${T.bySubject._notes ? `<div class="list-row stats-row"><span class="st-name">${icon("note")}Notes</span><span>${fmt(T.bySubject._notes)}</span><span>${fmt(T.todayBy._notes || 0)}</span><span>—</span><span>—</span><span>—</span></div>` : ""}
        </div>

        <h2 class="section-title">Derniers QCM <a class="chip-btn" href="#/${pid}/history">Tout afficher</a></h2>
        ${recent.length ? `<div class="list">${recent.map(x => `
          <div class="list-row recent-row">
            <span class="grade-chip ${x.n20 >= 15 ? "ok" : x.n20 >= 10 ? "part" : "ko"}">${nf(x.n20)}<small>/20</small></span>
            <span><b>${esc(x.s.title)}</b><small>${esc(x.chap === "all" || !x.chap ? "Tous les chapitres" : x.chap)} · ${x.n} questions</small></span>
            <span class="muted">${new Date(x.t).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })} · ${new Date(x.t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
          </div>`).join("")}</div>` : `<div class="empty slim">${icon("checklist", "empty-ico")}<h3>Aucun QCM terminé</h3><p>Tes notes apparaîtront ici après chaque évaluation.</p></div>`}
      </section>`;
  }

  return { render, profilesChart, barChart };
})();
