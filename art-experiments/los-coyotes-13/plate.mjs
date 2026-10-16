import { readFileSync, writeFileSync } from 'node:fs';
import * as R from './render.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const bundle = JSON.parse(readFileSync(arg('in'), 'utf8'));
const STYLE = arg('style', 'logbook');
const WIDTH = +arg('width', 1000);

const T = R.terrain(bundle);
const CLUB = { driver: 'Dr', threeWood: '3W', fiveWood: '5W', hybrid: 'Hy', fourIron: '4i', fiveIron: '5i',
  sixIron: '6i', sevenIron: '7i', eightIron: '8i', nineIron: '9i', pitchingWedge: 'PW', gapWedge: 'GW',
  sandWedge: 'SW', lobWedge: 'LW', putter: 'Pt' };

// ---------------------------------------------------------------- styles ----
const STYLES = {
  logbook: {
    pitch: 0, exaggeration: 1, perspective: 0, contours: true, quads: false,
    paper: '#EFE6D2', ink: '#1B3A29', ink2: '#3D5A48', accent: '#A8392A',
    cover: { rough: null, fairway: '#E3D9BE', green: '#D6CBA8', bunker: '#F5EEDA', water: '#C9CBB4' },
  },
  relief: {
    pitch: 56, exaggeration: 2.0, perspective: 0.22, contours: true, quads: true,
    paper: '#EFE6D2', ink: '#1B3A29', ink2: '#3D5A48', accent: '#A8392A',
    cover: { rough: '#CFC4A4', fairway: '#DFD6B8', green: '#EDE6CC', bunker: '#F7F1DC', water: '#A9B49E' },
    shadeRange: [0.72, 1.06],
  },
  natural: {
    pitch: 63, exaggeration: 2.2, perspective: 0.42, contours: false, quads: true,
    paper: '#0E1613', ink: '#EFE5C9', ink2: '#B5AC8E', accent: '#E07A55',
    cover: { rough: '#4C6B33', fairway: '#7BA33F', green: '#9CC65A', bunker: '#E3D2A2', water: '#3E6E8E' },
    shadeRange: [0.42, 1.18], sky: true,
  },
};
const S = STYLES[STYLE];
if (!S) throw new Error(`unknown style ${STYLE}`);

const cam = R.camera(bundle, { pitch: S.pitch, exaggeration: S.exaggeration, perspective: S.perspective, width: WIDTH });
const P = cam.project;
const ground = (x, y) => T.z(x, y);

const out = [];
const push = (...s) => out.push(...s);

// ------------------------------------------------------------- background ---
push(`<rect width="${cam.width}" height="${cam.height}" fill="${S.paper}"/>`);
if (S.sky) {
  push(`<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#16232B"/><stop offset="55%" stop-color="#22343A"/>
    <stop offset="100%" stop-color="#31432F"/></linearGradient></defs>`);
  push(`<rect width="${cam.width}" height="${cam.height}" fill="url(#sky)"/>`);
}

// ---------------------------------------------------------------- terrain ---
if (S.quads) {
  const N = 104, { frame } = bundle;
  const gx = i => frame.x0 + (frame.x1 - frame.x0) * i / N;
  const gy = j => frame.y0 + (frame.y1 - frame.y0) * j / N;
  const step = (frame.x1 - frame.x0) / N;
  const cells = [];
  for (let j = N - 1; j >= 0; j--) {           // far → near (painter's algorithm)
    for (let i = 0; i < N; i++) {
      const x = gx(i), y = gy(j), x2 = gx(i + 1), y2 = gy(j + 1);
      const cxm = (x + x2) / 2, cym = (y + y2) / 2;
      const cover = R.coverAt(bundle, cxm, cym);
      const sh = R.hillshade(ground, cxm, cym, step, { azimuth: 320, altitude: 42 });
      const [lo, hi] = S.shadeRange;
      const k = lo + (hi - lo) * sh;
      const base = R.rgb(S.cover[cover]);
      const col = R.hex(R.shade(base, k));
      const pts = [[x, y], [x2, y], [x2, y2], [x, y2]]
        .map(([a, b]) => P(a, b, ground(a, b)).map(v => v.toFixed(1)).join(',')).join(' ');
      cells.push(`<polygon points="${pts}" fill="${col}"/>`);
    }
  }
  push(`<g shape-rendering="crispEdges">`, ...cells, `</g>`);
} else {
  // Flat plan view: paint the cover polygons directly.
  for (const kind of ['fairway', 'green', 'bunker', 'water']) {
    const fill = S.cover[kind];
    if (!fill) continue;
    for (const shape of bundle.features[kind]) {
      push(`<path d="${R.pathOf(shape, P)}" fill="${fill}" fill-rule="evenodd" stroke="${S.ink}" stroke-opacity="0.45" stroke-width="1"/>`);
    }
  }
}

