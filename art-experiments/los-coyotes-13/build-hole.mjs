// Assemble one hole into a self-contained, projected "plate bundle":
// OSM course geometry + real shots + the walk track + a terrain grid,
// all in local metres with the tee at the bottom and the green at the top.
import { readFileSync, writeFileSync } from 'node:fs';
import { projector, rotator, centroid, dist, distToPolyline, bboxOf, smooth } from './geo.mjs';
import { fetchDem, sample } from './dem.mjs';

const arg = k => { const i = process.argv.indexOf('--' + k); return i < 0 ? null : process.argv[i + 1]; };
const COURSE = arg('course'), HOLE = +arg('hole');
const OSM = arg('osm'), SHOTS = arg('shots'), TRACK = arg('track'), OUT = arg('out');
const CORRIDOR = +(arg('corridor') || 70);   // metres either side of the centreline
const PAD = +(arg('pad') || 25);             // metres of margin around the plate

const courses = JSON.parse(readFileSync('/Users/moisesvargasjr/source/golf-caddie-coursedata/data/courses.json', 'utf8'));
const course = courses.courses.find(c => c.id === COURSE);
const curated = course.holes.find(h => h.number === HOLE);
if (!curated?.greenAnchor) throw new Error(`no green anchor for ${COURSE} hole ${HOLE}`);

// Normalise ways and multipolygon relations into { tags, rings } where rings[0]
// is the outer boundary and the rest are holes (islands of rough in a fairway).
const raw = JSON.parse(readFileSync(OSM, 'utf8')).elements;
const els = raw.flatMap(e => {
  if (e.type === 'way' && e.geometry?.length) return [{ tags: e.tags || {}, rings: [e.geometry] }];
  if (e.type === 'relation' && e.members?.length) {
    const outer = e.members.filter(m => m.role !== 'inner' && m.geometry?.length).map(m => m.geometry);
    const inner = e.members.filter(m => m.role === 'inner' && m.geometry?.length).map(m => m.geometry);
    if (outer.length) return outer.map((o, i) => ({ tags: e.tags || {}, rings: i === 0 ? [o, ...inner] : [o] }));
  }
  return [];
});
const ll = rings => rings.map(r => r.map(p => ({ lat: p.lat, lon: p.lon })));

// --- Anchor the frame on the curated green, then find its hole centreline ---
const anchor = { lat: curated.greenAnchor.lat, lon: curated.greenAnchor.lng };
const P0 = projector(anchor.lat, anchor.lon);
const toM = pts => pts.map(p => P0.fwd(p.lat, p.lon));

const greens = els.filter(e => e.tags.golf === 'green');
const green = greens.map(g => ({ el: g, d: dist(centroid(toM(ll(g.rings)[0])), { x: 0, y: 0 }) }))
                    .sort((a, b) => a.d - b.d)[0];
if (green.d > 60) throw new Error(`nearest OSM green is ${green.d.toFixed(0)}m from the curated anchor`);

// The centreline whose far end lands on that green.
const lines = els.filter(e => e.tags.golf === 'hole');
const line = lines.map(l => {
  const m = toM(ll(l.rings)[0]);
  return { el: l, m, d: Math.min(dist(m[0], { x: 0, y: 0 }), dist(m[m.length - 1], { x: 0, y: 0 })) };
}).sort((a, b) => a.d - b.d)[0];
// Orient tee → green.
let spine = line.m;
if (dist(spine[0], { x: 0, y: 0 }) < dist(spine[spine.length - 1], { x: 0, y: 0 })) spine = spine.slice().reverse();

// --- Rotate so the hole plays bottom-to-top ---
const teePt = spine[0];
const theta = Math.PI / 2 - Math.atan2(-teePt.y, -teePt.x);
const rot = rotator(theta);
const R = pts => pts.map(rot);

// --- Collect every feature inside the playing corridor ---
const near = (el, radius) => ll(el.rings).some(r => toM(r).some(p => distToPolyline(p, spine) < radius));
const pick = (kind, radius = CORRIDOR, sm = 2) =>
  els.filter(e => e.tags.golf === kind && near(e, radius))
     .map(e => ll(e.rings).map(r => smooth(R(toM(r)), sm)));

const features = {
  fairway: pick('fairway'),
  green:   [ll(green.el.rings).map(r => smooth(R(toM(r)), 2))],
  bunker:  pick('bunker'),
  water:   pick('water_hazard'),
  tee:     pick('tee', 45, 1),
  spine:   smooth(R(spine), 2, false),
};

