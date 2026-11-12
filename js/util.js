/* Petits utilitaires partagés */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* Formules mathématiques : $…$ (dans le texte) et $$…$$ (centrée), écrites comme sur une feuille (KaTeX) */
  const MATH = /\$\$([^$]+?)\$\$|\$(?=\S)([^$\n]+?)(?<=\S)\$(?!\d)/g;
  function tex(src, display) {
    if (!window.katex) return `<span class="math-raw">${esc(src)}</span>`;
    try {
      return katex.renderToString(src, { displayMode: display, throwOnError: false, strict: "ignore", output: "html",
        macros: { "\\Req": "R_{\\text{éq}}", "\\ohm": "\\,\\Omega" } });
    } catch (e) { return `<span class="math-raw">${esc(src)}</span>`; }
  }
  /* Découpe le texte : les formules sont rendues, le reste passe par fmt (échappé) */
  function withMath(s, fmt) {
    s = String(s == null ? "" : s);
    let out = "", last = 0, m;
    MATH.lastIndex = 0;
    while ((m = MATH.exec(s))) {
      out += fmt(s.slice(last, m.index));
      out += m[1] != null ? `<span class="math-block">${tex(m[1].trim(), true)}</span>` : tex(m[2], false);
      last = MATH.lastIndex;
    }
    return out + fmt(s.slice(last));
  }

  /* Texte enrichi minimal : **gras**, *italique*, retours à la ligne, formules */
  const richText = s => esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/\n/g, "<br>");
  const rich = s => {
    s = String(s == null ? "" : s);
    if (!s.includes("$")) return richText(s);
    /* le gras peut entourer une formule : on le traite à part */
    return s.split(/(\*\*[^*]+?\*\*)/g).map(part => {
      const b = part.match(/^\*\*([^*]+)\*\*$/);
      return b ? `<strong>${withMath(b[1], richText)}</strong>` : withMath(part, richText);
    }).join("");
  };
  /* Version texte (pour l'assistant ou les recherches) */
  const plain = s => String(s == null ? "" : s).replace(/\*\*/g, "");

  /* Sauvegarde : base de données locale (fichier sur l'ordinateur, via l'application),
     sinon stockage du navigateur. Le cache des cours reste dans le navigateur (volumineux). */
  const DB = window.appDB || null;
  let mem = null;
  if (DB) { try { mem = DB.load() || {}; } catch (e) { mem = null; } }
  const LOCAL_ONLY = k => k === "rev:content";
  if (mem && !mem.__migrated) {
    /* Première ouverture : on reprend tout ce qui était déjà enregistré */
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("rev:") && !LOCAL_ONLY(k) && mem[k] === undefined) { mem[k] = localStorage.getItem(k); DB.set(k, mem[k]); }
      }
    } catch (e) { /* rien à reprendre */ }
    mem.__migrated = "1"; DB.set("__migrated", "1");
  }
  const listeners = [];
  const raw = k => (mem && !LOCAL_ONLY(k)) ? (mem[k] === undefined ? null : mem[k]) : localStorage.getItem(k);
  const Store = {
    get(k, d) { try { const v = raw(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) {
      try {
        const s = JSON.stringify(v);
        if (mem && !LOCAL_ONLY(k)) { mem[k] = s; DB.set(k, s); } else localStorage.setItem(k, s);
      } catch (e) { /* stockage indisponible */ }
      listeners.forEach(f => f(k));
    },
    del(k) {
      try { if (mem && !LOCAL_ONLY(k)) { delete mem[k]; DB.del(k); } else localStorage.removeItem(k); } catch (e) { /* idem */ }
      listeners.forEach(f => f(k));
    },
    keys(prefix) {
      const src = mem ? Object.keys(mem) : Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
      return src.filter(k => k && k.startsWith(prefix));
    },
    onChange(f) { listeners.push(f); },
    persistent: !!mem,
    openFolder: () => DB && DB.openFolder && DB.openFolder()
  };

  function shuffle(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  /* Liste ordonnée des chapitres d'une matière */
  function chaptersOf(S) {
    const seen = [];
    const add = c => { if (c && !seen.includes(c)) seen.push(c); };
    S.rappels.forEach(r => add(r.chap));
    S.flash.forEach(c => add(c[0]));
    S.qcm.forEach(c => add(c[0]));
    return seen;
  }

  /* Relance une animation CSS */
  function replay(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

  /* Halo coloré plein écran (vert / rouge) */
  function screenFlash(kind) {
    const f = $("#screen-flash");
    if (!f) return;
    f.className = ""; void f.offsetWidth; f.className = kind;
  }

  function confetti() {
    let cv = $("#confetti");
    if (!cv) { cv = document.createElement("canvas"); cv.id = "confetti"; document.body.appendChild(cv); }
    const cx = cv.getContext("2d");
    cv.width = innerWidth; cv.height = innerHeight;
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#c94a6c";
    const cols = [accent, "#f08bb4", "#ffc2da", "#e85d92", "#ffffff", "#f5b041"];
    const ps = Array.from({ length: 170 }, () => ({
      x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * .5,
      w: 6 + Math.random() * 7, h: 8 + Math.random() * 8,
      vx: -2 + Math.random() * 4, vy: 2 + Math.random() * 4,
      r: Math.random() * 6, vr: -.2 + Math.random() * .4,
      c: cols[Math.floor(Math.random() * cols.length)]
    }));
    let t = 0;
    (function frame() {
      cx.clearRect(0, 0, cv.width, cv.height);
      ps.forEach(p => {
        p.x += p.vx; p.y += p.vy; p.r += p.vr; p.vy += .03;
        cx.save(); cx.translate(p.x, p.y); cx.rotate(p.r); cx.fillStyle = p.c;
        cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); cx.restore();
      });
      if (++t < 260) requestAnimationFrame(frame); else cx.clearRect(0, 0, cv.width, cv.height);
    })();
  }

  /* Icônes vectorielles (trait 1.8, couleur du texte) */
  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-6h4v6"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    cards: '<rect x="3" y="7" width="14" height="13" rx="2"/><path d="M7 3.5h11.5A2.5 2.5 0 0 1 21 6v10.5"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/>',
    checklist: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="m3.5 6 1.5 1.5L7.5 5"/><path d="m3.5 12 1.5 1.5 2.5-2.5"/><path d="m3.5 18 1.5 1.5 2.5-2.5"/>',
    sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M7.5 14h9"/>',
    swap: '<path d="M7 3 3 7l4 4"/><path d="M3 7h14"/><path d="m17 21 4-4-4-4"/><path d="M21 17H7"/>',
    shuffle: '<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="m4 4 5 5"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
    reset: '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5"/>',
    stack: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    doc: '<path d="M14 3H6.5A2.5 2.5 0 0 0 4 5.5v13A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V9z"/><path d="M14 3v6h6"/><path d="M8.5 13.5h7M8.5 17h4.5"/>',
    bulb: '<path d="M9 18h6M10 21.5h4"/><path d="M12 2.5a6.5 6.5 0 0 0-3.8 11.8c.5.4.8 1 .8 1.6V16h6v-.1c0-.6.3-1.2.8-1.6A6.5 6.5 0 0 0 12 2.5z"/>',
    flip: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 21v-5h-5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    play: '<path d="M7 4.5v15l12-7.5z"/>',
    sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    send: '<path d="M4 12 20 4l-6 16-3-7z"/><path d="m11 13 9-9"/>',
    sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
    moon: '<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/>',
    star: '<path d="m12 3.2 2.7 5.5 6 .9-4.35 4.25 1.03 6L12 17l-5.38 2.85 1.03-6L3.3 9.6l6-.9z"/>',
    heart: '<path d="M12 20.5s-7.5-4.6-9.3-9.6C1.6 7.6 3.8 4 7.3 4c2 0 3.6 1.1 4.7 2.8C13.1 5.1 14.7 4 16.7 4c3.5 0 5.7 3.6 4.6 6.9-1.8 5-9.3 9.6-9.3 9.6z" fill="currentColor"/>',
    award: '<circle cx="12" cy="9" r="6"/><path d="M8.5 14 7 22l5-3 5 3-1.5-8"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6.5 7l1 13h9l1-13"/><path d="M10 11v5.5M14 11v5.5"/>',
    download: '<path d="M12 3.5v12"/><path d="m7 10.5 5 5 5-5"/><path d="M4.5 20h15"/>',
    pause: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7M14 8.5v7"/>',
    note: '<path d="M5 3.5h10l4 4V20.5H5z"/><path d="M15 3.5v4h4"/><path d="M8.5 12h7M8.5 15.5h5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    chart: '<path d="M4 20V4"/><path d="M4 20h16"/><rect x="7.5" y="11" width="3" height="6" rx=".8"/><rect x="12.5" y="7" width="3" height="10" rx=".8"/><rect x="17.5" y="13" width="2.5" height="4" rx=".8"/>',
    flame: '<path d="M12 21.5c-4 0-6.5-2.7-6.5-6.2 0-3.4 2.4-5.4 3.6-8.3.4 1.6 1.3 2.6 2.4 3.1C12 7 13.3 4.4 15.6 2.5c-.3 3.2 2.9 5.6 2.9 9.9 0 5.6-2.6 9.1-6.5 9.1z"/><path d="M12 21.5c-1.7 0-2.9-1.3-2.9-3 0-1.9 1.6-2.9 2.3-4.6 1.4 1 3.5 2.7 3.5 4.6 0 1.7-1.2 3-2.9 3z"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18.5 14.4A6.5 6.5 0 0 1 21.5 20"/>',
    share: '<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1"/>',
    copy: '<rect x="8" y="8" width="12.5" height="12.5" rx="2.5"/><path d="M16 8V5.5A2.5 2.5 0 0 0 13.5 3h-8A2.5 2.5 0 0 0 3 5.5v8A2.5 2.5 0 0 0 5.5 16H8"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7.5V12l3 2"/>',
    edit: '<path d="M4 20h4L19.5 8.5a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    bell: '<path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'
  };
  const icon = (name, cls = "") =>
    `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;

  /* Convertit le LaTeX simple en texte lisible (au cas où le modèle en produit) */
  function unlatex(s) {
    const G = { pi: "π", alpha: "α", beta: "β", gamma: "γ", delta: "δ", Delta: "Δ", times: "×", cdot: "·", approx: "≈", leq: "≤", geq: "≥", neq: "≠", infty: "∞", sum: "Σ", rightarrow: "→", Rightarrow: "⇒" };
    let prev;
    do {
      prev = s;
      s = s.replace(/\\(?:d|t)?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1) / ($2)")
           .replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)")
           .replace(/\\(?:text|mathrm|mathbf|textbf|operatorname)\s*\{([^{}]*)\}/g, "$1");
    } while (s !== prev);
    return s
      .replace(/\\([A-Za-z]+)/g, (m, w) => G[w] !== undefined ? G[w] : (w === "left" || w === "right" ? "" : m))
      .replace(/\\[,;: !]/g, " ").replace(/\\%/g, "%")
      .replace(/\$\$?([^$]+)\$\$?/g, "$1")
      .replace(/\^\{([^{}]*)\}/g, "^$1").replace(/_\{([^{}]*)\}/g, "($1)")
      .replace(/[{}]/g, "");
  }

  /* Markdown minimal et sûr (texte échappé d'abord) pour les réponses de l'assistant */
  function md(src) {
    const fmtInline = s => esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<em>$2</em>");
    const inline = s => withMath(s, fmtInline);
    let text = String(src || "").replace(/\r/g, "")
      .replace(/\\\[([\s\S]+?)\\\]/g, (m, x) => "$$" + x.replace(/\n/g, " ") + "$$")
      .replace(/\$\$([\s\S]+?)\$\$/g, (m, x) => "\n$$" + x.replace(/\n/g, " ").trim() + "$$\n")
      .replace(/\\\((.+?)\\\)/g, (m, x) => "$" + x.trim() + "$");
    if (!window.katex) text = unlatex(text);
    const lines = text.split("\n");
    let html = "", list = null, para = [];
    const flushP = () => { if (para.length) { html += `<p>${para.map(inline).join("<br>")}</p>`; para = []; } };
    const flushL = () => { if (list) { html += `</${list}>`; list = null; } };
    for (const raw of lines) {
      const l = raw.trimEnd();
      let m;
      if (!l.trim()) { flushP(); flushL(); continue; }
      if ((m = l.match(/^\s*#{1,4}\s+(.*)$/))) { flushP(); flushL(); html += `<h4>${inline(m[1])}</h4>`; continue; }
      if ((m = l.match(/^\s*[-*•]\s+(.*)$/))) { flushP(); if (list !== "ul") { flushL(); html += "<ul>"; list = "ul"; } html += `<li>${inline(m[1])}</li>`; continue; }
      if ((m = l.match(/^\s*\d+[.)]\s+(.*)$/))) { flushP(); if (list !== "ol") { flushL(); html += "<ol>"; list = "ol"; } html += `<li>${inline(m[1])}</li>`; continue; }
      flushL(); para.push(l);
    }
    flushP(); flushL();
    return html;
  }

  window.U = { $, $$, esc, rich, plain, tex, md, Store, shuffle, chaptersOf, replay, screenFlash, confetti, icon };
})();