// --------------------------------------------------------------- contours ---
if (S.contours) {
  const step = 2; // metres
  const lines = [];
  for (let lv = Math.ceil(T.min / step) * step; lv < T.max; lv += step) {
    const major = Math.abs(lv % 10) < 0.01;
    const segs = R.contour(bundle, lv);
    if (!segs.length) continue;
    const d = segs.map(([a, b]) => {
      const pa = P(a.x, a.y, S.quads ? lv : undefined), pb = P(b.x, b.y, S.quads ? lv : undefined);
      return `M${pa[0].toFixed(1)},${pa[1].toFixed(1)}L${pb[0].toFixed(1)},${pb[1].toFixed(1)}`;
    }).join('');
    lines.push(`<path d="${d}" fill="none" stroke="${S.ink}" stroke-opacity="${major ? 0.32 : 0.16}" stroke-width="${major ? 1.1 : 0.7}"/>`);
  }
  push(...lines);
}

// ------------------------------------------------------- feature outlines ---
if (S.quads) {
  const edge = (kind, opacity, w) => {
    for (const shape of bundle.features[kind]) {
      push(`<path d="${R.pathOf(shape, P, ground)}" fill="none" stroke="${S.ink}" stroke-opacity="${opacity}" stroke-width="${w}" fill-rule="evenodd"/>`);
    }
  };
  edge('green', STYLE === 'natural' ? 0.25 : 0.5, 1.2);
  edge('bunker', STYLE === 'natural' ? 0.22 : 0.45, 1);
  edge('water', STYLE === 'natural' ? 0.25 : 0.45, 1);
}

// ------------------------------------------------------------- walk track ---
if (bundle.track.length > 1) {
  push(`<path d="${R.lineOf(bundle.track, P, S.quads ? ground : null)}" fill="none" stroke="${S.ink}" stroke-opacity="0.30" stroke-width="1.6" stroke-dasharray="1 4" stroke-linecap="round"/>`);
}

// ------------------------------------------------------------------ shots ---
const shots = bundle.shots.slice().sort((a, b) => a.seq - b.seq);
const zAt = (p) => ground(p.x, p.y);

// Flight arcs between consecutive shots (a parabola whose apex scales with carry).
for (let i = 0; i < shots.length - 1; i++) {
  const a = shots[i], b = shots[i + 1];
  const carry = Math.hypot(b.x - a.x, b.y - a.y);
  if (carry < 4) continue;                                   // tap-ins: no arc
  const apex = Math.min(38, Math.max(4, carry * (a.isPutt ? 0.01 : 0.17)));
  const za = zAt(a), zb = zAt(b);
  const pts = [];
  for (let t = 0; t <= 1.0001; t += 1 / 40) {
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    const z = za + (zb - za) * t + (S.quads ? apex * 4 * t * (1 - t) : 0);
    pts.push(P(x, y, z));
  }
  const d = 'M' + pts.map(p => p.map(v => v.toFixed(1)).join(',')).join('L');
  push(`<path d="${d}" fill="none" stroke="${S.accent}" stroke-opacity="0.85" stroke-width="2" stroke-dasharray="${a.isPutt ? '2 3' : '7 5'}" stroke-linecap="round"/>`);
}

