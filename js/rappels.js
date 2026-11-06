/* ------------------------------------------------------------------
   Fiches de cours (rappels) : une fiche par chapitre, avec des
   raccourcis vers les flashcards et le QCM du même chapitre.
------------------------------------------------------------------- */
window.Rappels = (function () {
  "use strict";
  const { $, esc, rich, chaptersOf, icon } = U;
  let st = null;

  function mount(el, ctx) {
    const S = ctx.subject;
    st = { el, S, chapter: "all" };
    const chapters = chaptersOf(S).filter(c => S.rappels.some(r => r.chap === c));
    el.innerHTML = `
      <div class="mode">
        <div class="toolbar">
          <h2 class="toolbar-title">${icon("book")}Fiches de cours</h2>
          <div class="toolbar-right">
            ${chapters.length ? `
            <label class="field"><span>Chapitre</span>
              <select class="chap-select">
                <option value="all">Toutes les fiches</option>
                ${chapters.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}
              </select>
            </label>
            <button class="btn" data-act="toggle-all">${icon("stack")}<span>Tout déplier</span></button>` : ""}
          </div>
        </div>
        <p class="mode-intro">Lis la fiche d'un chapitre, puis entraîne-toi juste après avec ses flashcards et son QCM.</p>
        <section class="rp-pane"></section>
      </div>`;
    el.addEventListener("click", onClick);
    const sel = $(".chap-select", el);
    if (sel) sel.addEventListener("change", e => { st.chapter = e.target.value; render(); });
    render();
  }

  function unmount() {
    if (!st) return;
    st.el.removeEventListener("click", onClick);
    st = null;
  }

  function render() {
    const pane = $(".rp-pane", st.el);
    const S = st.S;
    const list = S.rappels.filter(r => st.chapter === "all" || r.chap === st.chapter);
    if (!list.length) {
      pane.innerHTML = `<div class="empty">${icon("book", "empty-ico")}<h3>Pas encore de fiches de cours</h3><p>Les fiches de chaque chapitre apparaîtront ici dès que le cours sera ajouté.</p></div>`;
      return;
    }
    pane.innerHTML = list.map((r, k) => {
      const nf = S.flash.filter(c => c[0] === r.chap).length;
      const nq = S.qcm.filter(c => c[0] === r.chap).length;
      return `
      <details class="rp" ${k === 0 || st.chapter !== "all" ? "open" : ""}>
        <summary>
          <span class="chip-cat">${esc(r.chap)}</span>
          <span class="rp-title">${esc(r.titre)}</span>
          ${icon("right", "rp-chev")}
        </summary>
        <div class="rp-body selectable">
          ${r.resume ? `<p class="rp-resume">${rich(r.resume)}</p>` : ""}
          ${r.points && r.points.length ? `<h4>Points clés</h4><ul class="rp-points">${r.points.map(p => `<li>${rich(p)}</li>`).join("")}</ul>` : ""}
          ${r.definitions && r.definitions.length ? `<h4>Définitions</h4><dl class="rp-defs">${r.definitions.map(d => `<div><dt>${rich(d[0])}</dt><dd>${rich(d[1])}</dd></div>`).join("")}</dl>` : ""}
          ${r.retenir ? `<div class="rp-key"><b>${icon("bulb")}À retenir</b>${rich(r.retenir)}</div>` : ""}
          ${nf || nq ? `<div class="rp-next">
            <span>Et maintenant ?</span>
            ${nf ? `<button class="btn primary" data-act="go" data-mode="flash" data-chap="${esc(r.chap)}">${icon("cards")}S'entraîner : ${nf} flashcard${nf > 1 ? "s" : ""}</button>` : ""}
            ${nq ? `<button class="btn" data-act="go" data-mode="qcm" data-chap="${esc(r.chap)}">${icon("checklist")}QCM du chapitre (${nq})</button>` : ""}
            ${window.Assistant && Assistant.available() ? `<button class="btn subtle" data-act="quiz" data-chap="${esc(r.chap)}" data-titre="${esc(r.titre)}">${icon("sparkle")}Interroge-moi</button>` : ""}
          </div>` : ""}
        </div>
      </details>`;
    }).join("");
    syncToggle();
  }

  function syncToggle() {
    const b = $("[data-act=toggle-all] span", st.el);
    if (!b) return;
    const all = st.el.querySelectorAll("details.rp");
    const open = Array.from(all).every(d => d.open);
    b.textContent = open ? "Tout replier" : "Tout déplier";
  }

  function onClick(e) {
    if (!st) return;
    if (e.target.closest("summary")) { setTimeout(syncToggle, 0); return; }
    const t = e.target.closest("[data-act]");
    if (!t) return;
    if (t.dataset.act === "go") App.studyChapter(t.dataset.mode, t.dataset.chap);
    else if (t.dataset.act === "quiz") App.askAssistant(`Interroge-moi à l'oral sur le chapitre « ${t.dataset.chap} — ${t.dataset.titre} ». Pose-moi une seule question à la fois, attends ma réponse, corrige-moi, puis passe à la suivante.`, null, { title: "Interrogation · " + t.dataset.chap, back: location.hash });
    else if (t.dataset.act === "toggle-all") {
      const all = st.el.querySelectorAll("details.rp");
      const open = !Array.from(all).every(d => d.open);
      all.forEach(d => { d.open = open; });
      syncToggle();
    }
  }

  return { mount, unmount, onKey: () => false, refresh() {} };
})();
