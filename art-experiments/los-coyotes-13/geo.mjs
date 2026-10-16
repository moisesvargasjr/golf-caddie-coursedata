// Local-meter projection + polygon helpers. No dependencies.
export const R_LAT = 110540, R_LON = 111320;

export function projector(lat0, lon0) {
  const k = Math.cos(lat0 * Math.PI / 180) * R_LON;
  return {
    fwd: (lat, lon) => ({ x: (lon - lon0) * k, y: (lat - lat0) * R_LAT }),
    inv: (x, y) => ({ lat: y / R_LAT + lat0, lon: x / k + lon0 }),
  };
}

export function rotator(theta) {
  const c = Math.cos(theta), s = Math.sin(theta);
  return p => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c });
}

export const centroid = pts => {
  const n = pts.length;
  return { x: pts.reduce((a, p) => a + p.x, 0) / n, y: pts.reduce((a, p) => a + p.y, 0) / n };
};

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Shortest distance from point p to polyline pts. */
export function distToPolyline(p, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

export function bboxOf(groups) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const g of groups) for (const p of g) {
    if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
}

/** Chaikin corner-cutting — softens OSM's angular traced polygons. */
export function smooth(pts, iters = 2, closed = true) {
  let out = pts.slice();
  for (let it = 0; it < iters; it++) {
    const next = [];
    const n = out.length;
    const last = closed ? n : n - 1;
    if (!closed) next.push(out[0]);
    for (let i = 0; i < last; i++) {
      const a = out[i], b = out[(i + 1) % n];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    if (!closed) next.push(out[n - 1]);
    out = next;
  }
  return out;
}
