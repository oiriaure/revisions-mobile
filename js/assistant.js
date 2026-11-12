/* ------------------------------------------------------------------
   Assistant de révision (Google Gemini, offre gratuite).
   Un « prof particulier » pour tous les profils : il s'appuie sur le cours
   choisi (une matière, toutes, ou aucun) et répond en direct (streaming).
------------------------------------------------------------------- */
window.Assistant = (function () {
  "use strict";
  const { $, esc, md, Store, chaptersOf, icon } = U;
  const CFG = (window.APP_CONFIG || {}).gemini || {};
  const MAX_TURNS = 24;          // messages envoyés comme historique
  const MAX_CONTEXT = 150000;    // caractères de cours envoyés
  let st = null;

  /* ---------- Contexte du cours ---------- */
  function courseText(S) {
    const out = [`MATIÈRE : ${S.title}`];
    chaptersOf(S).forEach(c => {
      const r = S.rappels.find(x => x.chap === c);
      out.push(`\n## ${c}${r ? " — " + r.titre : ""}`);
      if (r) {
        if (r.resume) out.push(r.resume);
        (r.points || []).forEach(p => out.push("- " + p));
        (r.definitions || []).forEach(d => out.push(`- Définition — ${d[0]} : ${d[1]}`));
        if (r.retenir) out.push("À retenir : " + r.retenir);
      }
      S.flash.filter(f => f[0] === c).forEach(f => out.push(`Q : ${f[1]}\nR : ${f[2]}${f[3] ? "\n(Rappel : " + f[3] + ")" : ""}`));
    });
    S.rappels.filter(r => !chaptersOf(S).includes(r.chap)).forEach(r => {
      out.push(`\n## ${r.chap} — ${r.titre}`);
      (r.points || []).forEach(p => out.push("- " + p));
    });
    return out.join("\n").replace(/\*\*/g, "").slice(0, MAX_CONTEXT);
  }

  /* Contexte : une matière, toutes les matières du profil, ou aucune (question générale) */
  const subjectsOf = pid => SUBJECTS.filter(s => s.profile === pid && (s.flash.length || s.rappels.length));

  function scopeLabel(scope, pid) {
    if (scope === "none") return "Question générale";
    if (scope === "all") return "Toutes mes matières";
    const S = subjectsOf(pid).find(s => s.id === scope);
    return S ? S.title : "Question générale";
  }

  function scopeCourse(scope, pid) {
    const subs = subjectsOf(pid);
    if (scope === "none" || !subs.length) return "";
    const list = scope === "all" ? subs : subs.filter(s => s.id === scope);
    return list.map(courseText).join("\n\n").slice(0, MAX_CONTEXT);
  }

  function systemPrompt(scope, profile) {
    const course = scopeCourse(scope, profile.id);
    const who = profile.about || "qui révise ses cours";
    return [
      `Tu es « Prof Susuzouzou », le professeur particulier de ${profile.name}, ${who}. Ton rôle : l'aider à RÉVISER et à COMPRENDRE, pas faire le travail à sa place. Si on te demande ton nom, tu t'appelles Prof Susuzouzou.`,
      "",
      "Ta personnalité : un professeur bienveillant, patient et exigeant, passionné par sa matière. Tu encourages, tu félicites les progrès, tu ne juges jamais. Tu tutoies.",
      "",
      "Ta méthode pédagogique :",
      "- Explique simplement d'abord, puis précise : définition claire → exemple concret → ce qu'il faut retenir.",
      "- Vérifie la compréhension : termine souvent par UNE petite question pour que l'élève s'entraîne (« À toi : … ? »).",
      "- Quand l'élève répond ou se trompe, ne donne pas tout de suite la solution : dis ce qui est juste, donne un indice, laisse-lui une seconde chance, puis corrige clairement.",
      "- Quand on te demande de l'interroger : une seule question à la fois, attends la réponse, corrige, note la progression, puis passe à la suivante.",
      "- Donne volontiers des conseils de méthode : comment mémoriser, comment répondre à un QCM, comment construire une dissertation (problématique, plan en deux parties), comment s'organiser avant un partiel.",
      "- Pour un calcul : détaille chaque étape et vérifie le résultat.",
      "",
      "Forme :",
      "- Français, phrases courtes, listes, **gras** pour les notions clés. 12 lignes maximum, sauf si on te demande plus.",
      "- Formules : écris-les en LaTeX entre dollars, elles s'affichent comme sur une feuille. Exemple : $R = \\dfrac{\\rho L}{S}$ ou, centrée, $$U_i = E \\cdot \\dfrac{R_i}{R_1 + R_i}$$. N'utilise jamais le symbole $ pour autre chose.",
      "",
      course
        ? "Le COURS de l'élève est ci-dessous. Appuie-toi dessus en priorité, avec son vocabulaire, ses dates et ses chiffres. N'invente jamais un chiffre, une date ou une définition « du cours ». Si une question sort du cours, dis-le en une phrase (« Ce point n'est pas dans ton cours »), puis aide quand même brièvement."
        : "Aucun cours n'est sélectionné : aide à partir de tes connaissances générales (méthodologie, explications, organisation des révisions), en restant prudent et en signalant quand il vaut mieux vérifier dans le cours.",
      course ? "\n===== COURS =====\n" + course : ""
    ].join("\n");
  }

  /* ---------- Appel à Gemini (streaming SSE) ---------- */
  /* Modèle qui a répondu en dernier : essayé en premier la fois suivante */
  let goodModel = Store.get("rev:gemini:model", null);

  async function openStream(model, body, signal) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    /* Un modèle saturé peut laisser la requête en suspens : on abandonne après 12 s */
    const ac = new AbortController();
    const stop = () => ac.abort();
    signal.addEventListener("abort", stop);
    const timer = setTimeout(stop, 12000);
    let res;
    try {
      res = await fetch(url, { method: "POST", signal: ac.signal, headers: { "Content-Type": "application/json", "x-goog-api-key": CFG.key }, body });
    } catch (e) {
      if (signal.aborted) throw e;
      const err = new Error("timeout"); err.status = 504; throw err;
    } finally { clearTimeout(timer); signal.removeEventListener("abort", stop); }
    if (!res.ok) {
      const err = new Error("http"); err.status = res.status;
      try { err.detail = (await res.json()).error.message; } catch (e) { /* rien */ }
      throw err;
    }
    return res;
  }

  async function streamGemini(history, system, onText, signal) {
    if (window.__geminiMock) return window.__geminiMock(history, onText);
    const list = CFG.models || [CFG.model || "gemini-flash-latest"];
    const order = goodModel && list.includes(goodModel) ? [goodModel, ...list.filter(m => m !== goodModel)] : list;
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: history.map(m => ({ role: m.role, parts: [{ text: m.text }] })),
      generationConfig: { temperature: 0.4 }
    });
    let res = null, last = null;
    for (const model of order) {
      try { res = await openStream(model, body, signal); goodModel = model; Store.set("rev:gemini:model", model); break; }
      catch (e) {
        last = e;
        if (e.name === "AbortError" || e.status === 400 || e.status === 403) throw e;   // clé ou requête : inutile d'insister
      }
    }
    if (!res) throw last || new Error("indisponible");
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = "", full = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        try {
          const j = JSON.parse(line.slice(5));
          const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
          const t = parts.map(p => p.text || "").join("");
          if (t) { full += t; onText(full); }
        } catch (e) { /* ligne incomplète */ }
      }
    }
    return full;
  }

  function errorText(e) {
    if (e && e.name === "AbortError") return "Réponse interrompue.";
    if (!navigator.onLine) return "Pas de connexion Internet : l'assistant a besoin d'Internet pour répondre.";
    if (e && (e.status === 429 || e.status === 503 || e.status === 504)) return "L'assistant est très demandé en ce moment (offre gratuite). Réessaie dans une minute.";
    if (e && (e.status === 400 || e.status === 403)) return "La clé de l'assistant n'est pas valide. Préviens Clément.";
    if (e && e.status >= 500) return "Le service Gemini est momentanément indisponible. Réessaie dans un instant.";
    return "Impossible de joindre l'assistant. Vérifie ta connexion et réessaie.";
  }

  /* ---------- Interface ---------- */
  function suggestions(scope, pid) {
    if (scope === "none") return [
      { ico: "bulb", label: "Bien mémoriser", text: "Quelles sont les meilleures méthodes pour bien mémoriser un cours ? Donne-moi une méthode concrète à appliquer dès aujourd'hui." },
      { ico: "grid", label: "Planning de révision", text: "Aide-moi à construire un planning de révision réaliste pour mes partiels. Pose-moi d'abord les questions dont tu as besoin." },
      { ico: "doc", label: "Méthode de dissertation", text: "Explique-moi la méthode de la dissertation : problématique, plan en deux parties, introduction et conclusion." },
      { ico: "checklist", label: "Réussir un QCM", text: "Quelles stratégies pour réussir un QCM, surtout quand il y a plusieurs bonnes réponses et des points partiels ?" }
    ];
    const subs = subjectsOf(pid);
    const S = scope === "all" ? subs[0] : subs.find(s => s.id === scope);
    const ch = S ? chaptersOf(S).filter(c => S.rappels.some(r => r.chap === c)) : [];
    const first = ch[0] || "un chapitre";
    return [
      { ico: "target", label: "Interroge-moi", text: scope === "all" ? "Interroge-moi en mélangeant mes matières, une question à la fois." : `Interroge-moi sur le chapitre « ${first} », une question à la fois.` },
      { ico: "bulb", label: "Explique simplement", text: "Explique-moi simplement la notion la plus importante de ce cours, avec un exemple, puis vérifie que j'ai compris." },
      { ico: "book", label: "Résume un chapitre", text: `Fais-moi un résumé en 5 points du chapitre « ${first} ».` },
      { ico: "doc", label: "Sujet de partiel", text: "Propose-moi un sujet de partiel probable sur ce cours et aide-moi à construire le plan, étape par étape, sans me donner la réponse tout de suite." }
    ];
  }

  /* ---------- Conversations (sauvegardées, comme dans une messagerie) ---------- */
  const convKey = pid => `rev:${pid}:convs`;
  const curKey = pid => `rev:${pid}:conv:cur`;
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function loadConvs(pid) {
    let list = Store.get(convKey(pid), null);
    if (!Array.isArray(list)) {
      /* Reprise des anciennes discussions (une par matière) */
      list = [];
      Store.keys(`rev:${pid}:chat:`).filter(k => !k.endsWith(":scope")).forEach(k => {
        const h = Store.get(k, []);
        if (Array.isArray(h) && h.length) {
          const scope = k.slice(`rev:${pid}:chat:`.length);
          list.push({ id: newId(), title: firstTitle(h) || scopeLabel(scope, pid), scope, created: Date.now(), updated: Date.now(), history: h });
        }
      });
      Store.set(convKey(pid), list);
    }
    return list;
  }
  function saveConvs() {
    if (!st) return;
    st.convs.sort((a, b) => b.updated - a.updated);
    Store.set(convKey(st.pid), st.convs.slice(0, 80).map(c => Object.assign({}, c, { history: c.history.filter(m => !m.error).slice(-80) })));
  }
  const firstTitle = h => { const m = h.find(x => x.role === "user"); return m ? m.text.replace(/\s+/g, " ").replace(/\$/g, "").slice(0, 60) : ""; };
  const cur = () => st && st.convs.find(c => c.id === st.cur);

  function defaultScope(pid) {
    const subs = subjectsOf(pid);
    const saved = Store.get(`rev:${pid}:chat:scope`, null);
    if (saved === "none" || saved === "all" || subs.some(s => s.id === saved)) return saved;
    return subs.length ? "all" : "none";
  }
  const validScope = (sc, pid) => sc && (sc === "none" || sc === "all" || subjectsOf(pid).some(s => s.id === sc));

  function newConv(scope, title, link) {
    const c = { id: newId(), title: title || "", scope, link: link || null, created: Date.now(), updated: Date.now(), history: [] };
    st.convs.unshift(c);
    st.cur = c.id;
    Store.set(curKey(st.pid), c.id);
    return c;
  }

  function mount(el, ctx) {
    const pid = ctx.profile.id;
    const wanted = App.takePendingScope();
    const pending = App.takePendingPrompt();
    const opts = App.takePendingOpts() || {};
    const ready = !!(CFG.key || window.__geminiMock);
    st = { el, ctx, pid, busy: false, ctrl: null, convs: loadConvs(pid), cur: Store.get(curKey(pid), null), back: opts.back || null, filter: "" };
    const subs = subjectsOf(pid);
    let scope = validScope(wanted, pid) ? wanted : defaultScope(pid);
    if (scope === "all" && subs.length === 1) scope = subs[0].id;
    let toSend = null;
    if (pending) {
      const linked = opts.link && st.convs.find(c => c.link === opts.link);
      if (linked) { st.cur = linked.id; }           // on reprend la discussion déjà ouverte sur cette carte
      else { newConv(scope, opts.title, opts.link); toSend = pending; }
    } else if (wanted || !cur()) {
      /* arrivée depuis une matière : la dernière discussion vide est réutilisée */
      const c = cur();
      if (!c || (c.history.length && wanted && c.scope !== scope)) newConv(scope);
      else if (!c.history.length) c.scope = scope;
    }
    Store.set(curKey(pid), st.cur);

    el.innerHTML = `
      <div class="mode chat-mode">
        <div class="toolbar">
          <h2 class="toolbar-title">${icon("sparkle")}Prof Susuzouzou</h2>
          <div class="toolbar-right">
            ${st.back ? `<a class="btn" href="${esc(st.back)}">${icon("left")}Revenir où j'en étais</a>` : ""}
            <label class="field"><span>Je révise</span>
              <select class="scope-select">
                ${subs.map(s => `<option value="${esc(s.id)}">${esc(s.title)}</option>`).join("")}
                ${subs.length > 1 ? `<option value="all">Toutes mes matières</option>` : ""}
                <option value="none">Question générale</option>
              </select>
            </label>
          </div>
        </div>
        ${ready ? `
        <div class="chat-wrap">
          <aside class="conv-panel">
            <button class="btn primary conv-new" data-act="new">${icon("plus")}Nouvelle conversation</button>
            <label class="conv-search">${icon("search")}<input type="search" placeholder="Rechercher…"></label>
            <div class="conv-list"></div>
          </aside>
          <div class="chat">
            <div class="chat-log"></div>
            <form class="composer">
              <textarea rows="1" placeholder="Pose ta question à Prof Susuzouzou…" maxlength="4000"></textarea>
              <button class="btn primary icon-only send" type="submit" title="Envoyer (Entrée)">${icon("send")}</button>
            </form>
            <p class="chat-note">Réponses générées par une IA (Gemini) : vérifie avec tes fiches en cas de doute. <kbd>Entrée</kbd> envoie, <kbd>Maj</kbd> + <kbd>Entrée</kbd> va à la ligne.</p>
          </div>
        </div>` : `
        <div class="empty">${icon("sparkle", "empty-ico")}<h3>Prof Susuzouzou n'est pas encore activé</h3>
          <p>Il faut une clé Gemini (gratuite) dans la configuration de l'application.</p></div>`}
      </div>`;
    if (!ready) return;
    const sel = $(".scope-select", el);
    sel.addEventListener("change", e => {
      const c = cur();
      if (c && c.history.length && c.scope !== e.target.value) { newConv(e.target.value); }
      else if (c) c.scope = e.target.value;
      Store.set(`rev:${pid}:chat:scope`, e.target.value);
      saveConvs(); renderAll();
    });
    el.addEventListener("click", onClick);
    const form = $(".composer", el), ta = $("textarea", el);
    form.addEventListener("submit", e => { e.preventDefault(); send(ta.value); });
    ta.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(ta.value); }
    });
    ta.addEventListener("input", autosize);
    $(".conv-search input", el).addEventListener("input", e => { st.filter = e.target.value.trim().toLowerCase(); renderList(); });
    saveConvs();
    renderAll();
    if (toSend) send(toSend); else ta.focus();
  }

  function unmount() {
    if (!st) return;
    if (st.ctrl) st.ctrl.abort();
    saveConvs();
    st.el.removeEventListener("click", onClick);
    st = null;
  }

  function autosize() {
    const ta = $("textarea", st.el);
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 180) + "px";
  }

  const when = t => {
    const d = new Date(t), now = new Date();
    const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(now) - day(d)) / 864e5);
    if (diff === 0) return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    if (diff === 1) return "Hier";
    if (diff < 7) return d.toLocaleDateString("fr-FR", { weekday: "long" });
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  };

  function renderList() {
    const box = $(".conv-list", st.el);
    if (!box) return;
    const list = st.convs.filter(c => c.history.length || c.id === st.cur)
      .filter(c => !st.filter || (c.title || "").toLowerCase().includes(st.filter) || c.history.some(m => m.text.toLowerCase().includes(st.filter)));
    box.innerHTML = list.length ? list.map(c => `
      <div class="conv-item${c.id === st.cur ? " on" : ""}" data-act="open" data-id="${c.id}" role="button" tabindex="0">
        <span class="conv-ico">${icon(c.link ? "cards" : c.scope === "none" ? "bulb" : "sparkle")}</span>
        <span class="conv-txt"><b>${esc(c.title || firstTitle(c.history) || "Nouvelle conversation")}</b>
          <small>${esc(scopeLabel(c.scope, st.pid))} · ${when(c.updated)}</small></span>
        <button class="icon-btn conv-del" data-act="del" data-id="${c.id}" title="Supprimer la conversation">${icon("trash")}</button>
      </div>`).join("") : `<p class="conv-empty">${st.filter ? "Aucun résultat" : "Tes conversations apparaîtront ici."}</p>`;
  }

  function renderAll() {
    const c = cur();
    const sel = $(".scope-select", st.el);
    if (c && sel) sel.value = c.scope;
    renderList();
    renderLog();
  }

  function bubble(m, i) {
    if (m.role === "user") return `<div class="msg user"><div class="bubble">${esc(m.text).replace(/\n/g, "<br>")}</div></div>`;
    return `<div class="msg bot${m.error ? " error" : ""}" data-i="${i}">
      <span class="bot-ico">${icon("sparkle")}</span>
      <div class="bubble selectable">${m.text ? md(m.text) : `<span class="typing"><i></i><i></i><i></i></span>`}</div>
    </div>`;
  }

  function renderLog() {
    const log = $(".chat-log", st.el);
    const c = cur();
    if (!c || !c.history.length) {
      const scope = c ? c.scope : "none";
      const label = scopeLabel(scope, st.pid);
      const intro = scope === "none"
        ? "Je suis Prof Susuzouzou, ton prof particulier. Je peux t'expliquer une notion, te donner une méthode de travail ou t'aider à t'organiser."
        : `Je suis Prof Susuzouzou, ton prof particulier, et je connais ton cours de <b>${esc(label)}</b>. Je t'explique, je t'interroge et je t'aide à progresser.`;
      log.innerHTML = `
        <div class="chat-welcome">
          <div class="result-ico">${icon("sparkle")}</div>
          <h3>Bonjour ${esc(st.ctx.profile.name)}, on révise quoi aujourd'hui ?</h3>
          <p>${intro} Pose ta question, ou choisis une idée :</p>
          <div class="chat-suggest">${suggestions(scope, st.pid).map(s =>
            `<button class="chip-btn lg" data-act="suggest" data-text="${esc(s.text)}">${icon(s.ico)}${esc(s.label)}</button>`).join("")}</div>
        </div>`;
      return;
    }
    log.innerHTML = c.history.map(bubble).join("");
    scrollDown();
  }

  function scrollDown() {
    const sc = document.getElementById("scroller");
    if (sc) sc.scrollTop = sc.scrollHeight;
  }

  async function send(text) {
    text = String(text || "").trim();
    if (!text || st.busy) return;
    const conv = cur() || newConv(defaultScope(st.pid));
    const ta = $("textarea", st.el);
    ta.value = ""; autosize();
    conv.history.push({ role: "user", text });
    if (!conv.title) conv.title = firstTitle(conv.history);
    const bot = { role: "model", text: "" };
    conv.history.push(bot);
    conv.updated = Date.now();
    st.busy = true;
    $(".send", st.el).disabled = true;
    renderAll();
    const mine = st;
    const node = () => mine.el.querySelector(`.msg.bot[data-i="${conv.history.length - 1}"] .bubble`);
    mine.ctrl = new AbortController();
    try {
      const turns = conv.history.slice(0, -1).filter(m => !m.error).slice(-MAX_TURNS);
      const full = await streamGemini(turns, systemPrompt(conv.scope, mine.ctx.profile), t => {
        if (st !== mine || mine.cur !== conv.id) return;
        bot.text = t;
        const n = node(); if (n) n.innerHTML = md(t);
        scrollDown();
      }, mine.ctrl.signal);
      bot.text = full || "Je n'ai pas de réponse à proposer. Reformule ta question ?";
    } catch (e) {
      bot.text = errorText(e); bot.error = true;
    }
    conv.updated = Date.now();
    mine.busy = false; mine.ctrl = null;
    if (st !== mine) {
      /* on a quitté l'assistant pendant la réponse : on l'enregistre quand même */
      const all = loadConvs(mine.pid).filter(c => c.id !== conv.id);
      all.unshift(Object.assign({}, conv, { history: conv.history.filter(m => !m.error) }));
      Store.set(convKey(mine.pid), all.slice(0, 80));
      return;
    }
    saveConvs();
    $(".send", st.el).disabled = false;
    renderAll();
    $("textarea", st.el).focus();
  }

  function onClick(e) {
    const t = e.target.closest("[data-act]");
    if (!t || !st) return;
    const act = t.dataset.act;
    if (act === "suggest") send(t.dataset.text);
    else if (act === "new") {
      if (st.busy) return;
      const c = cur();
      if (!c || c.history.length) newConv(c ? c.scope : defaultScope(st.pid));
      saveConvs(); renderAll();
      $("textarea", st.el).focus();
    } else if (act === "del") {
      e.stopPropagation();
      if (st.busy) return;
      const id = t.dataset.id;
      App.ask("La conversation et ses messages seront effacés.", { title: "Supprimer cette conversation ?", ok: "Supprimer", danger: true }).then(ok => {
        if (!ok || !st) return;
        st.convs = st.convs.filter(c => c.id !== id);
        if (st.cur === id) { st.cur = (st.convs[0] || newConv(defaultScope(st.pid))).id; Store.set(curKey(st.pid), st.cur); }
        saveConvs(); renderAll();
      });
    } else if (act === "open") {
      if (st.busy) return;
      st.cur = t.dataset.id; Store.set(curKey(st.pid), st.cur);
      renderAll();
    }
  }

  /* Nombre de conversations (statistiques) */
  const count = pid => (Store.get(convKey(pid), []) || []).filter(c => c.history && c.history.length).length;

  return { mount, unmount, onKey: () => false, refresh() {}, count, available: () => !!(CFG.key || window.__geminiMock) };
})();
