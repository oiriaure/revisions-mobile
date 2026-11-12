/* ------------------------------------------------------------------
   Historique complet des QCM (tous les profils) : filtres, moyenne,
   courbe des notes, liste par jour.
------------------------------------------------------------------- */
window.QcmHistory = (function () {
  "use strict";
  const { $, $$, esc, Store, icon } = U;
  let st = null;
  const profile = id => PROFILES.find(p => p.id === id);
  const subject = id => SUBJECTS.find(s => s.id === id);
  const nf = x => (Math.round(x * 10) / 10).toString().replace(".", ",");
  const cls = n => n >= 15 ? "ok" : n >= 10 ? "part" : "ko";

  function mount(el, ctx) {
    const ui = Object.assign({ who: PROFILES.map(p => p.id), sid: "all", period: "all", sort: "date" }, Store.get(`rev:${ctx.profile.id}:histui`, {}));
    st = { el, ctx, ui, limit: 40 };
    el.addEventListener("click", onClick);
    el.addEventListener("change", onChange);
    render();
  }
  function unmount() { if (!st) return; st.el.removeEventListener("click", onClick); st.el.removeEventListener("change", onChange); st = null; }
  const saveUI = () => Store.set(`rev:${st.ctx.profile.id}:histui`, st.ui);

  function all() {
    return [].concat(...PROFILES.map(p => Track.events(p.id).filter(e => e.type === "qcm" && e.n20 != null).map(e => Object.assign({ pid: p.id }, e))))
      .sort((a, b) => b.t - a.t);
  }
  function filtered() {
    const lim = st.ui.period === "7" ? Date.now() - 7 * 864e5 : st.ui.period === "30" ? Date.now() - 30 * 864e5 : 0;
    let l = all().filter(e => st.ui.who.includes(e.pid) && (st.ui.sid === "all" || e.sid === st.ui.sid) && e.t >= lim);
    if (st.ui.sort === "best") l = l.slice().sort((a, b) => b.n20 - a.n20 || b.t - a.t);
    if (st.ui.sort === "worst") l = l.slice().sort((a, b) => a.n20 - b.n20 || b.t - a.t);
    return l;
  }

  function chart(list) {
    const pts = list.slice(0, 30).reverse();
    if (pts.length < 2) return "";
    const W = 640, H = 150, P = 18;
    const x = i => P + i * (W - 2 * P) / (pts.length - 1), y = n => H - P - n / 20 * (H - 2 * P);
    const byWho = {};
    pts.forEach((e, i) => (byWho[e.pid] || (byWho[e.pid] = [])).push([x(i), y(e.n20)]));
    return `<div class="card-box hist-chart">
      <div class="card-head"><h3>${icon("chart")}Évolution des notes</h3><small class="muted">${pts.length} derniers QCM</small></div>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Évolution des notes">
        ${[0, 10, 15, 20].map(g => `<line x1="${P}" x2="${W - P}" y1="${y(g)}" y2="${y(g)}" class="hc-grid${g === 10 ? " mid" : ""}"/><text x="2" y="${y(g) + 4}" class="hc-lbl">${g}</text>`).join("")}
        ${Object.keys(byWho).map(pid => {
          const c = (profile(pid) || {}).color || "var(--accent)";
          const ps = byWho[pid];
          return `<polyline points="${ps.map(p => p.join(",")).join(" ")}" fill="none" stroke="${c}" stroke-width="2.2" stroke-linejoin="round" vector-effect="non-scaling-stroke" opacity=".85"/>` +
            ps.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="3.6" fill="${c}"/>`).join("");
        }).join("")}
      </svg></div>`;
  }

  function render() {
    const list = filtered();
    const avg = list.length ? list.reduce((a, e) => a + e.n20, 0) / list.length : null;
    const best = list.length ? Math.max(...list.map(e => e.n20)) : null;
    const byDate = list.slice().sort((a, b) => b.t - a.t);
    const recent = byDate.slice(0, 5), before = byDate.slice(5, 10);
    const trend = recent.length && before.length ? recent.reduce((a, e) => a + e.n20, 0) / recent.length - before.reduce((a, e) => a + e.n20, 0) / before.length : null;
    const subs = SUBJECTS.filter(s => st.ui.who.includes(s.profile));
    const shown = list.slice(0, st.limit);
    let lastDay = "";
    st.el.innerHTML = `
      <div class="mode hist-mode">
        <div class="toolbar">
          <h2 class="toolbar-title">${icon("award")}Historique des QCM</h2>
          <div class="toolbar-right">
            <label class="field"><span>Matière</span><select data-h="sid"><option value="all">Toutes</option>${subs.map(s => `<option value="${s.id}"${s.id === st.ui.sid ? " selected" : ""}>${esc(s.title)}</option>`).join("")}</select></label>
            <label class="field"><span>Trier</span><select data-h="sort"><option value="date">Plus récents</option><option value="best"${st.ui.sort === "best" ? " selected" : ""}>Meilleures notes</option><option value="worst"${st.ui.sort === "worst" ? " selected" : ""}>Notes les plus basses</option></select></label>
          </div>
        </div>
        <div class="hist-filters">
          <div class="cal-people">${PROFILES.map(p => `<button class="filter-chip person" data-h-who="${p.id}" aria-pressed="${st.ui.who.includes(p.id)}">${Social.avatar(p, "xxs")}${esc(p.name)}</button>`).join("")}</div>
          <div class="seg-ctl">${[["7", "7 jours"], ["30", "30 jours"], ["all", "Tout"]].map(([v, l]) => `<button data-h-period="${v}" aria-pressed="${st.ui.period === v}">${l}</button>`).join("")}</div>
        </div>
        <div class="kpis hist-kpis">
          <div class="kpi"><small>QCM terminés</small><b>${list.length}</b></div>
          <div class="kpi"><small>Moyenne</small><b>${avg == null ? "—" : nf(avg)}<span>/20</span></b></div>
          <div class="kpi"><small>Meilleure note</small><b>${best == null ? "—" : nf(best)}<span>/20</span></b></div>
          <div class="kpi"><small>Tendance (5 derniers)</small><b class="${trend == null ? "" : trend >= 0 ? "up" : "down"}">${trend == null ? "—" : (trend >= 0 ? "+" : "−") + nf(Math.abs(trend))}</b></div>
        </div>
        ${chart(byDate)}
        ${list.length ? `<div class="list hist-list">${shown.map(e => {
          const p = profile(e.pid), S = subject(e.sid);
          const day = new Date(e.t).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
          const head = st.ui.sort === "date" && day !== lastDay ? `<div class="hist-day">${esc(day)}</div>` : "";
          lastDay = day;
          const mine = e.pid === st.ctx.profile.id && S;
          return `${head}<div class="hist-row">
            ${p ? Social.avatar(p, "xs") : ""}
            <span class="hr-txt"><b>${esc(e.title || (S ? S.title : "QCM"))}</b><small>${p ? esc(p.name) + " · " : ""}${e.chap && e.chap !== "all" ? esc(e.chap) + " · " : "Tous les chapitres · "}${e.n} questions${e.dur ? " en " + Track.fmt(e.dur) : ""} · ${new Date(e.t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</small></span>
            ${mine ? `<a class="chip-btn" href="#/${e.pid}/${e.sid}/qcm"${e.chap && e.chap !== "all" ? ` data-chap="${esc(e.chap)}"` : ""} title="Refaire ce QCM">${icon("reset")}Refaire</a>` : ""}
            <span class="hr-pct">${e.pct != null ? e.pct + " %" : ""}</span>
            <span class="grade-chip ${cls(e.n20)}">${nf(e.n20)}<small>/20</small></span>
          </div>`;
        }).join("")}</div>
        ${list.length > st.limit ? `<div class="hist-more"><button class="btn" data-h="more">Afficher ${Math.min(40, list.length - st.limit)} de plus</button><small>${st.limit} sur ${list.length}</small></div>` : ""}`
        : `<div class="empty">${icon("award", "empty-ico")}<h3>Aucun QCM ici</h3><p>Change les filtres, ou termine un QCM pour le voir apparaître.</p></div>`}
      </div>`;
  }

  function onClick(e) {
    const w = e.target.closest("[data-h-who]");
    if (w) {
      const id = w.dataset.hWho;
      st.ui.who = st.ui.who.includes(id) ? st.ui.who.filter(x => x !== id) : st.ui.who.concat(id);
      if (!st.ui.who.length) st.ui.who = [id];
      saveUI(); render(); return;
    }
    const p = e.target.closest("[data-h-period]");
    if (p) { st.ui.period = p.dataset.hPeriod; saveUI(); render(); return; }
    if (e.target.closest("[data-h=more]")) { st.limit += 40; const y = document.getElementById("scroller").scrollTop; render(); document.getElementById("scroller").scrollTop = y; }
  }
  function onChange(e) {
    const s = e.target.closest("select[data-h]");
    if (!s) return;
    st.ui[s.dataset.h] = s.value; saveUI(); render();
  }
  function remote() { if (st) render(); }

  return { mount, unmount, onKey: () => false, refresh: render, remote };
})();
