// The Prague skyline drawn in the header and in the theme previews.
// Colours and which decorations show (stars, clouds, petals…) come from the theme's CSS variables.

// Small deterministic random generator so the scene looks the same on every render.
function rng(seed) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

const r1 = (n) => Math.round(n * 10) / 10;

function houses(from, to, rand) {
  let out = "";
  for (let x = from; x < to; ) {
    const w = Math.min(to - x, 7 + Math.floor(rand() * 7));
    const h = 10 + Math.floor(rand() * 12);
    const top = 104 - h;
    out += `<rect x="${x}" y="${top}" width="${w}" height="${h}"/><polygon points="${x},${top} ${r1(x + w / 2)},${top - 3 - Math.floor(rand() * 4)} ${x + w},${top}"/>`;
    x += w;
  }
  return out;
}

function windows(rand) {
  // Lit windows for the night theme, on the castle and the Old Town houses.
  let out = "";
  for (let x = 14; x < 112; x += 6) if (rand() > 0.35) out += `<rect x="${x}" y="75" width="1.6" height="2.4"/>`;
  for (let x = 279; x < 398; x += 4.5) {
    if (x > 311 && x < 346) continue;
    if (rand() > 0.5) out += `<rect x="${r1(x)}" y="${r1(92 + rand() * 7)}" width="1.4" height="2"/>`;
  }
  return out;
}

export function skylineSvg(seed = 7) {
  const rand = rng(seed);
  const stars = Array.from({ length: 26 }, (_, i) =>
    `<circle cx="${r1(rand() * 400)}" cy="${r1(rand() * 55)}" r="${r1(0.5 + rand() * 0.8)}" style="animation-delay:${r1(rand() * 4)}s"/>`,
  ).join("");
  const petals = Array.from({ length: 14 }, () =>
    `<ellipse cx="${r1(rand() * 400)}" cy="-6" rx="2.2" ry="1.3" style="animation-delay:${r1(rand() * 9)}s;animation-duration:${r1(7 + rand() * 6)}s"/>`,
  ).join("");
  const statues = Array.from({ length: 7 }, (_, i) => `<rect x="${163 + i * 14}" y="91" width="1.6" height="5"/>`).join("");
  const piers = Array.from({ length: 8 }, (_, i) => `<path d="M${152 + i * 14} 100 h6 v8 h-6z"/>`).join("");

  return `<svg class="scene" viewBox="0 0 400 120" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
  <g class="deco-stars">${stars}</g>
  <g class="deco-sun"><circle class="sun-glow" cx="296" cy="22" r="18"/><circle class="sun" cx="296" cy="22" r="10"/></g>
  <g class="deco-clouds">
    <g class="cloud c1"><ellipse cx="60" cy="30" rx="16" ry="6"/><ellipse cx="72" cy="27" rx="11" ry="7"/><ellipse cx="50" cy="31" rx="9" ry="4.5"/></g>
    <g class="cloud c2"><ellipse cx="230" cy="18" rx="13" ry="5"/><ellipse cx="240" cy="15" rx="9" ry="6"/></g>
  </g>
  <g class="deco-birds"><path d="M0 0 q2.5 -2.5 5 0 q2.5 -2.5 5 0"/><path d="M14 -5 q2 -2 4 0 q2 -2 4 0"/><path d="M9 6 q2 -2 4 0 q2 -2 4 0"/></g>

  <g class="far">
    <path d="M0 120 L0 74 C60 62 120 64 200 76 C260 84 330 68 400 74 L400 120 Z"/>
    <rect x="183" y="72" width="16" height="22"/><ellipse cx="191" cy="72" rx="8" ry="7"/><rect x="190" y="60" width="2" height="7"/>
    <rect x="205" y="66" width="4" height="26"/><polygon points="205,66 207,58 209,66"/>
  </g>

  <g class="near">
    <path d="M0 120 L0 86 C40 78 90 77 140 84 L150 120 Z"/>
    <polygon points="8,70 116,70 112,65 12,65"/><rect x="8" y="70" width="108" height="15"/>
    <rect x="50" y="37" width="6" height="33"/><polygon points="50,37 53,20 56,37"/>
    <rect x="60" y="37" width="6" height="33"/><polygon points="60,37 63,20 66,37"/>
    <polygon points="56,52 76,52 76,45 56,47"/><rect x="56" y="52" width="20" height="18"/>
    <rect x="76" y="27" width="10" height="43"/><polygon points="76,27 81,13 86,27"/><rect x="80.4" y="8" width="1.2" height="6"/>
    <rect x="86" y="54" width="14" height="16"/><polygon points="86,54 100,54 93,48"/>
    <polygon points="124,85 128.5,40 133,85"/><rect x="125.5" y="60" width="6" height="1.6"/><rect x="127" y="37" width="3" height="4"/>
    <rect x="144" y="74" width="12" height="30"/><polygon points="143,74 157,74 150,61"/>
    <rect x="150" y="96" width="112" height="4"/>${statues}${piers}
    <rect x="260" y="70" width="14" height="34"/><polygon points="259,70 275,70 267,53"/>
    <polygon points="259,70 260.5,63 262,70"/><polygon points="272,70 273.5,63 275,70"/>
    ${houses(276, 312, rand)}
    <rect x="312" y="66" width="33" height="38"/>
    <rect x="317" y="34" width="9" height="70"/><polygon points="317,34 318.2,28 319.4,32 321.5,17 323.6,32 324.8,28 326,34"/>
    <rect x="331" y="34" width="9" height="70"/><polygon points="331,34 332.2,28 333.4,32 335.5,17 337.6,32 338.8,28 340,34"/>
    <rect x="326" y="50" width="5" height="54"/>
    ${houses(345, 368, rand)}
    <rect x="368" y="48" width="10" height="56"/><polygon points="367,48 379,48 373,37"/><rect x="372.4" y="32" width="1.2" height="6"/>
    ${houses(378, 400, rand)}
  </g>
  <g class="deco-windows">${windows(rand)}</g>

  <rect class="river" x="0" y="104" width="400" height="16"/>
  <g class="shimmer"><rect x="20" y="108" width="26" height="0.9"/><rect x="120" y="112" width="18" height="0.9"/><rect x="230" y="109" width="30" height="0.9"/><rect x="330" y="113" width="22" height="0.9"/></g>
  <g class="deco-petals">${petals}</g>
</svg>`;
}