// Markers.
shots.forEach((s, i) => {
  const [x, y] = P(s.x, s.y, S.quads ? zAt(s) : undefined);
  const r = s.isPutt ? 7 : 11;
  if (S.quads) push(`<ellipse cx="${x.toFixed(1)}" cy="${(y + r * 0.55).toFixed(1)}" rx="${r * 0.9}" ry="${r * 0.34}" fill="#000" opacity="0.28"/>`);
  push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${S.paper}" stroke="${S.ink}" stroke-width="1.6"/>`);
  push(`<text x="${x.toFixed(1)}" y="${(y + (s.isPutt ? 3 : 4)).toFixed(1)}" text-anchor="middle" font-family="Menlo,monospace" font-size="${s.isPutt ? 9 : 12}" font-weight="700" fill="${S.ink}">${s.seq}</text>`);
  if (!s.isPutt && CLUB[s.club]) {
    push(`<text x="${(x + r + 5).toFixed(1)}" y="${(y - r + 2).toFixed(1)}" font-family="Menlo,monospace" font-size="11" font-weight="700" fill="${S.ink}" opacity="0.85">${CLUB[s.club]}</text>`);
  }
});

// ------------------------------------------------------------------- flag ---
const greenC = bundle.features.green[0]?.[0];
if (greenC) {
  const cx = greenC.reduce((a, p) => a + p.x, 0) / greenC.length;
  const cy = greenC.reduce((a, p) => a + p.y, 0) / greenC.length;
  const base = P(cx, cy, S.quads ? ground(cx, cy) : undefined);
  const top = [base[0], base[1] - 34];
  push(`<line x1="${base[0].toFixed(1)}" y1="${base[1].toFixed(1)}" x2="${top[0].toFixed(1)}" y2="${top[1].toFixed(1)}" stroke="${S.ink}" stroke-width="2"/>`);
  push(`<path d="M${top[0].toFixed(1)},${top[1].toFixed(1)} L${(top[0] + 20).toFixed(1)},${(top[1] + 7).toFixed(1)} L${top[0].toFixed(1)},${(top[1] + 14).toFixed(1)} Z" fill="${S.accent}"/>`);
}

// ------------------------------------------------------------------ frame ---
const roman = n => { const t = [[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']]; let r = '', v = n;
  for (const [a, g] of t) while (v >= a) { r += g; v -= a; } return r; };
const strokes = bundle.shots.length;
const rel = strokes - bundle.par;
const label = rel === 0 ? 'PAR' : rel > 0 ? `+${rel}` : `${rel}`;

push(`<g font-family="Georgia,serif" fill="${S.ink}">`);
push(`<text x="34" y="66" font-size="58" font-weight="700">${roman(bundle.hole)}</text>`);
push(`<text x="34" y="92" font-family="Menlo,monospace" font-size="12" font-weight="700" letter-spacing="2" fill="${S.ink2}">PAR ${bundle.par}${bundle.yards ? ` · ${bundle.yards} YDS` : ''}</text>`);
push(`<text x="${cam.width - 34}" y="66" font-size="52" font-weight="700" text-anchor="end">${strokes}</text>`);
push(`<text x="${cam.width - 34}" y="92" font-family="Menlo,monospace" font-size="12" font-weight="700" letter-spacing="2" text-anchor="end" fill="${S.accent}">${label}</text>`);
push(`<text x="34" y="${cam.height - 26}" font-family="Menlo,monospace" font-size="11" font-weight="700" letter-spacing="2" fill="${S.ink2}">${R.esc(bundle.course.toUpperCase())}</text>`);
push(`<text x="${cam.width - 34}" y="${cam.height - 26}" font-family="Menlo,monospace" font-size="11" font-weight="700" letter-spacing="2" text-anchor="end" fill="${S.ink2}">${(T.max - T.min).toFixed(0)}M RELIEF</text>`);
push(`</g>`);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cam.width} ${cam.height}" width="${cam.width}" height="${cam.height}">\n${out.join('\n')}\n</svg>`;
writeFileSync(arg('out'), svg);
console.log(`${STYLE}: ${cam.width}x${cam.height} → ${arg('out')}`);
