/* ------------------------------------------------------------------
   Mode Flashcards
   Fonctionnement repris du modèle : carte à retourner, « Je sais » /
   « Je ne sais pas » (sortie haut / bas), cartes ratées mémorisées,
   mélange, révision des ratées. Simplifié : d'abord « Voir la réponse »,
   puis l'auto-évaluation ; bilan à la fin du paquet.
------------------------------------------------------------------- */
window.Flashcards = (function () {
  "use strict";
  const { $, esc, rich, Store, shuffle, chaptersOf, replay, screenFlash, icon } = U;
  let st = null;

  function mount(el, ctx) {
    const S = ctx.subject;
    st = {
      el, S, ctx, chapter: "all", pack: "all", deck: [], i: 0, flipped: false, busy: false,
      known: 0, unknown: 0, timers: [],
      key: `rev:${ctx.profile.id}:${S.id}:missed`,
      runKey: `rev:${ctx.profile.id}:${S.id}:fcrun`
    };
    st.missed = Store.get(st.key, []);
    const chapters = chaptersOf(S).filter(c => S.flash.some(x => x[0] === c));

    el.innerHTML = `
      <div class="mode">
        <div class="toolbar">
          <h2 class="toolbar-title">${icon("cards")}Flashcards</h2>
          <div class="toolbar-right">
            ${chapters.length ? `
            <label class="field"><span>Chapitre</span>
              <select class="chap-select">
                <option value="all">Tous les chapitres</option>
                ${chapters.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}
              </select>
            </label>
            <div class="seg pack-seg" role="tablist">
              <button data-act="pack" data-pack="all">Toutes <b class="n-all"></b></button>
              <button data-act="pack" data-pack="missed">À revoir <b class="n-missed"></b></button>
            </div>
            <button class="btn icon-only" data-act="shuffle" title="Mélanger le paquet">${icon("shuffle")}</button>` : ""}
          </div>
        </div>

        <div class="fc-empty" hidden></div>
        <div class="fc-done" hidden></div>
        <div class="fc-body">
          <div class="run-head">
            <div class="fc-nav">
              <button class="icon-btn nav" data-act="prev" title="Carte précédente (←)">${icon("left")}</button>
              <span class="run-count fc-count"></span>
              <button class="icon-btn nav" data-act="next" title="Carte suivante (→)">${icon("right")}</button>
            </div>
            <div class="counters">
              <span class="counter ok" title="Cartes sues dans ce paquet">${icon("check")}<b class="fc-known">0</b></span>
              <span class="counter ko" title="Cartes ratées dans ce paquet">${icon("x")}<b class="fc-unknown">0</b></span>
            </div>
          </div>
          <div class="progress"><div class="progress-fill fc-prog"></div></div>

          <div class="fc-stage">
            <div class="fc-scene" data-act="flip">
              <div class="fc-card">
                <div class="face front">
                  <div class="chip-cat fc-cat"></div>
                  <div class="fc-q"></div>
                </div>
                <div class="face back">
                  <div class="fc-lbl">Réponse</div>
                  <div class="fc-a"></div>
                  <div class="fc-rappel" hidden></div>
                </div>
              </div>
              <div class="tint ok"><span>${icon("check")}</span></div>
              <div class="tint ko"><span>${icon("x")}</span></div>
            </div>
          </div>

          <div class="fc-controls">
            <div class="fc-ask">
              <button class="btn primary lg nav" data-act="flip">${icon("flip")}Voir la réponse <kbd>Espace</kbd></button>
              <p class="fc-help">Cherche d'abord la réponse dans ta tête, puis retourne la carte.</p>
            </div>
            <div class="fc-rate" hidden>
              <p class="fc-help">Avais-tu trouvé la bonne réponse ?</p>
              <div class="fc-rate-btns">
                <button class="btn ko lg nav" data-act="ko">${icon("x")}Je ne savais pas <kbd>↓</kbd></button>
                <button class="btn ok lg nav" data-act="ok">${icon("check")}Je savais <kbd>↑</kbd></button>
              </div>
              ${window.Assistant && Assistant.available() ? `<button class="btn subtle small" data-act="ask">${icon("sparkle")}Pas clair ? Demander à Prof Susuzouzou</button>` : ""}
            </div>
          </div>
          <div class="fc-foot">
            <button class="btn subtle small" data-act="reset">${icon("reset")}Vider la liste « À revoir »</button>
          </div>
        </div>
      </div>`;

    el.addEventListener("click", onClick);
    const sel = $(".chap-select", el);
    if (sel) sel.addEventListener("change", e => { st.chapter = e.target.value; rebuild(); });
    if (!resume()) rebuild();
  }

  /* Reprise : on retrouve le paquet, la carte et les compteurs là où on les avait laissés */
  function save() {
    if (!st) return;
    Store.set(st.runKey, { chapter: st.chapter, pack: st.pack, ids: st.deck.map(c => c[1]), i: st.i,
      known: st.known, unknown: st.unknown, flipped: st.flipped, done: !q(".fc-done").hidden, t: Date.now() });
  }
  function resume() {
    const r = Store.get(st.runKey, null);
    if (!r || !Array.isArray(r.ids)) return false;
    const byId = new Map(st.S.flash.map(c => [c[1], c]));
    const deck = r.ids.map(id => byId.get(id)).filter(Boolean);
    if (!deck.length) return false;
    const sel = q(".chap-select");
    if (r.chapter !== "all" && sel && !Array.from(sel.options).some(o => o.value === r.chapter)) return false;
    st.chapter = r.chapter || "all"; st.pack = r.pack || "all";
    if (sel) sel.value = st.chapter;
    st.deck = deck; st.i = Math.min(r.i || 0, deck.length - 1);
    st.known = r.known || 0; st.unknown = r.unknown || 0;
    q(".fc-done").hidden = true;
    updatePack();
    if (r.done) { done(); return true; }
    show(0);
    if (r.flipped) setFlipped(true);
    return true;
  }

  function unmount() {
    if (!st) return;
    st.timers.forEach(clearTimeout);
    st.el.removeEventListener("click", onClick);
    st = null;
  }

  const q = sel => $(sel, st.el);
  const later = (fn, ms) => { const t = setTimeout(() => { if (st) fn(); }, ms); st.timers.push(t); };

  const inChapter = () => st.S.flash.filter(c => st.chapter === "all" || c[0] === st.chapter);
  const missedIn = () => inChapter().filter(c => st.missed.includes(c[1]));

  function updatePack() {
    const na = q(".n-all"), nm = q(".n-missed");
    if (na) na.textContent = inChapter().length;
    if (nm) nm.textContent = missedIn().length;
    st.el.querySelectorAll("[data-act=pack]").forEach(b => b.setAttribute("aria-selected", b.dataset.pack === st.pack));
  }

  function rebuild(list) {
    st.deck = list || (st.pack === "missed" ? missedIn() : inChapter());
    st.i = 0; st.known = 0; st.unknown = 0;
    q(".fc-done").hidden = true;
    updatePack();
    show(0);
    save();
  }

  function setBusy(b) {
    st.busy = b;
    st.el.querySelectorAll("button.nav").forEach(x => { x.disabled = b; });
  }

  function setFlipped(f) {
    st.flipped = f;
    q(".fc-card").classList.toggle("flipped", f);
    q(".fc-ask").hidden = f;
    q(".fc-rate").hidden = !f;
    save();
  }

  function render() {
    const empty = !st.deck.length;
    q(".fc-empty").hidden = !empty;
    q(".fc-body").hidden = empty;
    if (empty) {
      const msg = !st.S.flash.length
        ? ["Pas encore de flashcards", "Les flashcards apparaîtront ici dès que le cours sera ajouté."]
        : st.pack === "missed"
          ? ["Aucune carte à revoir", "Bravo ! Les cartes que tu marques « Je ne savais pas » s'afficheront ici."]
          : ["Aucune carte dans ce chapitre", "Choisis un autre chapitre."];
      q(".fc-empty").innerHTML = `<div class="empty">${icon("cards", "empty-ico")}<h3>${msg[0]}</h3><p>${msg[1]}</p>
        ${st.pack === "missed" && st.S.flash.length ? `<button class="btn primary" data-act="pack" data-pack="all" style="margin-top:16px">Voir toutes les cartes</button>` : ""}</div>`;
      return;
    }
    q(".fc-known").textContent = st.known;
    q(".fc-unknown").textContent = st.unknown;
    const c = st.deck[st.i];
    const card = q(".fc-card");
    card.style.transition = "none";
    setFlipped(false);
    card.dataset.dir = App.prefs().dir;
    void card.offsetWidth;
    card.style.transition = "";
    q(".fc-cat").textContent = c[0];
    q(".fc-cat").hidden = !App.prefs().showcat;
    q(".fc-q").innerHTML = rich(c[1]);
    q(".fc-a").innerHTML = rich(c[2]);
    const rp = q(".fc-rappel");
    rp.hidden = !c[3];
    rp.innerHTML = c[3] ? `<b>${icon("book")}Rappel de cours</b>${rich(c[3])}` : "";
    q(".fc-count").textContent = `Carte ${st.i + 1} sur ${st.deck.length}`;
    q(".fc-prog").style.width = (st.i / st.deck.length * 100) + "%";
    q("[data-act=prev]").style.visibility = st.i ? "" : "hidden";
  }

  function clearAnim() {
    const s = q(".fc-scene");
    ["exitUp", "exitDown", "enter", "slideL", "slideR"].forEach(c => s.classList.remove(c));
  }

  function show(dir) {
    render();
    if (!st.deck.length) return;
    clearAnim();
    if (dir) replay(q(".fc-scene"), dir > 0 ? "slideR" : "slideL");
    save();
  }

  function flip() {
    if (st.busy || !st.deck.length || !q(".fc-done").hidden) return;
    q(".fc-card").dataset.dir = App.prefs().dir;
    setFlipped(!st.flipped);
  }

  function next() {
    if (st.busy || !st.deck.length) return;
    if (st.i >= st.deck.length - 1) { done(); return; }
    st.i++; show(1);
  }
  function prev() { if (st.busy || !st.deck.length || !st.i) return; st.i--; show(-1); }

  function mark(ok) {
    if (st.busy || !st.deck.length || !q(".fc-done").hidden) return;
    setBusy(true);
    const id = st.deck[st.i][1];
    st.missed = st.missed.filter(x => x !== id);
    if (!ok) st.missed.push(id);
    Store.set(st.key, st.missed);
    if (ok) st.known++; else st.unknown++;
    updatePack();
    clearAnim();
    replay(q(".fc-scene"), ok ? "exitUp" : "exitDown");
    if (App.prefs().flashbg) screenFlash(ok ? "g" : "r");
    later(() => {
      if (st.i >= st.deck.length - 1) { setBusy(false); done(); return; }
      st.i++;
      render();
      save();
      clearAnim();
      replay(q(".fc-scene"), "enter");
      later(() => setBusy(false), 380);
    }, 560);
  }

  /* Bilan de fin de paquet */
  function done() {
    const left = missedIn().length;
    q(".fc-body").hidden = true;
    const box = q(".fc-done");
    box.hidden = false;
    box.innerHTML = `
      <div class="done-card">
        <div class="result-ico">${icon("award")}</div>
        <h2>Paquet terminé !</h2>
        <p class="done-sub">${st.deck.length} carte${st.deck.length > 1 ? "s" : ""} parcourue${st.deck.length > 1 ? "s" : ""}</p>
        <div class="done-stats">
          <span class="counter ok">${icon("check")}<b>${st.known}</b> sue${st.known > 1 ? "s" : ""}</span>
          <span class="counter ko">${icon("x")}<b>${st.unknown}</b> ratée${st.unknown > 1 ? "s" : ""}</span>
        </div>
        <div class="done-actions">
          ${left ? `<button class="btn primary lg" data-act="redo-missed">${icon("target")}Revoir les ${left} carte${left > 1 ? "s" : ""} à revoir</button>` : `<p class="done-note">Aucune carte à revoir dans cette sélection. Bravo !</p>`}
          <button class="btn lg" data-act="restart">${icon("reset")}Recommencer le paquet</button>
          <button class="btn lg" data-act="restart-shuffle">${icon("shuffle")}Mélanger et recommencer</button>
          <button class="btn subtle" data-act="to-qcm">${icon("checklist")}Passer au QCM</button>
        </div>
      </div>`;
    save();
  }

  function reset() {
    if (!confirm("Vider la liste des cartes « À revoir » pour cette matière ?")) return;
    st.missed = [];
    Store.del(st.key);
    if (st.pack === "missed") st.pack = "all";
    rebuild();
    App.toast("Liste « À revoir » vidée");
  }

  function onClick(e) {
    const t = e.target.closest("[data-act]");
    if (!t || !st) return;
    switch (t.dataset.act) {
      case "flip": flip(); break;
      case "prev": prev(); break;
      case "next": next(); break;
      case "ok": mark(true); break;
      case "ko": mark(false); break;
      case "shuffle": if (!st.busy && st.deck.length) { st.deck = shuffle(st.deck); st.i = 0; st.known = 0; st.unknown = 0; q(".fc-done").hidden = true; show(1); save(); App.toast("Paquet mélangé"); } break;
      case "pack": if (!st.busy) { st.pack = t.dataset.pack; rebuild(); } break;
      case "reset": if (!st.busy) reset(); break;
      case "redo-missed": st.pack = "missed"; rebuild(); break;
      case "restart": rebuild(); break;
      case "restart-shuffle": rebuild(shuffle(st.pack === "missed" ? missedIn() : inChapter())); break;
      case "ask": {
        const c = st.deck[st.i];
        save();
        App.askAssistant(`Je révise cette flashcard (${c[0]}) :\nQuestion : ${c[1]}\nRéponse : ${c[2].replace(/\*\*/g, "")}\n\nExplique-la-moi simplement, avec un exemple, pour que je la retienne.`,
          null, { link: `fc:${st.S.id}:${c[1]}`, title: "Flashcard · " + U.plain(c[1]).replace(/\$/g, "").slice(0, 60), back: location.hash });
        break;
      }
      case "to-qcm": App.studyChapter("qcm", st.chapter === "all" ? null : st.chapter); break;
    }
  }

  function onKey(e) {
    if (!st || !q(".fc-done").hidden) return false;
    if (e.code === "Space") { flip(); return true; }
    if (e.key === "ArrowRight") { next(); return true; }
    if (e.key === "ArrowLeft") { prev(); return true; }
    if (e.key === "ArrowUp") { mark(true); return true; }
    if (e.key === "ArrowDown") { mark(false); return true; }
    return false;
  }

  function refresh() { if (st && st.deck.length && q(".fc-done").hidden) render(); }

  return { mount, unmount, onKey, refresh };
})();
