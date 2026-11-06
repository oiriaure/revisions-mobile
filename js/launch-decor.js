/* ------------------------------------------------------------------
   Décor de l'écran de lancement (choix du profil), en SVG.
   Les couleurs suivent les variables CSS --d-* (thème clair / sombre).
------------------------------------------------------------------- */
window.LaunchDecor = (function () {
  "use strict";

  const star = (cls, style) => `<svg class="deco star ${cls}" style="${style}" viewBox="0 0 24 24"><path d="M12 2.5l2.6 6.1 6.6.6-5 4.4 1.5 6.5L12 16.7l-5.7 3.4 1.5-6.5-5-4.4 6.6-.6z" fill="var(--d-gold)"/></svg>`;

  const book = `
  <svg class="deco float-a" style="left:5%;top:9%;width:170px" viewBox="0 0 170 110">
    <defs><linearGradient id="dkBook" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--d-blue)"/><stop offset="1" stop-color="var(--d-blue-2)"/></linearGradient></defs>
    <path d="M8 30 L84 44 L84 104 L8 90 Z" fill="url(#dkBook)"/>
    <path d="M162 30 L86 44 L86 104 L162 90 Z" fill="url(#dkBook)"/>
    <path d="M14 22 Q50 18 84 36 L84 96 Q50 80 14 84 Z" fill="var(--d-paper)"/>
    <path d="M156 22 Q120 18 86 36 L86 96 Q120 80 156 84 Z" fill="var(--d-paper-2)"/>
    <g stroke="var(--d-line)" stroke-width="3" stroke-linecap="round" opacity=".8">
      <path d="M26 36 Q50 34 72 44"/><path d="M26 48 Q50 46 72 56"/><path d="M26 60 Q50 58 72 68"/>
      <path d="M144 36 Q120 34 98 44"/><path d="M144 48 Q120 46 98 56"/><path d="M144 60 Q120 58 98 68"/>
    </g>
  </svg>`;

  const target = `
  <svg class="deco float-b" style="right:6%;top:7%;width:150px" viewBox="0 0 150 150">
    <circle cx="68" cy="82" r="54" fill="var(--d-target-1)"/>
    <circle cx="68" cy="82" r="40" fill="var(--d-target-2)"/>
    <circle cx="68" cy="82" r="26" fill="var(--d-target-1)"/>
    <circle cx="68" cy="82" r="12" fill="var(--d-target-2)"/>
    <path d="M70 80 L128 22" stroke="var(--d-blue)" stroke-width="7" stroke-linecap="round"/>
    <path d="M128 22 L144 18 L132 32 Z M120 14 L136 8 L128 24 Z" fill="var(--d-blue)"/>
    <path d="M118 12 L140 6 L134 16 L144 18 L126 34 Z" fill="var(--d-blue-2)" opacity=".85"/>
  </svg>`;

  const chart = `
  <svg class="deco float-c" style="left:6%;top:38%;width:130px" viewBox="0 0 130 110">
    <rect x="10" y="62" width="26" height="40" rx="5" fill="var(--d-blue)"/>
    <rect x="46" y="44" width="26" height="58" rx="5" fill="var(--d-teal)"/>
    <rect x="82" y="22" width="26" height="80" rx="5" fill="var(--d-gold)"/>
    <path d="M6 54 L40 30 L62 40 L108 8" fill="none" stroke="var(--d-green)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M96 6 L112 4 L110 20 Z" fill="var(--d-green)"/>
  </svg>`;

  const note = `
  <svg class="deco float-a" style="right:7%;top:40%;width:120px;animation-delay:-2s" viewBox="0 0 120 110">
    <g transform="rotate(8 60 55)">
      <rect x="14" y="12" width="92" height="84" rx="6" fill="var(--d-note)"/>
      <path d="M86 96 L106 76 L106 90 Q106 96 100 96 Z" fill="var(--d-note-fold)"/>
      <g stroke="var(--d-note-line)" stroke-width="5" stroke-linecap="round"><path d="M32 40 H86"/><path d="M32 56 H86"/><path d="M32 72 H66"/></g>
    </g>
  </svg>`;

  const books = `
  <svg class="deco desk" style="left:0;bottom:0;width:260px" viewBox="0 0 260 170">
    <rect x="6" y="118" width="220" height="40" rx="8" fill="var(--d-blue-2)"/><rect x="20" y="124" width="196" height="8" rx="3" fill="var(--d-paper)" opacity=".9"/>
    <rect x="22" y="80" width="200" height="40" rx="8" fill="var(--d-teal)"/><rect x="36" y="86" width="176" height="8" rx="3" fill="var(--d-paper)" opacity=".9"/>
    <rect x="10" y="44" width="190" height="38" rx="8" fill="var(--d-blue)"/><rect x="24" y="50" width="166" height="8" rx="3" fill="var(--d-paper)" opacity=".9"/>
    <rect x="150" y="44" width="16" height="38" fill="var(--d-gold)"/>
  </svg>`;

  const cup = `
  <svg class="deco desk" style="right:2%;bottom:0;width:150px" viewBox="0 0 150 190">
    <path d="M58 70 L40 6" stroke="var(--d-gold)" stroke-width="10" stroke-linecap="round"/>
    <path d="M78 70 L84 0" stroke="var(--d-blue)" stroke-width="10" stroke-linecap="round"/>
    <path d="M96 72 L118 18" stroke="var(--d-pink)" stroke-width="10" stroke-linecap="round"/>
    <rect x="30" y="66" width="96" height="118" rx="12" fill="var(--d-blue-2)"/>
    <rect x="30" y="66" width="96" height="16" rx="8" fill="var(--d-blue)"/>
  </svg>`;

  const plant = (side) => `
  <svg class="deco plant ${side}" style="${side}:-10px;bottom:120px;width:150px" viewBox="0 0 150 220">
    <g fill="var(--d-leaf)">
      <path d="M70 220 Q60 150 20 120 Q60 120 78 170 Z"/>
      <path d="M78 220 Q90 140 140 110 Q110 160 86 200 Z" fill="var(--d-leaf-2)"/>
      <path d="M74 220 Q70 120 50 60 Q92 110 84 200 Z"/>
      <path d="M80 210 Q120 80 110 30 Q140 110 92 200 Z" fill="var(--d-leaf-2)"/>
    </g>
  </svg>`;

  const dots = Array.from({ length: 14 }, (_, i) => {
    const x = (i * 53 + 17) % 100, y = (i * 37 + 11) % 90, s = 6 + (i % 4) * 3;
    return `<span class="glow-dot" style="left:${x}%;top:${y}%;width:${s}px;height:${s}px;animation-delay:${-i * 0.7}s"></span>`;
  }).join("");

  function html() {
    return `<div class="launch-bg" aria-hidden="true">
      <span class="blob b1"></span><span class="blob b2"></span><span class="blob b3"></span>
      ${dots}
      ${book}${target}${chart}${note}
      ${star("tw", "left:11%;top:6%;width:22px")}${star("tw", "left:36%;top:14%;width:28px;animation-delay:-1s")}
      ${star("tw", "right:24%;top:4%;width:34px;animation-delay:-2s")}${star("tw", "left:4%;top:30%;width:18px;animation-delay:-.5s")}
      ${star("tw", "right:4%;top:58%;width:24px;animation-delay:-1.6s")}${star("tw", "left:30%;bottom:22%;width:16px;animation-delay:-2.4s")}
      <span class="wave"></span>
      ${plant("left")}${plant("right")}
      ${books}${cup}
    </div>`;
  }

  return { html };
})();
