/* ------------------------------------------------------------------
   Social : centre de notifications, présence « en ligne » et notes
   partagées entre profils.
   - rev:inbox                     notifications reçues sur cet appareil
   - rev:<propriétaire>:snote:<id> note partagée { id, title, body, sid,
                                   owner, members:[profils], created, updated, by }
   - rev:<profil>:sresp            réponses aux invitations
                                   { "<propriétaire>/<id>": "accepted" | "declined" | "left" }
   Les notes partagées et les réponses sont synchronisées comme le reste.
------------------------------------------------------------------- */
window.Social = (function () {
  "use strict";
  const { $, esc, Store, icon } = U;
  const BOOT = Date.now();
  const INBOX = "rev:inbox";
  const profile = id => PROFILES.find(p => p.id === id);
  const avatar = (p, cls = "") => `<span class="avatar ${cls}" style="--pc:${p.color}">${
    p.photo ? `<img src="${esc(p.photo)}" alt="">` : esc(p.name.charAt(0))}</span>`;
  const ago = t => {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 45) return "à l'instant";
    const m = Math.round(s / 60);
    if (m < 60) return `il y a ${m} min`;
    if (m < 1440) return `il y a ${Math.round(m / 60)} h`;
    const d = Math.round(m / 1440);
    return d === 1 ? "hier" : d < 7 ? `il y a ${d} jours` : new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  };

  /* ================= Notes partagées ================= */
  const snoteKey = (owner, id) => `rev:${owner}:snote:${id}`;
  const respKey = pid => `rev:${pid}:sresp`;
  const ref = n => `${n.owner}/${n.id}`;
  function allShared() {
    const out = [];
    PROFILES.forEach(p => Store.keys(`rev:${p.id}:snote:`).forEach(k => {
      const n = Store.get(k, null);
      if (n && n.id && !n.deleted) out.push(Object.assign({}, n, { owner: p.id }));
    }));
    return out;
  }
  const responses = pid => Store.get(respKey(pid), {});
  function statusOf(n, pid) {
    if (n.owner === pid) return "owner";
    if (!(n.members || []).includes(pid)) return null;
    return responses(pid)[ref(n)] || "pending";
  }
  const visibleNotes = pid => allShared().filter(n => ["owner", "accepted"].includes(statusOf(n, pid)));
  const invitesFor = pid => allShared().filter(n => statusOf(n, pid) === "pending");
  function respond(pid, owner, id, val) {
    const r = responses(pid);
    r[`${owner}/${id}`] = val;
    Store.set(respKey(pid), r);
    if (window.Sync) Sync.soon(true);
  }
  function reinvite(pid, owner, id) {
    const r = responses(pid);
    delete r[`${owner}/${id}`];
    Store.set(respKey(pid), r);
    items = items.filter(x => x.id !== `inv:${pid}:${owner}/${id}` && !x.id.endsWith(`:${pid}:${owner}/${id}`));
    saveInbox();
    if (window.Sync) Sync.soon(true);
  }
  function saveShared(n, by) {
    const o = Object.assign({}, n);
    delete o.src; delete o.shared;
    o.by = by || o.by;
    Store.set(snoteKey(n.owner, n.id), o);
  }
  /* Profils avec qui l'on partage au moins une note (invitation acceptée) */
  function partners(pid) {
    const set = new Set();
    allShared().forEach(n => {
      const acc = (n.members || []).filter(m => responses(m)[ref(n)] === "accepted");
      if (n.owner === pid) acc.forEach(m => set.add(m));
      else if (acc.includes(pid)) { set.add(n.owner); acc.forEach(m => m !== pid && set.add(m)); }
    });
    set.delete(pid);
    return PROFILES.filter(p => set.has(p.id));
  }

  /* ================= Présence ================= */
  function presence(pid) {
    if (!window.Sync || !Sync.enabled()) return { online: false, at: 0 };
    return Sync.presence(pid);
  }
  function presenceText(p) {
    const s = presence(p.id);
    if (s.online) return `${p.name} · en ligne${s.platform ? " sur " + s.platform : ""}`;
    return s.at ? `${p.name} · vu${p.id === "angele" ? "e" : ""} ${ago(s.at)}` : `${p.name} · hors ligne`;
  }
  const presenceAvatar = (p, cls = "xs") =>
    `<span class="pres${presence(p.id).online ? " on" : ""}" title="${esc(presenceText(p))}">${avatar(p, cls)}<i></i></span>`;

  /* ================= Centre de notifications ================= */
  let items = Store.get(INBOX, []);
  const saveInbox = () => Store.set(INBOX, items.slice(0, 200));
  let viewer = null;          // profil ouvert
  let onNav = null;
  const mine = () => items.filter(x => viewer && x.from !== viewer && (!x.to || x.to === viewer));

  /* Ajoute une notification ; renvoie true si elle mérite une bulle (arrivée pendant que l'app est ouverte) */
  function add(it) {
    if (items.some(x => x.id === it.id)) return false;
    const o = Object.assign({ t: Date.now(), read: false }, it);
    items.unshift(o);
    items.sort((a, b) => b.t - a.t);
    saveInbox();
    badge();
    return o.t >= BOOT - 30000;
  }
  /* QCM terminé par un profil : une notification pour les autres */
  function qcmItem(pid, ev) {
    const p = profile(pid);
    if (!p || !ev || ev.type !== "qcm") return false;
    return add({ id: "qcm:" + ev.id, kind: "qcm", from: pid, t: ev.t, grade: ev.n20, read: ev.t < BOOT - 60000,
      title: `${p.name} a terminé un QCM`, text: `${ev.title || ""}${ev.chap && ev.chap !== "all" ? " · " + ev.chap : ""} · ${ev.n} questions` });
  }
  function markAll() { mine().forEach(x => { x.read = true; }); saveInbox(); badge(); }

  /* Invitations et réponses : on les transforme en notifications */
  function scan(popup) {
    allShared().forEach(n => {
      (n.members || []).forEach(m => {
        const st = responses(m)[ref(n)];
        if (!st) {
          const fresh = add({ id: "inv:" + m + ":" + ref(n), kind: "invite", from: n.owner, to: m, t: n.shared || n.updated || Date.now(),
            title: `${(profile(n.owner) || {}).name} veut partager une note avec toi`, text: `« ${n.title || "Sans titre"} »`, owner: n.owner, nid: n.id });
          if (fresh && popup && viewer === m) popup({ from: n.owner, title: `${(profile(n.owner) || {}).name} veut partager une note avec toi`, text: `« ${n.title || "Sans titre"} » · Ouvre tes notifications pour accepter` });
        } else if (st === "accepted" || st === "declined") {
          const fresh = add({ id: `${st}:${m}:${ref(n)}`, kind: st, from: m, to: n.owner, t: Date.now(),
            title: `${(profile(m) || {}).name} a ${st === "accepted" ? "accepté" : "refusé"} ton partage`, text: `« ${n.title || "Sans titre"} »`, href: `#/${n.owner}/notes` });
          if (fresh && popup && viewer === n.owner) popup({ from: m, title: `${(profile(m) || {}).name} a ${st === "accepted" ? "accepté" : "refusé"} ton partage`, text: `« ${n.title || "Sans titre"} »` });
        }
      });
    });
  }

  function badge() {
    const b = document.getElementById("tb-bell-n");
    if (!b) return;
    const n = mine().filter(x => !x.read).length;
    b.textContent = n > 9 ? "9+" : n;
    b.hidden = !n;
    if (window.App && App.unreadTitle) App.unreadTitle();
  }

  /* Droite de la barre de titre : personnes liées (présence) + cloche */
  function titlebarHTML(pid) {
    viewer = pid;
    scan(null);
    const ps = partners(pid);
    return `<div class="tb-right">
      ${ps.length ? `<div class="tb-people">${ps.map(p => presenceAvatar(p)).join("")}</div>` : ""}
      <button class="tb-btn tb-search" data-app="palette" title="Rechercher (Ctrl + K)" aria-label="Rechercher">${icon("search")}</button>
      <button class="tb-btn tb-bell" data-app="inbox" title="Notifications" aria-label="Notifications">${icon("bell")}<b id="tb-bell-n" hidden></b></button>
    </div>`;
  }
  function refreshPeople() {
    const box = document.querySelector(".tb-people");
    if (box && viewer) box.innerHTML = partners(viewer).map(p => presenceAvatar(p)).join("");
    $$(".pres[data-live]").forEach(el => {
      const p = profile(el.dataset.live); if (!p) return;
      el.classList.toggle("on", presence(p.id).online); el.title = presenceText(p);
      const t = el.parentElement && el.parentElement.querySelector(".pres-txt"); if (t) t.textContent = presenceText(p).split(" · ")[1];
    });
  }
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* Menu déroulant */
  function openInbox(btn) {
    let pop = document.getElementById("inbox-pop");
    if (pop) { closeInbox(); return; }
    pop = document.createElement("div");
    pop.id = "inbox-pop";
    pop.className = "pop";
    document.body.appendChild(pop);
    const r = btn.getBoundingClientRect();
    pop.style.top = Math.round(r.bottom + 8) + "px";
    pop.style.right = Math.max(10, Math.round(innerWidth - r.right - 6)) + "px";
    renderInbox();
    markAll();          // la pastille disparaît ; les nouveautés restent surlignées jusqu'à la fermeture
    btn.classList.add("open");
    setTimeout(() => document.addEventListener("mousedown", outside, true), 0);
  }
  function outside(e) { const p = document.getElementById("inbox-pop"); if (p && !p.contains(e.target) && !e.target.closest(".tb-bell")) closeInbox(); }
  function closeInbox() {
    const p = document.getElementById("inbox-pop");
    if (!p) return;
    p.remove();
    document.removeEventListener("mousedown", outside, true);
    const b = document.querySelector(".tb-bell.open"); if (b) b.classList.remove("open");
    markAll();
  }
  function renderInbox() {
    const pop = document.getElementById("inbox-pop");
    if (!pop) return;
    const list = mine().slice(0, 60);
    const inv = viewer ? invitesFor(viewer) : [];
    const invHTML = inv.map(n => {
      const p = profile(n.owner);
      return `<div class="ib-item invite">
        ${p ? avatar(p, "xs") : ""}
        <span class="ib-txt"><b>${esc(p ? p.name : "")} veut partager une note avec toi</b><small>« ${esc(n.title || "Sans titre")} »</small>
          <span class="ib-actions"><button class="btn primary small" data-share-resp="accepted" data-owner="${n.owner}" data-nid="${n.id}">Accepter</button><button class="btn small" data-share-resp="declined" data-owner="${n.owner}" data-nid="${n.id}">Refuser</button></span></span>
      </div>`;
    }).join("");
    pop.innerHTML = `
      <div class="pop-head"><b>Notifications</b>${list.length ? `<button class="chip-btn" data-ib="clear">Tout effacer</button>` : ""}</div>
      <div class="pop-body">
        ${invHTML}
        ${list.filter(x => x.kind !== "invite").map(x => {
          const p = profile(x.from);
          const href = x.kind === "qcm" ? `#/${viewer}/history` : x.href;
          return `<a class="ib-item${x.read ? "" : " unread"}" ${href ? `href="${esc(href)}"` : ""} data-ib-open="${esc(x.id)}">
            ${p ? avatar(p, "xs") : `<span class="notice-ico">${icon(x.ico || "bell")}</span>`}
            <span class="ib-txt"><b>${esc(x.title)}</b><small>${esc(x.text || "")}</small><em>${ago(x.t)}</em></span>
            ${x.grade != null ? `<span class="grade-chip ${x.grade >= 15 ? "ok" : x.grade >= 10 ? "part" : "ko"}">${String(x.grade).replace(".", ",")}<small>/20</small></span>` : ""}
          </a>`;
        }).join("")}
        ${!inv.length && !list.filter(x => x.kind !== "invite").length ? `<div class="ib-empty">${icon("bell")}<b>Aucune notification</b><small>Les QCM terminés par les autres profils et les invitations à partager une note apparaîtront ici.</small></div>` : ""}
      </div>`;
  }
  function onClick(e) {
    const r = e.target.closest("[data-share-resp]");
    if (r && viewer) {
      respond(viewer, r.dataset.owner, r.dataset.nid, r.dataset.shareResp);
      items = items.filter(x => x.id !== `inv:${viewer}:${r.dataset.owner}/${r.dataset.nid}`); saveInbox();
      if (window.App) App.toast(r.dataset.shareResp === "accepted" ? "Note partagée ajoutée à tes notes" : "Invitation refusée");
      renderInbox(); refreshPeople(); badge();
      if (r.dataset.shareResp === "accepted" && onNav) { closeInbox(); onNav(`#/${viewer}/notes`, { owner: r.dataset.owner, id: r.dataset.nid }); }
      else if (onNav) onNav(null);
      return;
    }
    if (e.target.closest("[data-ib=clear]")) { const keep = items.filter(x => !mine().includes(x)); items = keep; saveInbox(); renderInbox(); badge(); return; }
    if (e.target.closest("[data-ib-open]")) closeInbox();
  }
  document.addEventListener("click", e => { if (e.target.closest("#inbox-pop")) onClick(e); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeInbox(); });
  setInterval(refreshPeople, 20000);

  return {
    add, qcmItem, scan, badge, titlebarHTML, refreshPeople, openInbox, closeInbox, renderInbox, setNav: f => { onNav = f; },
    allShared, visibleNotes, invitesFor, respond, reinvite, saveShared, statusOf, partners, responses, snoteKey, ref,
    presence, presenceText, presenceAvatar, avatar, ago, BOOT
  };
})();