// --- Shots ---
const allShots = JSON.parse(readFileSync(SHOTS, 'utf8'));
const holeShots = allShots.filter(s => s.hole === HOLE && !s.excludedAt);
const shots = holeShots.filter(s => s.lat != null).map(s => ({
  ...rot(P0.fwd(s.lat, s.lng)), seq: s.seq, club: s.club, isPutt: !!s.isPutt, acc: s.acc, ts: s.ts,
}));

// --- Walk track, clipped to this hole's time window ---
const T = ts => Date.parse(ts.replace(' ', 'T') + 'Z');
const stamps = holeShots.map(s => T(s.ts)).sort((a, b) => a - b);
const [t0, t1] = [stamps[0] - 240e3, stamps[stamps.length - 1] + 120e3];
const track = JSON.parse(readFileSync(TRACK, 'utf8'))
  .filter(p => { const t = T(p.ts); return t >= t0 && t <= t1; })
  .map(p => ({ ...rot(P0.fwd(p.lat, p.lng)), acc: p.acc }))
  .filter(p => distToPolyline(p, features.spine) < CORRIDOR * 1.6);

// --- Frame ---
const all = [...features.fairway.flat().flat(), ...features.green.flat().flat(), ...features.bunker.flat().flat(), ...features.water.flat().flat(), ...features.tee.flat().flat(), ...features.spine, ...shots, ...track];
const bb = bboxOf([all]);
const frame = { x0: bb.x0 - PAD, y0: bb.y0 - PAD, x1: bb.x1 + PAD, y1: bb.y1 + PAD };

// --- Terrain over the frame (unrotated bbox in lat/lon, plus a rotated sampler) ---
const inv = rotator(-theta);
const corners = [[frame.x0, frame.y0], [frame.x1, frame.y0], [frame.x1, frame.y1], [frame.x0, frame.y1]]
  .map(([x, y]) => inv({ x, y })).map(p => P0.inv(p.x, p.y));
const pad = 0.0006;
const demBbox = [
  Math.min(...corners.map(c => c.lat)) - pad, Math.min(...corners.map(c => c.lon)) - pad,
  Math.max(...corners.map(c => c.lat)) + pad, Math.max(...corners.map(c => c.lon)) + pad,
];
const DEMPX = +(arg('dempx') || 300);
const dem = await fetchDem(demBbox, DEMPX, `/tmp/golfart/dem_${COURSE}_${HOLE}_${DEMPX}_${PAD}.tif`);

// Resample onto a regular grid in the ROTATED frame so renderers can index it directly.
const GN = +(arg('grid') || 160);
const grid = new Float32Array(GN * GN);
for (let j = 0; j < GN; j++) {
  for (let i = 0; i < GN; i++) {
    const x = frame.x0 + (frame.x1 - frame.x0) * (i / (GN - 1));
    const y = frame.y0 + (frame.y1 - frame.y0) * (j / (GN - 1));
    const g = P0.inv(...Object.values(inv({ x, y })));
    const u = (g.lon - demBbox[1]) / (demBbox[3] - demBbox[1]);
    const v = 1 - (g.lat - demBbox[0]) / (demBbox[2] - demBbox[0]);
    grid[j * GN + i] = sample(dem, u, v);
  }
}
const vals = [...grid].filter(v => v > -1000 && v < 10000);

const bundle = {
  course: course.name, courseId: COURSE, hole: HOLE,
  par: curated.par ?? +line.el.tags.par, yards: curated.yards ?? null,
  frame, features, shots, track,
  terrain: { n: GN, min: Math.min(...vals), max: Math.max(...vals), grid: Array.from(grid) },
};
writeFileSync(OUT, JSON.stringify(bundle));

console.log(`${course.name} — hole ${HOLE} (par ${bundle.par})`);
console.log(`  plate      ${(frame.x1 - frame.x0).toFixed(0)}m x ${(frame.y1 - frame.y0).toFixed(0)}m`);
console.log(`  features   fairway ${features.fairway.length}, bunker ${features.bunker.length}, water ${features.water.length}, tee ${features.tee.length}`);
console.log(`  shots      ${shots.length}  (${holeShots.length - shots.length} without GPS)`);
console.log(`  track      ${track.length} pts`);
console.log(`  relief     ${bundle.terrain.min.toFixed(1)}m → ${bundle.terrain.max.toFixed(1)}m  (${(bundle.terrain.max - bundle.terrain.min).toFixed(1)}m)`);
