import { readFileSync, writeFileSync } from 'node:fs';
import * as R from './render.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const bundle = JSON.parse(readFileSync(arg('in'), 'utf8'));
const STYLE = arg('style', 'dawn');
const W = +arg('width', 1440), H = +arg('height', 900);

const T = R.terrain(bundle, +arg('smooth', 1));
const ground = (x, y) => T.z(x, y);
const CLUB = { driver: 'Dr', threeWood: '3W', fiveWood: '5W', hybrid: 'Hy', fourIron: '4i', fiveIron: '5i',
  sixIron: '6i', sevenIron: '7i', eightIron: '8i', nineIron: '9i', pitchingWedge: 'PW', gapWedge: 'GW',
  sandWedge: 'SW', lobWedge: 'LW', putter: 'Pt' };

const PALETTES = {
  // Naturalistic, low sun — what a real flyover looks like.
  dawn: {
    sky: [['0%', '#1D3A4C'], ['45%', '#3E6A74'], ['72%', '#9FB289'], ['100%', '#D9CBA0']],
    haze: '#A7B9A8', hazeStart: 260, hazeEnd: 1500, hazeMax: 0.62,
    cover: { rough: '#4A6B31', fairway: '#7DA63D', green: '#A2CC5C', bunker: '#E8D6A4', water: '#3C6C8C' },
    shade: [0.34, 1.22], sun: { azimuth: 110, altitude: 24 },
    ink: '#F2EAD3', ink2: '#C9BE9C', accent: '#E8683F',
  },
  // The Fairway Logbook in three dimensions — an engraved landscape.
  engraved: {
    sky: [['0%', '#E8DDC2'], ['60%', '#EFE6D2'], ['100%', '#E3D7B8']],
    haze: '#E7DCC0', hazeStart: 220, hazeEnd: 1400, hazeMax: 0.72,
    cover: { rough: '#C4B995', fairway: '#DCD2B0', green: '#EEE7CC', bunker: '#F7F2E0', water: '#A8B49C' },
    shade: [0.7, 1.1], sun: { azimuth: 320, altitude: 40 },
    ink: '#1B3A29', ink2: '#3D5A48', accent: '#A8392A', contours: true,
  },
};
const S = PALETTES[STYLE];
if (!S) throw new Error(`unknown style ${STYLE}`);

const cam = R.flyCamera(bundle, ground, {
  back: +arg('back', 160), up: +arg('up', 92), targetAlong: +arg('target', 0.72),
  fov: +arg('fov', 38), width: W, height: H, shift: +arg('shift', 0),
});
const P = cam.project;
const out = [];
const push = (...s) => out.push(...s);

// ------------------------------------------------------------------- sky ---
push(`<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">` + S.sky.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('') + `</linearGradient></defs>`);
push(`<rect width="${W}" height="${H}" fill="url(#sky)"/>`);

// --------------------------------------------------------------- terrain ---
const N = +arg('grid', 150), { frame } = bundle;
const gx = i => frame.x0 + (frame.x1 - frame.x0) * i / N;
const gy = j => frame.y0 + (frame.y1 - frame.y0) * j / N;
const step = (frame.x1 - frame.x0) / N;
const haze = R.rgb(S.haze);

const quads = [];
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    const x0 = gx(i), y0 = gy(j), x1 = gx(i + 1), y1 = gy(j + 1);
    // Expand slightly so neighbouring quads overlap and no seams show.
    const ex = (x1 - x0) * 0.03, ey = (y1 - y0) * 0.03;
    const corners = [[x0 - ex, y0 - ey], [x1 + ex, y0 - ey], [x1 + ex, y1 + ey], [x0 - ex, y1 + ey]];
    const proj = corners.map(([a, b]) => P(a, b, ground(a, b)));
    if (proj.some(p => !p)) continue;
    const depth = proj.reduce((a, p) => a + p[2], 0) / 4;
    const cxm = (x0 + x1) / 2, cym = (y0 + y1) / 2;
    const sh = R.hillshade(ground, cxm, cym, step, S.sun);
    const [lo, hi] = S.shade;
    let col = R.shade(R.rgb(S.cover.rough), lo + (hi - lo) * sh);
    const t = Math.max(0, Math.min(1, (depth - S.hazeStart) / (S.hazeEnd - S.hazeStart))) * S.hazeMax;
    col = R.mix(col, haze, t);
    quads.push({ depth, svg: `<polygon points="${proj.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}" fill="${R.hex(col)}"/>` });
  }
}
quads.sort((a, b) => b.depth - a.depth);            // far → near
out.push('<g>');
for (const q of quads) out.push(q.svg);
out.push('</g>');

