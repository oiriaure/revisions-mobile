/* ------------------------------------------------------------------
   Mode QCM
   Fonctionnement repris du modèle : questions tirées au hasard,
   une ou plusieurs bonnes réponses, +1 / +0,5 (partiel) / 0,
   correction immédiate, bilan final avec mention + confettis,
   revue des erreurs.
------------------------------------------------------------------- */
window.Qcm = (function () {
  "use strict";
  const { $, esc, rich, Store, shuffle, chaptersOf, replay, screenFlash, confetti, icon } = U;
  let st = null;

  function mount(el, ctx) {
    const S = ctx.subject;
    st = { el, S, ctx, chapter: "all", timers: [], key: `rev:${ctx.profile.id}:${S.id}:qcm`, runKey: `rev:${ctx.profile.id}:${S.id}:qcmrun` };
    const chapters = chaptersOf(S).filter(c => S.qcm.some(x => x[0] === c));

    el.innerHTML = `
      <div class="mode">
        <div class="toolbar">
          <h2 class="toolbar-title">${icon("checklist")}QCM</h2>
          <div class="toolbar-right">
            <span class="run-chap"></span>
            <button class="btn" data-act="quit" hidden>${icon("x")}Arrêter l'évaluation</button>
          </div>
        </div>

        <div class="qcm-empty" hidden></div>

        <div class="qcm-intro" hidden>
          <div class="intro-card">
            <div class="result-ico">${icon("checklist")}</div>
            <h2>Prêt pour l'évaluation ?</h2>
            <ul class="intro-rules">
              <li>${icon("shuffle")}<span>Des questions <b>tirées au hasard</b>, comme le jour du contrôle.</span></li>
              <li>${icon("check")}<span>Coche <b>une ou plusieurs</b> réponses, puis valide : <b>+1</b> si tout est juste, <b>+½</b> si c'est incomplet, <b>0</b> en cas d'erreur.</span></li>
              <li>${icon("award")}<span>À la fin : ta <b>note sur 20</b> et la <b>correction</b> de chaque question.</span></li>
            </ul>
            <div class="intro-form">
              ${chapters.length ? `
              <label class="field"><span>Chapitre</span>
                <select class="chap-select">
                  <option value="all">Tous les chapitres</option>
                  ${chapters.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}
                </select>
              </label>` : ""}
              <label class="field"><span>Questions</span>
                <select class="count-select">
                  <option value="10">10</option><option value="20">20</option><option value="30">30</option><option value="0">Toutes</option>
                </select>
              </label>
            </div>
            <p class="intro-info"></p>
            <button class="btn primary lg" data-act="begin">Commencer l'évaluation <kbd>Entrée</kbd></button>
          </div>
        </div>

        <div class="qcm-run" hidden>
          <div class="run-head">
            <span class="run-count qcm-count"></span>
            <div class="counters">
              <span class="counter score qcm-chip-note">Note <b class="qcm-note">0</b><small>/ <span class="qcm-tot">0</span></small></span>
              <span class="counter ok" title="Justes">${icon("check")}<b class="qcm-nok">0</b></span>
              <span class="counter part" title="Partielles">½<b class="qcm-npart">0</b></span>
              <span class="counter ko" title="Fausses">${icon("x")}<b class="qcm-nko">0</b></span>
            </div>
          </div>
          <div class="progress"><div class="progress-fill qcm-prog"></div></div>

          <div class="qcm-stage">
            <div class="qcm-scene">
              <div class="qcm-card">
                <div class="chip-cat qcm-cat"></div>
                <div class="qcm-q"></div>
                <div class="qcm-multi"></div>
                <div class="qcm-opts"></div>
                <div class="qcm-corr"></div>
              </div>
            </div>
          </div>

          <div class="qcm-actions">
            <button class="btn primary qcm-val" data-act="validate">Valider</button>
            <button class="btn primary qcm-next" data-act="next" hidden>Question suivante</button>
          </div>
        </div>

        <div class="qcm-review" hidden></div>

        <div class="modal qcm-modal" hidden>
          <div class="dialog result-dialog">
            <div class="result-ico">${icon("award")}</div>
            <h2>QCM terminé</h2>
            <div class="qcm-big"></div>
            <div class="qcm-mention"></div>
            <div class="qcm-stats"></div>
            <div class="dialog-foot center">
              <a class="btn" href="#/${ctx.profile.id}/${S.id}">Retour à la matière</a>
              <button class="btn" data-act="restart">${icon("reset")}Nouvelle évaluation</button>
              <button class="btn" data-act="review-all">${icon("checklist")}Correction complète</button>
              <button class="btn" data-act="retry-err">${icon("target")}Refaire mes erreurs</button>
              <button class="btn primary" data-act="review">${icon("search")}Mes erreurs</button>
            </div>
          </div>
        </div>
      </div>`;

    el.addEventListener("click", onClick);
    const sel = $(".chap-select", el);
    if (sel) sel.addEventListener("change", e => { st.chapter = e.target.value; intro(); });
    $(".count-select", el).addEventListener("change", e => { App.setPref("qcmCount", Number(e.target.value)); intro(); });
    if (!resume()) intro();
  }

  /* ---------- Sauvegarde de l'évaluation en cours ---------- */
  function saveRun(extra) {
    if (!st || !st.deck) return;
    Store.set(st.runKey, Object.assign({
      chapter: st.chapter, deck: st.deck, idx: st.idx, pts: st.pts, nOk: st.nOk, nPart: st.nPart, nKo: st.nKo,
      results: st.results.map(r => ({ i: st.deck.indexOf(r.c), sel: r.sel, res: r.res })),
      locked: st.locked, finished: !!st.finished, reviewing: st.reviewing || null, t: Date.now(), t0: st.t0 || Date.now(), retry: !!st.retry
    }, extra || {}));
  }
  function resume() {
    const r = Store.get(st.runKey, null);
    if (!r || !Array.isArray(r.deck) || !r.deck.length) return false;
    if (r.finished && Date.now() - (r.t || 0) > 30 * 60000) return false; // résultat ancien : nouvel accueil
    Object.assign(st, { deck: r.deck, idx: Math.min(r.idx || 0, r.deck.length - 1), pts: r.pts || 0, nOk: r.nOk || 0, nPart: r.nPart || 0, nKo: r.nKo || 0,
      results: (r.results || []).filter(x => r.deck[x.i]).map(x => ({ c: r.deck[x.i], sel: x.sel || [], res: x.res })),
      sel: new Set(), locked: false, busy: false, inRun: true, finished: !!r.finished, chapter: r.chapter || "all", t0: r.t0 || Date.now(), retry: !!r.retry });
    const sel = q(".chap-select"); if (sel) sel.value = st.chapter;
    q(".qcm-intro").hidden = true; q(".qcm-empty").hidden = true;
    q(".qcm-tot").textContent = st.deck.length;
    q(".run-chap").textContent = st.chapter === "all" ? "Tous les chapitres" : st.chapter;
    updScore(false);
    if (st.finished) {
      q(".qcm-run").hidden = false;
      if (r.reviewing) showReview(r.reviewing === "all"); else finish(true);
      return true;
    }
    q(".qcm-run").hidden = false;
    q("[data-act=quit]").hidden = false;
    render();
    if (r.locked) {
      /* question déjà validée : on réaffiche la correction sans recompter */
      const last = st.results.pop();
      if (last) {
        if (last.res === "ok") { st.nOk--; st.pts -= 1; } else if (last.res === "part") { st.nPart--; st.pts -= .5; } else st.nKo--;
        last.sel.forEach(k => st.sel.add(k));
        validate(true);
      }
    }
    return true;
  }

  /* Écran d'accueil avant l'évaluation */
  function intro() {
    st.timers.forEach(clearTimeout); st.timers = [];
    st.inRun = false; st.finished = false; st.reviewing = null;
    Store.del(st.runKey);
    const pool = st.S.qcm.filter(c => st.chapter === "all" || c[0] === st.chapter);
    q(".qcm-modal").hidden = true;
    q(".qcm-review").hidden = true;
    q(".qcm-run").hidden = true;
    q("[data-act=quit]").hidden = true;
    q(".run-chap").textContent = "";
    if (!st.S.qcm.length) {
      q(".qcm-intro").hidden = true;
      q(".qcm-empty").hidden = false;
      q(".qcm-empty").innerHTML = `<div class="empty">${icon("checklist", "empty-ico")}<h3>Pas encore de questions</h3><p>Le QCM sera disponible dès que le cours sera ajouté.</p></div>`;
      return;
    }
    q(".qcm-empty").hidden = true;
    q(".qcm-intro").hidden = false;
    const n = App.prefs().qcmCount;
    q(".count-select").value = String(n);
    const used = n > 0 ? Math.min(n, pool.length) : pool.length;
    const res = Store.get(st.key, null);
    q(".intro-info").innerHTML = `<b>${used}</b> question${used > 1 ? "s" : ""} sur ${pool.length} disponible${pool.length > 1 ? "s" : ""}` +
      (res && res.best != null ? ` · Meilleur score : <b>${res.best} %</b> · Dernier : ${res.last} %` : "");
  }

  function unmount() {
    if (!st) return;
    st.timers.forEach(clearTimeout);
    st.el.removeEventListener("click", onClick);
    st = null;
  }

  const q = sel => $(sel, st.el);
  const later = (fn, ms) => { const t = setTimeout(() => { if (st) fn(); }, ms); st.timers.push(t); };

  /* Construit les propositions : bonnes réponses + distracteurs.
     Si une question a moins de 3 distracteurs écrits à la main, on complète
     avec des bonnes réponses d'autres questions (même chapitre en priorité). */
  function build(c) {
    const all = st.S.qcm;
    const good = c[2], hand = c[4];
    const wrong = hand && hand.length ? hand.slice(0, 4) : [];
    if (wrong.length < 3) {
      const same = [], other = [];
      all.forEach(x => {
        if (x === c) return;
        x[2].forEach(r => {
          if (good.includes(r) || wrong.includes(r)) return;
          (x[0] === c[0] ? same : other).push(r);
        });
      });
      for (const r of shuffle(same).concat(shuffle(other))) {
        if (wrong.length >= 3) break;
        if (!wrong.includes(r)) wrong.push(r);
      }
    }
    let opts = good.map(t => ({ t, good: true })).concat(wrong.map(t => ({ t, good: false })));
    if (App.prefs().shufo) opts = shuffle(opts);
    return { cat: c[0], q: c[1], opts, exp: c[3] || "" };
  }

  /* list : questions déjà construites (refaire ses erreurs) */
  function start(list) {
    st.timers.forEach(clearTimeout); st.timers = [];
    const p = App.prefs();
    let pool = st.S.qcm.filter(c => st.chapter === "all" || c[0] === st.chapter);
    if (p.shufq) pool = shuffle(pool);
    const n = p.qcmCount > 0 ? p.qcmCount : pool.length;
    const deck = Array.isArray(list) ? (p.shufq ? shuffle(list) : list).map(c => Object.assign({}, c, { opts: p.shufo ? shuffle(c.opts) : c.opts })) : pool.slice(0, n).map(build);
    Object.assign(st, {
      deck, idx: 0, pts: 0, nOk: 0, nPart: 0, nKo: 0, t0: Date.now(), retry: Array.isArray(list),
      results: [], sel: new Set(), locked: false, busy: false, finished: false, reviewing: null
    });
    q(".qcm-modal").hidden = true;
    q(".qcm-review").hidden = true;
    q(".qcm-review").innerHTML = "";
    q(".qcm-tot").textContent = st.deck.length;
    updScore(false);
    if (!st.deck.length) { intro(); return; }
    st.inRun = true;
    q(".qcm-intro").hidden = true;
    q(".qcm-empty").hidden = true;
    q(".qcm-run").hidden = false;
    q("[data-act=quit]").hidden = false;
    q(".run-chap").textContent = st.chapter === "all" ? "Tous les chapitres" : st.chapter;
    render();
    saveRun();
  }

  /* Explication par l'assistant d'une question corrigée */
  function askWhy(r) {
    if (!r) return;
    const strip = s => String(s).replace(/\*\*/g, "");
    const goods = r.c.opts.filter(o => o.good).map(o => strip(o.t));
    const mine = r.sel.map(k => strip(r.c.opts[k].t));
    App.askAssistant(`Question de QCM (${r.c.cat}) : ${strip(r.c.q)}\nPropositions : ${r.c.opts.map(o => strip(o.t)).join(" | ")}\nBonne(s) réponse(s) : ${goods.join(" ; ")}\nMa réponse : ${mine.join(" ; ") || "aucune"}\n\nExplique-moi pourquoi c'est la bonne réponse${r.res === "ok" ? "" : " et où je me suis trompé(e)"}, en t'appuyant sur le cours.`,
      null, { title: "QCM · " + strip(r.c.q).replace(/$/g, "").slice(0, 60), back: location.hash });
  }

  async function quit() {
    if (st.results.length && !await App.ask("Ta progression dans cette évaluation sera perdue.", { title: "Arrêter l'évaluation ?", ok: "Arrêter", danger: true })) return;
    if (st) intro();
  }

  const fmt = n => (Math.round(n * 2) / 2).toString().replace(".", ",");

  function updScore(anim) {
    q(".qcm-note").textContent = fmt(st.pts);
    q(".qcm-nok").textContent = st.nOk;
    q(".qcm-npart").textContent = st.nPart;
    q(".qcm-nko").textContent = st.nKo;
    if (anim) replay(q(".qcm-chip-note"), "bump");
  }

  function render() {
    const c = st.deck[st.idx];
    st.locked = false; st.busy = false; st.sel = new Set();
    const scene = q(".qcm-scene"), card = q(".qcm-card");
    scene.classList.remove("exitUp", "exitDown", "enter");
    card.classList.remove("fok", "fko", "locked");
    q(".qcm-cat").textContent = c.cat;
    q(".qcm-cat").hidden = !App.prefs().showcat;
    q(".qcm-q").innerHTML = rich(c.q);
    const nGood = c.opts.filter(o => o.good).length;
    q(".qcm-multi").textContent = nGood > 1 ? "Plusieurs réponses possibles" : "Une seule bonne réponse";
    q(".qcm-opts").innerHTML = c.opts.map((o, k) => `
      <button class="opt" data-act="opt" data-k="${k}">
        <span class="box">${k < 9 ? k + 1 : ""}</span><span class="txt">${rich(o.t)}</span>
      </button>`).join("");
    const corr = q(".qcm-corr");
    corr.className = "qcm-corr"; corr.innerHTML = "";
    q(".qcm-val").hidden = false;
    q(".qcm-val").disabled = true;
    q(".qcm-next").hidden = true;
    q(".qcm-next").innerHTML = st.idx === st.deck.length - 1 ? `Voir mon résultat${icon("arrow")}` : `Question suivante${icon("arrow")}`;
    q(".qcm-count").textContent = `Question ${st.idx + 1} sur ${st.deck.length}`;
    q(".qcm-prog").style.width = (st.idx / st.deck.length * 100) + "%";
    replay(scene, "enter");
  }

  function toggle(k) {
    if (st.locked || st.busy) return;
    const el = q(".qcm-opts").children[k];
    if (!el) return;
    if (st.sel.has(k)) { st.sel.delete(k); el.classList.remove("sel"); }
    else { st.sel.add(k); el.classList.add("sel"); }
    q(".qcm-val").disabled = st.sel.size === 0;
  }

  function validate(quiet) {
    if (st.locked || st.busy || st.sel.size === 0) return;
    st.locked = true;
    q(".qcm-card").classList.add("locked");
    q(".qcm-val").hidden = true;
    const c = st.deck[st.idx];
    let gs = 0, bs = 0, ms = 0;
    c.opts.forEach((o, k) => {
      const el = q(".qcm-opts").children[k], s = st.sel.has(k);
      el.classList.remove("sel");
      if (o.good && s) { el.classList.add("good"); gs++; }
      else if (!o.good && s) { el.classList.add("bad"); bs++; }
      else if (o.good && !s) { el.classList.add("good", "missed"); ms++; }
    });
    let res, p;
    if (bs === 0 && ms === 0) { res = "ok"; p = 1; st.nOk++; }
    else if (bs === 0 && gs > 0) { res = "part"; p = .5; st.nPart++; }
    else { res = "ko"; p = 0; st.nKo++; }
    st.pts += p;
    const goods = c.opts.filter(o => o.good).map(o => rich(o.t)).join(" • ");
    const title = {
      ok: `${icon("check")}Bonne réponse <span>+1</span>`,
      part: `<i class="half">½</i>Partiellement juste <span>+0,5</span>`,
      ko: `${icon("x")}Mauvaise réponse <span>0</span>`
    }[res];
    const corr = q(".qcm-corr");
    corr.className = "qcm-corr show " + res;
    corr.innerHTML = `<b class="corr-title">${title}</b><div>Bonne(s) réponse(s) : ${goods}</div>${c.exp ? `<div class="exp">${rich(c.exp)}</div>` : ""}${window.Assistant && Assistant.available() ? `<button class="btn subtle small ask-btn" data-act="ask" data-r="${st.results.length}">${icon("sparkle")}Pourquoi ? Demander à Prof Susuzouzou</button>` : ""}`;
    if (res === "ok") q(".qcm-card").classList.add("fok");
    else if (res === "ko") q(".qcm-card").classList.add("fko");
    if (!quiet && App.prefs().flashbg && res !== "part") screenFlash(res === "ok" ? "g" : "r");
    st.results.push({ c, sel: Array.from(st.sel), res });
    updScore(!quiet);
    saveRun();
    q(".qcm-next").hidden = false;
    q(".qcm-next").focus({ preventScroll: true });
  }

  function next() {
    if (st.busy || !st.locked) return;
    if (st.idx >= st.deck.length - 1) { finish(); return; }
    st.busy = true;
    const last = st.results[st.results.length - 1];
    const s = q(".qcm-scene");
    s.classList.remove("enter");
    replay(s, last && last.res === "ko" ? "exitDown" : "exitUp");
    later(() => {
      st.idx++; render(); saveRun();
      if (st.idx % 10 === 0) cheer();
    }, 500);
  }

  /* Petite bulle d'encouragement (profils qui l'activent, désactivable) */
  function cheer() {
    const p = st.ctx.profile;
    if (!p.cheers || !App.prefs().cheer) return;
    let b = document.getElementById("cheer");
    if (!b) { b = document.createElement("div"); b.id = "cheer"; document.body.appendChild(b); }
    const msg = p.cheers[Math.floor(st.idx / 10 - 1) % p.cheers.length];
    b.innerHTML = `<div class="cheer-ico">${icon("heart")}</div>
      <div class="cheer-body"><b>${esc(msg)}</b><small>${st.idx} questions sur ${st.deck.length} : continue comme ça !</small>
        <label class="cheer-off"><input type="checkbox" data-cheer-off> Ne plus afficher ces messages</label></div>
      <button class="icon-btn" data-cheer-close title="Fermer">${icon("x")}</button>`;
    b.className = "show";
    clearTimeout(b._t);
    b._t = setTimeout(() => { b.className = ""; }, 6000);
    b.onclick = e => {
      if (e.target.closest("[data-cheer-off]")) { App.setPref("cheer", !e.target.checked); App.toast(e.target.checked ? "Messages d'encouragement désactivés (réactivables dans les Réglages)" : "Messages d'encouragement réactivés"); return; }
      if (e.target.closest("[data-cheer-close]")) b.className = "";
    };
  }

  function mention(r) {
    if (r >= .9) return "Excellent !";
    if (r >= .75) return "Très bien !";
    if (r >= .6) return "Bien, continue comme ça";
    if (r >= .5) return "Passable, à retravailler";
    return "Il faut encore réviser";
  }

  /* Message selon la note sur 20 (messages propres au profil s'ils existent) */
  function gradeMessage(n20) {
    const m = st.ctx.profile.grades;
    if (m) { for (const g of m) if (n20 >= g.min) return g.text; }
    return mention(n20 / 20);
  }

  function finish(restored) {
    q(".qcm-prog").style.width = "100%";
    q("[data-act=quit]").hidden = true;
    const r = st.pts / st.deck.length;
    const pct = Math.round(r * 100);
    const n20 = Math.round(r * 200) / 10;
    const fr = n => n.toString().replace(".", ",");
    q(".qcm-big").innerHTML = `${fr(n20)}<small> / 20</small>`;
    q(".qcm-mention").innerHTML = `<p class="grade-msg">${esc(gradeMessage(n20))}</p><span>${fmt(st.pts)} / ${st.deck.length} points · ${pct} %</span>`;
    q(".qcm-stats").innerHTML = `<span class="counter ok">${icon("check")}<b>${st.nOk}</b></span><span class="counter part">½<b>${st.nPart}</b></span><span class="counter ko">${icon("x")}<b>${st.nKo}</b></span>`;
    q(".qcm-modal").hidden = false;
    q("[data-act=retry-err]").hidden = !st.results.some(x => x.res !== "ok");
    st.reviewing = null;
    if (restored) { saveRun(); return; }
    st.finished = true;
    saveRun();
    const prev = Store.get(st.key, { best: null, last: null, sessions: 0 });
    Store.set(st.key, { best: prev.best == null ? pct : Math.max(prev.best, pct), last: pct, sessions: (prev.sessions || 0) + 1 });
    /* Historique des évaluations (statistiques, activité partagée) */
    const hk = `rev:${st.ctx.profile.id}:${st.S.id}:qcmhist`;
    const hist = Store.get(hk, []);
    hist.push({ t: Date.now(), n20, pct, n: st.deck.length, ok: st.nOk, part: st.nPart, ko: st.nKo, chap: st.chapter });
    Store.set(hk, hist.slice(-200));
    if (window.Track) Track.event(st.ctx.profile.id, { type: "qcm", sid: st.S.id, title: st.S.title + (st.retry ? " (erreurs)" : ""), n20, pct, n: st.deck.length, chap: st.chapter, dur: Math.round((Date.now() - (st.t0 || Date.now())) / 1000) });
    if (App.prefs().conf) { confetti(); if (r >= .85) setTimeout(confetti, 900); }
  }

  function showReview(all) {
    st.reviewAll = !!all;
    st.reviewing = all ? "all" : "err";
    saveRun();
    q(".qcm-modal").hidden = true;
    q(".qcm-run").hidden = true;
    const errs = st.results.filter(x => x.res !== "ok");
    const list = all ? st.results : errs;
    const lbl = { ok: "Juste", part: "Partiel", ko: "Faux" };
    let h = `<div class="rv-head"><h3 class="rv-title">${all ? "Correction complète" : "Mes erreurs"} <span>${list.length}</span></h3>
      <div class="seg"><button data-act="rv-err" aria-selected="${!all}">Mes erreurs</button><button data-act="rv-all" aria-selected="${all}">Toutes les questions</button></div></div>`;
    if (!list.length) h += `<div class="rv">Aucune erreur, bravo !</div>`;
    list.forEach(e => {
      h += `<div class="rv selectable"><div class="rv-top"><div class="chip-cat">${esc(e.c.cat)}</div><span class="rv-res ${e.res}">${lbl[e.res]}</span></div><h4>${rich(e.c.q)}</h4>`;
      e.c.opts.forEach((o, k) => {
        const s = e.sel.includes(k);
        if (o.good) h += `<div class="a g">${icon("check")}<span>${rich(o.t)}${s ? "" : " <i>(oubliée)</i>"}</span></div>`;
        else if (s) h += `<div class="a b">${icon("x")}<span>${rich(o.t)} <i>(ta réponse)</i></span></div>`;
      });
      if (e.c.exp) h += `<div class="exp">${rich(e.c.exp)}</div>`;
      if (window.Assistant && Assistant.available()) h += `<button class="btn subtle small ask-btn" data-act="ask" data-r="${st.results.indexOf(e)}">${icon("sparkle")}Expliquer</button>`;
      h += `</div>`;
    });
    h += `<div class="rv-actions">${errs.length ? `<button class="btn" data-act="retry-err">${icon("target")}Refaire mes ${errs.length} erreur${errs.length > 1 ? "s" : ""}</button>` : ""}<button class="btn primary" data-act="restart">${icon("reset")}Nouvelle évaluation</button></div>`;
    q(".qcm-review").innerHTML = h;
    q(".qcm-review").hidden = false;
    const sc = document.getElementById("scroller");
    if (sc) sc.scrollTop = 0;
  }

  function onClick(e) {
    const t = e.target.closest("[data-act]");
    if (!t || !st) return;
    switch (t.dataset.act) {
      case "opt": toggle(+t.dataset.k); break;
      case "validate": validate(); break;
      case "next": next(); break;
      case "review": showReview(false); break;
      case "review-all": showReview(true); break;
      case "rv-err": showReview(false); break;
      case "rv-all": showReview(true); break;
      case "restart": start(); break;
      case "retry-err": start(st.results.filter(x => x.res !== "ok").map(x => x.c)); App.toast("C'est reparti sur tes erreurs"); break;
      case "begin": start(); break;
      case "ask": askWhy(st.results[+t.dataset.r]); break;
      case "quit": quit(); break;
    }
  }

  function onKey(e) {
    if (st && !q(".qcm-intro").hidden) { if (e.key === "Enter") { start(); return true; } return false; }
    if (!st || !q(".qcm-modal").hidden || !q(".qcm-review").hidden) return false;
    if (e.key === "Enter") {
      if (!q(".qcm-val").hidden) validate(); else if (!q(".qcm-next").hidden) next();
      return true;
    }
    if (e.key >= "1" && e.key <= "9") { toggle(+e.key - 1); return true; }
    return false;
  }

  function refresh() {
    if (!st || !st.deck || !st.deck.length) return;
    q(".qcm-cat").hidden = !App.prefs().showcat;
  }

  return { mount, unmount, onKey, refresh };
})();
