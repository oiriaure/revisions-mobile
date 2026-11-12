/* ------------------------------------------------------------------
   Recherche globale (Ctrl + K) : pages, matières, chapitres, fiches,
   flashcards, questions de QCM et notes. Flèches + Entrée.
------------------------------------------------------------------- */
window.Palette = (function () {
  "use strict";
  const { $, esc, Store, icon, chaptersOf } = U;
  const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[*$\\{}]/g, "").toLowerCase();
  let pid = null, list = [], sel = 0;

  function base() {
    const p = `#/${pid}`;
    return [
      { ico: "home", t: "Accueil", sub: "Page", href: p },
      { ico: "calendar", t: "Calendrier", sub: "Page", href: `${p}/calendar` },
      { ico: "sparkle", t: "Organiser mon programme", sub: "Calendrier", href: `${p}/calendar`, run: () => setTimeout(() => { const b = document.querySelector("[data-cal=gen]"); if (b) b.click(); }, 120) },
      { ico: "note", t: "Notes", sub: "Page", href: `${p}/notes` },
      { ico: "plus", t: "Nouvelle note", sub: "Notes", href: `${p}/notes`, run: () => setTimeout(() => { const b = document.querySelector(".notes-mode [data-act=new]"); if (b) b.click(); }, 120) },
      { ico: "sparkle", t: "Prof Susuzouzou", sub: "Assistant", href: `${p}/assistant` },
      { ico: "chart", t: "Statistiques", sub: "Page", href: `${p}/stats` },
      { ico: "award", t: "Historique des QCM", sub: "Page", href: `${p}/history` },
      { ico: "bell", t: "Notifications", sub: "Menu", run: () => { const b = document.querySelector(".tb-bell"); if (b) Social.openInbox(b); } },
      { ico: "sliders", t: "Réglages", sub: "Application", run: () => { const b = document.querySelector("[data-app=settings]"); if (b) b.click(); } },
      { ico: "swap", t: "Changer de profil", sub: "Application", href: "#/" }
    ];
  }

  function search(q) {
    const n = norm(q).trim();
    const subs = SUBJECTS.filter(s => s.profile === pid);
    if (!n) return base().concat(subs.map(s => ({ ico: "book", t: s.title, sub: "Matière", href: `#/${pid}/${s.id}`, c: s.color })));
    const words = n.split(/\s+/);
    const hit = s => { const x = norm(s); return words.every(w => x.includes(w)); };
    const out = [];
    base().forEach(b => { if (hit(b.t)) out.push(b); });
    subs.forEach(S => {
      if (hit(S.title)) {
        out.push({ ico: "book", t: S.title, sub: "Matière", href: `#/${pid}/${S.id}`, c: S.color });
        [["rappels", "Fiches de cours", "book"], ["flash", "Flashcards", "cards"], ["qcm", "QCM", "checklist"]].forEach(([m, l, i]) =>
          out.push({ ico: i, t: `${l} · ${S.title}`, sub: "Réviser", href: `#/${pid}/${S.id}/${m}`, c: S.color }));
      }
      chaptersOf(S).forEach(c => {
        const r = S.rappels.find(x => x.chap === c);
        if (hit(c + " " + (r ? r.titre : ""))) out.push({ ico: "book", t: `${c}${r ? " · " + r.titre : ""}`, sub: `Fiche · ${S.title}`, href: `#/${pid}/${S.id}/rappels`, chap: c, c: S.color });
      });
      S.rappels.forEach(r => { if (!hit(r.chap + " " + r.titre) && hit(JSON.stringify(r))) out.push({ ico: "book", t: r.titre, sub: `Dans la fiche ${r.chap} · ${S.title}`, href: `#/${pid}/${S.id}/rappels`, chap: r.chap, c: S.color }); });
      S.flash.forEach(f => { if (hit(f[1] + " " + f[2])) out.push({ ico: "cards", t: U.plain(f[1]), sub: `Flashcard · ${f[0]} · ${S.title}`, href: `#/${pid}/${S.id}/flash`, chap: f[0], c: S.color }); });
      S.qcm.forEach(x => { if (hit(x[1])) out.push({ ico: "checklist", t: U.plain(x[1]), sub: `Question de QCM · ${x[0]} · ${S.title}`, href: `#/${pid}/${S.id}/qcm`, chap: x[0], c: S.color }); });
    });
    Store.get(`rev:${pid}:notes`, []).forEach(nt => {
      if (hit((nt.title || "") + " " + (nt.body || ""))) out.push({ ico: "note", t: nt.title || "Sans titre", sub: "Note · " + String(nt.body || "").replace(/\s+/g, " ").slice(0, 60), href: `#/${pid}/notes`, note: "p:" + nt.id });
    });
    if (window.Social) Social.visibleNotes(pid).forEach(nt => {
      if (hit((nt.title || "") + " " + (nt.body || ""))) out.push({ ico: "users", t: nt.title || "Sans titre", sub: "Note partagée", href: `#/${pid}/notes`, note: "s:" + Social.ref(nt) });
    });
    return out.slice(0, 60);
  }

  function open() {
    pid = App.current();
    if (!pid) return;
    close();
    const m = document.createElement("div");
    m.className = "modal pal-modal"; m.id = "palette";
    m.innerHTML = `<div class="dialog pal" role="dialog" aria-label="Rechercher">
      <label class="pal-input">${icon("search")}<input type="search" placeholder="Rechercher une page, un chapitre, une question, une note…" autocomplete="off" spellcheck="false"><kbd>Échap</kbd></label>
      <div class="pal-list" role="listbox"></div>
      <div class="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> choisir</span><span><kbd>Entrée</kbd> ouvrir</span><span><kbd>Ctrl</kbd><kbd>K</kbd> rechercher partout</span></div>
    </div>`;
    document.body.appendChild(m);
    const inp = $("input", m);
    inp.addEventListener("input", () => { list = search(inp.value); sel = 0; render(inp.value); });
    inp.addEventListener("keydown", e => {
      if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(list.length - 1, sel + 1); render(inp.value, true); }
      else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); render(inp.value, true); }
      else if (e.key === "Enter") { e.preventDefault(); go(list[sel]); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    });
    m.addEventListener("mousedown", e => { if (e.target === m) close(); });
    m.addEventListener("click", e => { const r = e.target.closest("[data-i]"); if (r) go(list[+r.dataset.i]); });
    list = search(""); sel = 0; render("");
    inp.focus();
    setTimeout(() => inp.focus(), 20);
  }
  function render(q, keep) {
    const box = $("#palette .pal-list");
    if (!box) return;
    box.innerHTML = list.length ? list.map((r, i) => `
      <div class="pal-row${i === sel ? " on" : ""}" data-i="${i}" role="option" aria-selected="${i === sel}" style="${r.c ? `--c:${r.c}` : ""}">
        <span class="pal-ico">${icon(r.ico)}</span><span class="pal-txt"><b>${esc(r.t.length > 110 ? r.t.slice(0, 110) + "…" : r.t)}</b><small>${esc(r.sub)}</small></span>
        ${i === sel ? `<span class="pal-go">${icon("arrow")}</span>` : ""}
      </div>`).join("") : `<p class="pal-empty">Aucun résultat pour « ${esc(q)} »</p>`;
    const on = box.querySelector(".on");
    if (on && keep) on.scrollIntoView({ block: "nearest" });
  }
  function go(r) {
    if (!r) return;
    close();
    if (r.note) Store.set(`rev:${pid}:notes:cur`, r.note);
    if (r.chap && r.href) { const m = r.href.split("/"); App.studyChapterAt(pid, m[2], m[3], r.chap); }
    else if (r.href) { if (location.hash === r.href) window.dispatchEvent(new HashChangeEvent("hashchange")); else location.hash = r.href; }
    if (r.run) r.run();
  }
  function close() { const m = document.getElementById("palette"); if (m) m.remove(); }

  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "k" || e.key === "K")) { e.preventDefault(); if (document.getElementById("palette")) close(); else open(); }
  }, true);

  return { open, close };
})();