// ----------------------------------------------- draped lines & outlines ---
const drape = (pts, closed) => {
  const proj = pts.map(p => P(p.x, p.y, ground(p.x, p.y))).filter(Boolean);
  if (proj.length < 2) return null;
  return 'M' + proj.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L') + (closed ? 'Z' : '');
};

// Cover is painted as draped polygons rather than per-quad fills, so mown
// edges stay crisp while the terrain's own shading still reads through.
const drapeShape = shape => shape.map(r => drape(r, true)).filter(Boolean).join(' ');
for (const kind of ['fairway', 'tee', 'green', 'bunker', 'water']) {
  const fill = S.cover[kind === 'tee' ? 'fairway' : kind];
  for (const shape of bundle.features[kind]) {
    const d = drapeShape(shape);
    if (d) push(`<path d="${d}" fill="${fill}" fill-rule="evenodd" opacity="0.82"/>`);
  }
}

if (S.contours) {
  for (let lv = Math.ceil(T.min / 2) * 2; lv < T.max; lv += 2) {
    const major = Math.abs(lv % 10) < 0.01;
    const d = R.contour(bundle, lv).map(([a, b]) => {
      const pa = P(a.x, a.y, lv), pb = P(b.x, b.y, lv);
      return pa && pb ? `M${pa[0].toFixed(1)},${pa[1].toFixed(1)}L${pb[0].toFixed(1)},${pb[1].toFixed(1)}` : '';
    }).join('');
    if (d) push(`<path d="${d}" fill="none" stroke="${S.ink}" stroke-opacity="${major ? 0.25 : 0.12}" stroke-width="${major ? 1 : 0.6}"/>`);
  }
}

for (const [kind, op] of [['green', 0.3], ['bunker', 0.25], ['water', 0.3]]) {
  for (const shape of bundle.features[kind]) for (const ring of shape) {
    const d = drape(ring, true);
    if (d) push(`<path d="${d}" fill="none" stroke="${S.ink}" stroke-opacity="${op}" stroke-width="1.1"/>`);
  }
}

// ------------------------------------------------------------ walk track ---
if (bundle.track.length > 1) {
  const d = drape(bundle.track, false);
  if (d) push(`<path d="${d}" fill="none" stroke="${S.ink}" stroke-opacity="0.42" stroke-width="2" stroke-dasharray="1.5 5" stroke-linecap="round"/>`);
}

// ----------------------------------------------------------------- shots ---
const shots = bundle.shots.slice().sort((a, b) => a.seq - b.seq);

for (let i = 0; i < shots.length - 1; i++) {
  const a = shots[i], b = shots[i + 1];
  const carry = Math.hypot(b.x - a.x, b.y - a.y);
  if (carry < 4) continue;
  const apex = Math.min(42, Math.max(3, carry * (a.isPutt ? 0.015 : 0.18)));
  const za = ground(a.x, a.y), zb = ground(b.x, b.y);
  const pts = [];
  for (let t = 0; t <= 1.0001; t += 1 / 48) {
    const p = P(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, za + (zb - za) * t + apex * 4 * t * (1 - t));
    if (p) pts.push(p);
  }
  if (pts.length < 2) continue;
  push(`<path d="M${pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L')}" fill="none" stroke="${S.accent}" stroke-opacity="0.9" stroke-width="2.4" stroke-dasharray="${a.isPutt ? '2 3' : '9 6'}" stroke-linecap="round"/>`);
}

