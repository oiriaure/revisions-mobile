/* ------------------------------------------------------------------
   Notes : personnelles (une liste par profil) et partagées avec
   d'autres profils (invitation à accepter, voir social.js).
   rev:<profil>:notes = [{ id, title, body, sid, pinned, created, updated }]
   Enregistrement au fil de la frappe.
------------------------------------------------------------------- */
window.Notes = (function () {
  "use strict";
  const { $, $$, esc, Store, icon } = U;
  let st = null;
  const key = pid => `rev:${pid}:notes`;
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const profile = id => PROFILES.find(p => p.id === id);
  const fem = p => p && p.id === "angele";

  function mount(el, ctx) {
    const pid = ctx.profile.id;
    const subs = SUBJECTS.filter(s => s.profile === pid);
    const wanted = App.takePendingNoteSubject();
    const openShared = App.takePendingSharedNote ? App.takePendingSharedNote() : null;
    st = { el, ctx, pid, subs, notes: Store.get(key(pid), []), shared: [], cur: null, filter: wanted || "all", q: "", timer: null };
    loadShared();
    if (openShared) { st.cur = `s:${openShared.owner}/${openShared.id}`; st.filter = "all"; }
    else if (wanted) {
      const n = st.notes.filter(x => x.sid === wanted).sort((a, b) => b.updated - a.updated)[0];
      st.cur = n ? "p:" + n.id : null;
    } else {
      let last = Store.get(`rev:${pid}:notes:cur`, null);
      if (last && !/^[ps]:/.test(last)) last = "p:" + last;
      st.cur = all().some(n => n.ref === last) ? last : (sorted()[0] || {}).ref || null;
    }
    el.innerHTML = `
      <div class="mode notes-mode">
        <div class="toolbar">
          <h2 class="toolbar-title">${icon("note")}Mes notes</h2>
          <div class="toolbar-right">
            <label class="field"><span>Afficher</span>
              <select class="note-filter">
                <option value="all">Toutes les notes</option>
                <option value="shared">Partagées</option>
                ${subs.map(s => `<option value="${esc(s.id)}">${esc(s.title)}</option>`).join("")}
                <option value="none">Sans matière</option>
              </select>
            </label>
          </div>
        </div>
        <div class="notes-wrap">
          <aside class="conv-panel">
            <div class="note-invites"></div>
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
    renderInvites(); renderList(); renderEditor();
  }

  function unmount() {
    if (!st) return;
    flush();
    st.el.removeEventListener("click", onClick);
    st.el.removeEventListener("input", onInput);
    st.el.removeEventListener("change", onChange);
    closeDialog();
    st = null;
  }

  /* Toutes les notes visibles : personnelles + partagées */
  function loadShared() { st.shared = Social.visibleNotes(st.pid).map(n => Object.assign(n, { src: "s", ref: "s:" + Social.ref(n) })); }
  const all = () => st.notes.map(n => Object.assign(n, { src: "p", ref: "p:" + n.id })).concat(st.shared);
  const sorted = () => all().slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updated - a.updated);
  const cur = () => all().find(n => n.ref === st.cur);
  const subjTitle = sid => (SUBJECTS.find(s => s.id === sid) || {}).title || "";
  const excerpt = n => (n.body || "").replace(/\s+/g, " ").trim().slice(0, 70);
  const when = t => new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) + " · " + new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const clean = n => { const o = Object.assign({}, n); delete o.src; delete o.ref; return o; };

  function savePersonal() { Store.set(key(st.pid), st.notes.map(clean)); }
  function save() {
    const n = cur();
    if (n && n.src === "s") Social.saveShared(clean(n), st.pid); else savePersonal();
    Store.set(`rev:${st.pid}:notes:cur`, st.cur);
  }
  function flush() { if (st && st.timer) { clearTimeout(st.timer); st.timer = null; save(); } }
  function saveSoon() {
    clearTimeout(st.timer);
    st.timer = setTimeout(() => { st.timer = null; save(); const s = $(".note-saved", st.el); if (s) s.textContent = "Enregistré"; }, 500);
    const s = $(".note-saved", st.el); if (s) s.textContent = "Enregistrement…";
  }

  function renderInvites() {
    const box = $(".note-invites", st.el);
    const inv = Social.invitesFor(st.pid);
    box.innerHTML = inv.map(n => {
      const p = profile(n.owner);
      return `<div class="note-invite">
        ${p ? Social.avatar(p, "xs") : ""}
        <span><b>${esc(p ? p.name : "")} veut partager une note</b><small>« ${esc(n.title || "Sans titre")} »</small>
          <span class="ib-actions"><button class="btn primary small" data-share-resp="accepted" data-owner="${n.owner}" data-nid="${n.id}">Accepter</button>
          <button class="btn small" data-share-resp="declined" data-owner="${n.owner}" data-nid="${n.id}">Refuser</button></span></span>
      </div>`;
    }).join("");
  }

  function membersOf(n) { return [n.owner].concat(n.members || []).filter((m, i, a) => a.indexOf(m) === i); }

  function renderList() {
    const box = $(".note-list", st.el);
    const list = sorted().filter(n => st.filter === "all" || (st.filter === "shared" ? n.src === "s" : st.filter === "none" ? !n.sid : n.sid === st.filter))
      .filter(n => !st.q || ((n.title || "") + " " + (n.body || "")).toLowerCase().includes(st.q));
    box.innerHTML = list.length ? list.map(n => {
      const others = n.src === "s" ? membersOf(n).filter(m => m !== st.pid).map(profile).filter(Boolean) : [];
      return `<div class="conv-item${n.ref === st.cur ? " on" : ""}" data-act="open" data-ref="${esc(n.ref)}" role="button" tabindex="0">
        <span class="conv-ico">${icon(n.pinned ? "star" : n.src === "s" ? "users" : "note")}</span>
        <span class="conv-txt"><b>${esc(n.title || "Sans titre")}</b>
          <small>${esc(n.sid && subjTitle(n.sid) ? subjTitle(n.sid) + " · " : "")}${esc(excerpt(n) || "Note vide")}</small></span>
        ${others.length ? `<span class="mini-people">${others.map(p => Social.presenceAvatar(p, "xxs")).join("")}</span>` : ""}
      </div>`;
    }).join("") : `<p class="conv-empty">${st.q ? "Aucun résultat" : st.filter === "shared" ? "Aucune note partagée. Ouvre une note puis « Partager »." : "Aucune note ici pour l'instant."}</p>`;
  }

  function shareBar(n) {
    if (n.src !== "s") return "";
    const people = membersOf(n).filter(m => m !== st.pid).map(profile).filter(Boolean);
    return `<div class="note-share-bar">
      <span class="nsb-lbl">${icon("users")}${n.owner === st.pid ? "Partagée avec" : "Note partagée par"}</span>
      ${people.map(p => {
        const status = p.id === n.owner ? "owner" : Social.statusOf(n, p.id);
        const pres = Social.presence(p.id);
        const typing = n.by === p.id && Date.now() - (n.updated || 0) < 25000;
        const txt = typing ? "écrit…" : status === "pending" ? "invitation envoyée" : status === "declined" ? "a refusé" : status === "left" ? "a quitté" : pres.online ? "en ligne" : pres.at ? "vu" + (fem(p) ? "e " : " ") + Social.ago(pres.at) : "hors ligne";
        if (typing) setTimeout(() => { const b = st && $(".note-share-bar", st.el); const c = st && cur(); if (b && c && c.ref === n.ref) b.outerHTML = shareBar(c); }, 25500);
        return `<span class="nsb-person ${status}${typing ? " is-typing" : ""}"><span class="pres${pres.online ? " on" : ""}" data-live="${p.id}" title="${esc(Social.presenceText(p))}">${Social.avatar(p, "xs")}<i></i></span><span><b>${esc(p.name)}</b><small class="pres-txt">${esc(txt)}</small></span></span>`;
      }).join("")}
    </div>`;
  }

  function renderEditor() {
    const box = $(".note-editor", st.el);
    const n = cur();
    if (!n) {
      box.innerHTML = `<div class="empty">${icon("note", "empty-ico")}<h3>Prends tes notes ici</h3>
        <p>Idées, questions pour le prof, points à revoir, méthodes… Tout est enregistré automatiquement. Tu peux aussi partager une note avec un autre profil.</p>
        <button class="btn primary" data-act="new" style="margin-top:16px">${icon("plus")}Nouvelle note</button></div>`;
      return;
    }
    const owner = n.src !== "s" || n.owner === st.pid;
    const subs = owner ? st.subs : SUBJECTS.filter(s => s.profile === n.owner);
    const by = n.src === "s" && n.by && n.by !== st.pid ? profile(n.by) : null;
    box.innerHTML = `
      ${shareBar(n)}
      <div class="note-head">
        <input class="note-title" type="text" placeholder="Titre de la note" maxlength="120" value="${esc(n.title)}">
        <div class="note-tools">
          <select class="note-subject" title="Matière"${owner ? "" : " disabled"}>
            <option value="">Sans matière</option>
            ${subs.map(s => `<option value="${esc(s.id)}"${n.sid === s.id ? " selected" : ""}>${esc(s.title)}</option>`).join("")}
          </select>
          ${PROFILES.length > 1 ? `<button class="icon-btn${n.src === "s" ? " on" : ""}" data-act="share" title="${owner ? "Partager avec un autre profil" : "Quitter le partage"}">${icon(owner ? "share" : "x")}</button>` : ""}
          <button class="icon-btn" data-act="copy" title="Copier le texte">${icon("copy")}</button>
          <button class="icon-btn" data-act="export" title="Enregistrer en fichier texte">${icon("download")}</button>
          ${n.src === "s" ? "" : `<button class="icon-btn${n.pinned ? " on" : ""}" data-act="pin" title="${n.pinned ? "Ne plus épingler" : "Épingler en haut"}">${icon("star")}</button>`}
          ${owner ? `<button class="icon-btn" data-act="del" title="Supprimer la note">${icon("trash")}</button>` : ""}
        </div>
      </div>
      <textarea class="note-body" placeholder="Écris ta note…">${esc(n.body)}</textarea>
      <div class="note-foot"><span class="note-saved">Enregistré</span><span class="note-count">${words(n.body)}</span><span>${by ? `Modifiée par ${esc(by.name)} le ` : "Modifiée le "}${when(n.updated)}</span></div>`;
  }
  const words = s => { const n = String(s || "").trim().split(/\s+/).filter(Boolean).length; return n ? `${n} mot${n > 1 ? "s" : ""}` : ""; };

  function onInput(e) {
    const n = cur(); if (!n) return;
    if (e.target.matches(".note-title")) n.title = e.target.value;
    else if (e.target.matches(".note-body")) { n.body = e.target.value; const c = $(".note-count", st.el); if (c) c.textContent = words(n.body); }
    else return;
    n.updated = Date.now();
    if (n.src === "s") n.by = st.pid;
    saveSoon();
    renderList();
  }
  function onChange(e) {
    const n = cur();
    if (n && e.target.matches(".note-subject")) { n.sid = e.target.value || null; n.updated = Date.now(); save(); renderList(); }
  }

  function onClick(e) {
    const r = e.target.closest("[data-share-resp]");
    if (r && st) {
      Social.respond(st.pid, r.dataset.owner, r.dataset.nid, r.dataset.shareResp);
      loadShared();
      if (r.dataset.shareResp === "accepted") { st.cur = `s:${r.dataset.owner}/${r.dataset.nid}`; App.toast("Note partagée ajoutée"); }
      else App.toast("Invitation refusée");
      renderInvites(); renderList(); renderEditor(); App.refreshTitlebar();
      return;
    }
    const t = e.target.closest("[data-act]");
    if (!t || !st) return;
    const a = t.dataset.act;
    if (a === "new") {
      flush();
      const sid = !["all", "none", "shared"].includes(st.filter) ? st.filter : null;
      const n = { id: newId(), title: "", body: "", sid, pinned: false, created: Date.now(), updated: Date.now() };
      st.notes.push(n); st.cur = "p:" + n.id; if (st.filter === "shared") { st.filter = "all"; $(".note-filter", st.el).value = "all"; }
      save();
      renderList(); renderEditor();
      $(".note-title", st.el).focus();
    } else if (a === "open") {
      flush(); st.cur = t.dataset.ref; Store.set(`rev:${st.pid}:notes:cur`, st.cur); renderList(); renderEditor();
      if (window.MOBILE) { const ed = $(".note-editor", st.el); if (ed) ed.scrollIntoView({ behavior: "smooth", block: "start" }); }
    } else if (a === "pin") {
      const n = cur(); n.pinned = !n.pinned; save(); renderList(); renderEditor();
    } else if (a === "copy") {
      const n = cur(); if (!n || !navigator.clipboard) return;
      navigator.clipboard.writeText((n.title ? n.title + "\n\n" : "") + (n.body || "")).then(() => App.toast("Note copiée"));
    } else if (a === "export") {
      const n = cur(); if (!n) return;
      const url = URL.createObjectURL(new Blob([(n.title ? n.title + "\r\n\r\n" : "") + (n.body || "").replace(/\r?\n/g, "\r\n")], { type: "text/plain;charset=utf-8" }));
      const l = document.createElement("a");
      l.href = url; l.download = (n.title || "Note").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 60) + ".txt";
      document.body.appendChild(l); l.click(); l.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      App.toast("Note enregistrée en fichier texte");
    } else if (a === "share") {
      const n = cur(); if (!n) return;
      flush();
      if (n.src === "s" && n.owner !== st.pid) leave(n); else shareDialog(n);
    } else if (a === "del") {
      const n = cur();
      if (!n) return;
      const shared = n.src === "s";
      const go = () => {
        if (shared) { Store.del(Social.snoteKey(n.owner, n.id)); loadShared(); }
        else { st.notes = st.notes.filter(x => x.id !== n.id); savePersonal(); }
        st.cur = (sorted()[0] || {}).ref || null; Store.set(`rev:${st.pid}:notes:cur`, st.cur);
        renderList(); renderEditor();
      };
      if (shared) {
        App.ask("Elle disparaîtra aussi chez les personnes avec qui elle est partagée.", { title: `Supprimer « ${n.title || "Sans titre"} » ?`, ok: "Supprimer", danger: true })
          .then(ok => { if (ok && st) { go(); App.toast("Note supprimée"); } });
      } else {
        /* suppression immédiate, annulable quelques secondes */
        const copy = clean(n);
        go();
        App.toast("Note supprimée", { label: "Annuler", action: () => {
          if (!st) return;
          st.notes.push(copy); savePersonal(); st.cur = "p:" + copy.id; save(); renderList(); renderEditor();
        } });
      }
    }
  }

  async function leave(n) {
    const p = profile(n.owner);
    if (!await App.ask("Elle disparaîtra de tes notes. Tu pourras être réinvité" + (fem(profile(st.pid)) ? "e" : "") + " plus tard.", { title: `Quitter la note de ${p ? p.name : ""} ?`, ok: "Quitter", danger: true }) || !st) return;
    Social.respond(st.pid, n.owner, n.id, "left");
    loadShared();
    st.cur = (sorted()[0] || {}).ref || null;
    renderList(); renderEditor(); App.refreshTitlebar();
    App.toast("Tu as quitté la note partagée");
  }

  /* ---------- Partager une note ---------- */
  function stopShare(n) {
    const p = clean(n); delete p.members; delete p.owner; delete p.by; delete p.shared;
    st.notes.push(p); savePersonal();
    Store.del(Social.snoteKey(n.owner, n.id));
    loadShared(); st.cur = "p:" + p.id; Store.set(`rev:${st.pid}:notes:cur`, st.cur);
    renderList(); renderEditor(); App.refreshTitlebar();
    App.toast("Partage arrêté");
  }
  function closeDialog() { const m = document.getElementById("share-dlg"); if (m) m.remove(); }
  function shareDialog(n) {
    closeDialog();
    const others = PROFILES.filter(p => p.id !== st.pid);
    const members = n.src === "s" ? (n.members || []) : [];
    const m = document.createElement("div");
    m.className = "modal"; m.id = "share-dlg";
    m.innerHTML = `<div class="dialog share-dialog" role="dialog">
      <div class="dialog-head"><h2>${icon("share")}Partager la note</h2></div>
      <div class="dialog-body">
        <p class="share-intro">Choisis avec qui partager « ${esc(n.title || "Sans titre")} ». La personne reçoit une invitation et doit l'accepter. Vous pourrez ensuite écrire tous les deux dans cette note, en direct.</p>
        <div class="share-list">${others.map(p => {
          const s = members.includes(p.id) ? Social.statusOf(n, p.id) : null;
          const lbl = { pending: "Invitation envoyée", accepted: "A accepté", declined: "A refusé", left: "A quitté la note" }[s] || "";
          return `<label class="share-person">
            <input type="checkbox" value="${p.id}"${members.includes(p.id) ? " checked" : ""}>
            <span class="pres${Social.presence(p.id).online ? " on" : ""}">${Social.avatar(p, "sm")}<i></i></span>
            <span class="sp-txt"><b>${esc(p.name)}</b><small>${esc(lbl || Social.presenceText(p).split(" · ")[1])}</small></span>
            ${s === "declined" || s === "left" ? `<button type="button" class="chip-btn" data-reinvite="${p.id}">Réinviter</button>` : ""}
          </label>`;
        }).join("")}</div>
        ${window.Sync && Sync.enabled() ? "" : `<p class="share-warn">${icon("x")}La synchronisation n'est pas active sur cet appareil : l'invitation partira dès qu'elle le sera.</p>`}
      </div>
      <div class="dialog-foot">
        ${n.src === "s" ? `<button class="btn danger" data-sh="stop">Arrêter le partage</button>` : ""}
        <span class="spacer"></span>
        <button class="btn" data-sh="cancel">Annuler</button>
        <button class="btn primary" data-sh="ok">${icon("send")}${n.src === "s" ? "Enregistrer" : "Inviter"}</button>
      </div></div>`;
    document.body.appendChild(m);
    m.addEventListener("mousedown", e => { if (e.target === m) closeDialog(); });
    m.addEventListener("click", e => {
      const ri = e.target.closest("[data-reinvite]");
      if (ri) {
        /* on efface la réponse précédente : l'invitation repart */
        Social.reinvite(ri.dataset.reinvite, n.owner, n.id);
        App.toast("Nouvelle invitation envoyée");
        closeDialog(); loadShared(); renderEditor();
        return;
      }
      const b = e.target.closest("[data-sh]");
      if (!b) return;
      const act = b.dataset.sh;
      if (act === "cancel") { closeDialog(); return; }
      if (act === "stop") {
        closeDialog();
        App.ask("La note redevient personnelle et disparaît chez les autres.", { title: "Arrêter le partage ?", ok: "Arrêter le partage", danger: true }).then(ok => { if (ok && st) stopShare(n); });
        return;
      }
      const sel = $$("input[type=checkbox]", m).filter(c => c.checked).map(c => c.value);
      if (!sel.length && n.src !== "s") { App.toast("Choisis au moins un profil"); return; }
      if (!sel.length) { m.querySelector("[data-sh=stop]").click(); return; }
      const sn = Object.assign(clean(n), { owner: st.pid, members: sel, updated: Date.now(), by: st.pid, shared: n.shared || Date.now() });
      delete sn.pinned;
      if (n.src !== "s") { st.notes = st.notes.filter(x => x.id !== n.id); savePersonal(); }
      Social.saveShared(sn, st.pid);
      if (window.Sync) Sync.soon(true);
      loadShared(); st.cur = "s:" + st.pid + "/" + n.id; Store.set(`rev:${st.pid}:notes:cur`, st.cur);
      closeDialog(); renderList(); renderEditor();
      const names = sel.map(id => (profile(id) || {}).name).join(" et ");
      App.toast(n.src === "s" ? "Partage mis à jour" : `Invitation envoyée à ${names}`);
    });
  }

  /* Notes reçues d'un autre appareil (personnelles ou partagées) */
  function remote(pid, keys) {
    if (!st || !keys) return;
    const mineChanged = pid === st.pid && keys.includes(key(pid));
    const sharedChanged = keys.some(k => /:snote:|:sresp$/.test(k));
    if (!mineChanged && !sharedChanged) return;
    if (st.timer) return;   // en cours de frappe : notre version est la plus récente
    if (mineChanged) st.notes = Store.get(key(st.pid), []);
    loadShared();
    if (!cur()) st.cur = (sorted()[0] || {}).ref || null;
    renderInvites();
    renderList();
    const a = document.activeElement;
    const editing = a && st.el.contains(a) && a.matches(".note-title, .note-body");
    if (!editing) renderEditor();
    else {
      /* texte reçu pendant qu'on est dans la note (sans taper) : on met à jour sans perdre le curseur */
      const n = cur();
      if (n && a.matches(".note-body") && a.value !== n.body) { const p = a.selectionStart; a.value = n.body; a.selectionStart = a.selectionEnd = Math.min(p, a.value.length); }
      const bar = $(".note-share-bar", st.el); if (bar && n) bar.outerHTML = shareBar(n);
    }
  }

  const count = (pid, sid) => Store.get(key(pid), []).filter(n => !sid || n.sid === sid).length;

  return { mount, unmount, onKey: () => false, refresh() {}, remote, count };
})();
