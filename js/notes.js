/* ------------------------------------------------------------------
   Notes personnelles (une liste par profil), enregistrées au fil de
   la frappe. Une note peut être rattachée à une matière.
   rev:<profil>:notes = [{ id, title, body, sid, pinned, created, updated }]
------------------------------------------------------------------- */
window.Notes = (function () {
  "use strict";
  const { $, esc, Store, icon } = U;
  let st = null;
  const key = pid => `rev:${pid}:notes`;
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function mount(el, ctx) {
    const pid = ctx.profile.id;
    const subs = SUBJECTS.filter(s => s.profile === pid);
    const wanted = App.takePendingNoteSubject();
    st = { el, ctx, pid, subs, notes: Store.get(key(pid), []), cur: null, filter: wanted || "all", q: "", timer: null };
    if (wanted) {
      const n = st.notes.filter(x => x.sid === wanted).sort((a, b) => b.updated - a.updated)[0];
      st.cur = n ? n.id : null;
    } else {
      const last = Store.get(`rev:${pid}:notes:cur`, null);
      st.cur = st.notes.some(n => n.id === last) ? last : (sorted()[0] || {}).id || null;
    }
    el.innerHTML = `
      <div class="mode notes-mode">
        <div class="toolbar">
          <h2 class="toolbar-title">${icon("note")}Mes notes</h2>
          <div class="toolbar-right">
            <label class="field"><span>Matière</span>
              <select class="note-filter">
                <option value="all">Toutes les notes</option>
                ${subs.map(s => `<option value="${esc(s.id)}">${esc(s.title)}</option>`).join("")}
                <option value="none">Sans matière</option>
              </select>
            </label>
          </div>
        </div>
        <div class="notes-wrap">
          <aside class="conv-panel">
            <button class="btn primary conv-new" data-act="new">${icon("plus")}Nouvelle note</button>
            <label class="conv-search">${icon("search")}<input type="search" placeholder="Rechercher dans mes notes…"></label>
            <div class="conv-list note-list"></div>
          </aside>
          <section class="note-editor"></section>
        </div>
      </div>`;
    $(".note-filter", el).value = st.filter;
    $(".note-filter", el).addEventListener("change", e => { st.filter = e.target.value; renderList(); });
    $(".conv-search input", el).addEventListener("input", e => { st.q = e.target.value.trim().toLowerCase(); renderList(); });
    el.addEventListener("click", onClick);
    el.addEventListener("input", onInput);
    el.addEventListener("change", onChange);
    renderList(); renderEditor();
  }

  function unmount() {
    if (!st) return;
    flush();
    st.el.removeEventListener("click", onClick);
    st.el.removeEventListener("input", onInput);
    st.el.removeEventListener("change", onChange);
    st = null;
  }

  const sorted = () => st.notes.slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updated - a.updated);
  const cur = () => st.notes.find(n => n.id === st.cur);
  const subjTitle = sid => (st.subs.find(s => s.id === sid) || {}).title || "";
  const excerpt = n => (n.body || "").replace(/\s+/g, " ").trim().slice(0, 70);
  const when = t => new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) + " · " + new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  function save() { Store.set(key(st.pid), st.notes); Store.set(`rev:${st.pid}:notes:cur`, st.cur); }
  function flush() { if (st && st.timer) { clearTimeout(st.timer); st.timer = null; save(); } }
  function saveSoon() {
    clearTimeout(st.timer);
    st.timer = setTimeout(() => { st.timer = null; save(); const s = $(".note-saved", st.el); if (s) s.textContent = "Enregistré"; }, 500);
    const s = $(".note-saved", st.el); if (s) s.textContent = "Enregistrement…";
  }

  function renderList() {
    const box = $(".note-list", st.el);
    const list = sorted().filter(n => st.filter === "all" || (st.filter === "none" ? !n.sid : n.sid === st.filter))
      .filter(n => !st.q || (n.title + " " + n.body).toLowerCase().includes(st.q));
    box.innerHTML = list.length ? list.map(n => `
      <div class="conv-item${n.id === st.cur ? " on" : ""}" data-act="open" data-id="${n.id}" role="button" tabindex="0">
        <span class="conv-ico">${icon(n.pinned ? "star" : "note")}</span>
        <span class="conv-txt"><b>${esc(n.title || "Sans titre")}</b>
          <small>${esc(n.sid ? subjTitle(n.sid) + " · " : "")}${esc(excerpt(n) || "Note vide")}</small></span>
      </div>`).join("") : `<p class="conv-empty">${st.q ? "Aucun résultat" : "Aucune note ici pour l'instant."}</p>`;
  }

  function renderEditor() {
    const box = $(".note-editor", st.el);
    const n = cur();
    if (!n) {
      box.innerHTML = `<div class="empty">${icon("note", "empty-ico")}<h3>Prends tes notes ici</h3>
        <p>Idées, questions pour le prof, points à revoir, méthodes… Tout est enregistré automatiquement sur ton ordinateur.</p>
        <button class="btn primary" data-act="new" style="margin-top:16px">${icon("plus")}Nouvelle note</button></div>`;
      return;
    }
    box.innerHTML = `
      <div class="note-head">
        <input class="note-title" type="text" placeholder="Titre de la note" maxlength="120" value="${esc(n.title)}">
        <div class="note-tools">
          <select class="note-subject" title="Matière">
            <option value="">Sans matière</option>
            ${st.subs.map(s => `<option value="${esc(s.id)}"${n.sid === s.id ? " selected" : ""}>${esc(s.title)}</option>`).join("")}
          </select>
          <button class="icon-btn${n.pinned ? " on" : ""}" data-act="pin" title="${n.pinned ? "Ne plus épingler" : "Épingler en haut"}">${icon("star")}</button>
          <button class="icon-btn" data-act="del" title="Supprimer la note">${icon("trash")}</button>
        </div>
      </div>
      <textarea class="note-body" placeholder="Écris ta note…">${esc(n.body)}</textarea>
      <div class="note-foot"><span class="note-saved">Enregistré</span><span>Modifiée le ${when(n.updated)}</span></div>`;
  }

  function onInput(e) {
    const n = cur(); if (!n) return;
    if (e.target.matches(".note-title")) n.title = e.target.value;
    else if (e.target.matches(".note-body")) n.body = e.target.value;
    else return;
    n.updated = Date.now();
    saveSoon();
    renderList();
  }
  function onChange(e) {
    const n = cur();
    if (n && e.target.matches(".note-subject")) { n.sid = e.target.value || null; n.updated = Date.now(); save(); renderList(); }
  }

  function onClick(e) {
    const t = e.target.closest("[data-act]");
    if (!t || !st) return;
    const a = t.dataset.act;
    if (a === "new") {
      flush();
      const sid = st.filter !== "all" && st.filter !== "none" ? st.filter : null;
      const n = { id: newId(), title: "", body: "", sid, pinned: false, created: Date.now(), updated: Date.now() };
      st.notes.push(n); st.cur = n.id; save();
      renderList(); renderEditor();
      $(".note-title", st.el).focus();
    } else if (a === "open") {
      flush(); st.cur = t.dataset.id; save(); renderList(); renderEditor();
    } else if (a === "pin") {
      const n = cur(); n.pinned = !n.pinned; save(); renderList(); renderEditor();
    } else if (a === "del") {
      const n = cur();
      if (!n || !confirm(`Supprimer la note « ${n.title || "Sans titre"} » ?`)) return;
      st.notes = st.notes.filter(x => x.id !== n.id);
      st.cur = (sorted()[0] || {}).id || null; save();
      renderList(); renderEditor();
      App.toast("Note supprimée");
    }
  }

  /* Notes reçues d'un autre ordinateur */
  function remote(pid, keys) {
    if (!st || st.pid !== pid || !keys.includes(key(pid)) || st.timer) return;   // en cours de frappe : notre version est la plus récente
    st.notes = Store.get(key(pid), []);
    if (!cur()) st.cur = (sorted()[0] || {}).id || null;
    renderList();
    const a = document.activeElement;
    const editing = a && st.el.contains(a) && a.matches(".note-title, .note-body");
    if (!editing) renderEditor();
  }

  const count = (pid, sid) => Store.get(key(pid), []).filter(n => !sid || n.sid === sid).length;

  return { mount, unmount, onKey: () => false, refresh() {}, remote, count };
})();