shots.forEach(s => {
  const g = ground(s.x, s.y);
  const base = P(s.x, s.y, g);
  if (!base) return;
  const scale = Math.max(0.42, Math.min(1.25, 260 / base[2]));
  const r = (s.isPutt ? 8 : 12) * scale;
  const stem = (s.isPutt ? 10 : 22) * scale;
  const cy = base[1] - stem;
  push(`<ellipse cx="${base[0].toFixed(1)}" cy="${base[1].toFixed(1)}" rx="${(r * 0.85).toFixed(1)}" ry="${(r * 0.3).toFixed(1)}" fill="#000" opacity="0.3"/>`);
  push(`<line x1="${base[0].toFixed(1)}" y1="${base[1].toFixed(1)}" x2="${base[0].toFixed(1)}" y2="${cy.toFixed(1)}" stroke="${S.ink}" stroke-width="${(1.4 * scale).toFixed(2)}" opacity="0.8"/>`);
  push(`<circle cx="${base[0].toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${STYLE === 'engraved' ? '#EFE6D2' : '#12211A'}" stroke="${S.ink}" stroke-width="${(1.6 * scale).toFixed(2)}"/>`);
  push(`<text x="${base[0].toFixed(1)}" y="${(cy + 4.2 * scale).toFixed(1)}" text-anchor="middle" font-family="Menlo,monospace" font-size="${(12 * scale).toFixed(1)}" font-weight="700" fill="${S.ink}">${s.seq}</text>`);
  if (!s.isPutt && CLUB[s.club] && scale > 0.6) {
    push(`<text x="${(base[0] + r + 5 * scale).toFixed(1)}" y="${(cy - r * 0.5).toFixed(1)}" font-family="Menlo,monospace" font-size="${(11 * scale).toFixed(1)}" font-weight="700" fill="${S.ink}" opacity="0.9">${CLUB[s.club]}</text>`);
  }
});

// ------------------------------------------------------------------ flag ---
const ring = bundle.features.green[0]?.[0];
if (ring) {
  const cx = ring.reduce((a, p) => a + p.x, 0) / ring.length;
  const cy2 = ring.reduce((a, p) => a + p.y, 0) / ring.length;
  const g = ground(cx, cy2);
  const b = P(cx, cy2, g), t = P(cx, cy2, g + 2.4);
  if (b && t) {
    push(`<line x1="${b[0].toFixed(1)}" y1="${b[1].toFixed(1)}" x2="${t[0].toFixed(1)}" y2="${t[1].toFixed(1)}" stroke="${S.ink}" stroke-width="2"/>`);
    const fl = Math.max(8, 2600 / b[2]);
    push(`<path d="M${t[0].toFixed(1)},${t[1].toFixed(1)} L${(t[0] + fl).toFixed(1)},${(t[1] + fl * 0.35).toFixed(1)} L${t[0].toFixed(1)},${(t[1] + fl * 0.7).toFixed(1)} Z" fill="${S.accent}"/>`);
  }
}

// ------------------------------------------------------------------ type ---
const roman = n => { const t = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]; let r = '', v = n;
  for (const [a, gl] of t) while (v >= a) { r += gl; v -= a; } return r; };
const strokes = bundle.shots.length, rel = strokes - bundle.par;
push(`<g font-family="Georgia,serif" fill="${S.ink}">`);
push(`<text x="38" y="72" font-size="56" font-weight="700">${roman(bundle.hole)}</text>`);
push(`<text x="38" y="98" font-family="Menlo,monospace" font-size="12" font-weight="700" letter-spacing="2.2" fill="${S.ink2}">PAR ${bundle.par}${bundle.yards ? ` · ${bundle.yards} YDS` : ''}</text>`);
push(`<text x="${W - 38}" y="72" font-size="52" font-weight="700" text-anchor="end">${strokes}</text>`);
push(`<text x="${W - 38}" y="98" font-family="Menlo,monospace" font-size="12" font-weight="700" letter-spacing="2.2" text-anchor="end" fill="${S.accent}">${rel === 0 ? 'PAR' : rel > 0 ? '+' + rel : rel}</text>`);
push(`<text x="38" y="${H - 30}" font-family="Menlo,monospace" font-size="11" font-weight="700" letter-spacing="2.2" fill="${S.ink2}">${R.esc(bundle.course.toUpperCase())}</text>`);
push(`</g>`);

writeFileSync(arg('out'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">\n${out.join('\n')}\n</svg>`);
console.log(`${STYLE}: ${W}x${H}, ${quads.length} terrain quads → ${arg('out')}`);
