// Shared rendering core: terrain sampling, landcover rasterising, camera
// projection and SVG assembly. Art direction lives in the style objects.

export function terrain(bundle, smoothPasses = 0) {
  const { frame } = bundle, T = bundle.terrain, n = T.n;
  for (let pass = 0; pass < smoothPasses; pass++) {
    const src = T.grid.slice();
    for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
      let acc = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) acc += src[(j + dj) * n + i + di];
      T.grid[j * n + i] = acc / 9;
    }
  }
  const z = (x, y) => {
    const u = (x - frame.x0) / (frame.x1 - frame.x0) * (n - 1);
    const v = (y - frame.y0) / (frame.y1 - frame.y0) * (n - 1);
    const i = Math.max(0, Math.min(n - 2, Math.floor(u))), j = Math.max(0, Math.min(n - 2, Math.floor(v)));
    const fu = u - i, fv = v - j, g = (a, b) => T.grid[b * n + a];
    return g(i, j) * (1 - fu) * (1 - fv) + g(i + 1, j) * fu * (1 - fv)
         + g(i, j + 1) * (1 - fu) * fv + g(i + 1, j + 1) * fu * fv;
  };
  return { z, min: T.min, max: T.max };
}

/** Camera: pitch 0 = straight down, 90 = ground level. */
export function camera(bundle, { pitch = 0, exaggeration = 1, perspective = 0, width = 1000 }) {
  const { frame } = bundle;
  const th = pitch * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th);
  const cx = (frame.x0 + frame.x1) / 2, cy = (frame.y0 + frame.y1) / 2;
  const z0 = bundle.terrain.min;

  const raw = (x, y, z = z0) => {
    const dy = y - cy;
    const depth = (dy - (frame.y0 - cy)) / (frame.y1 - frame.y0); // 0 near, 1 far
    const k = perspective ? 1 / (1 + perspective * depth) : 1;
    return { X: (x - cx) * k, Y: (-dy * cs - (z - z0) * exaggeration * sn) * k };
  };

  // Fit the projected extent to the requested pixel width.
  let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
  for (let i = 0; i <= 24; i++) for (let j = 0; j <= 24; j++) {
    const x = frame.x0 + (frame.x1 - frame.x0) * i / 24;
    const y = frame.y0 + (frame.y1 - frame.y0) * j / 24;
    for (const zz of [bundle.terrain.min, bundle.terrain.max]) {
      const p = raw(x, y, zz);
      X0 = Math.min(X0, p.X); X1 = Math.max(X1, p.X);
      Y0 = Math.min(Y0, p.Y); Y1 = Math.max(Y1, p.Y);
    }
  }
  const pad = 40;
  const scale = (width - pad * 2) / (X1 - X0);
  const height = Math.round((Y1 - Y0) * scale + pad * 2);
  const project = (x, y, z = z0) => {
    const p = raw(x, y, z);
    return [(p.X - X0) * scale + pad, (p.Y - Y0) * scale + pad];
  };
  return { project, width, height, scale };
}

// --- Landcover -------------------------------------------------------------

const inRing = (p, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};
const inShape = (p, rings) => rings.reduce((acc, r) => acc !== inRing(p, r), false);

/** Priority order — later wins where features overlap. */
export const COVERS = ['rough', 'fairway', 'green', 'bunker', 'water'];

export function coverAt(bundle, x, y) {
  const p = { x, y }, f = bundle.features;
  if (f.water.some(s => inShape(p, s))) return 'water';
  if (f.bunker.some(s => inShape(p, s))) return 'bunker';
  if (f.green.some(s => inShape(p, s))) return 'green';
  if (f.tee.some(s => inShape(p, s))) return 'fairway';
  if (f.fairway.some(s => inShape(p, s))) return 'fairway';
  return 'rough';
}

/** Hillshade 0..1 from the terrain normal. */
export function hillshade(z, x, y, step, { azimuth = 315, altitude = 45 } = {}) {
  const dzdx = (z(x + step, y) - z(x - step, y)) / (2 * step);
  const dzdy = (z(x, y + step) - z(x, y - step)) / (2 * step);
  const az = azimuth * Math.PI / 180, al = altitude * Math.PI / 180;
  const nx = -dzdx, ny = -dzdy, nz = 1;
  const len = Math.hypot(nx, ny, nz);
  const lx = Math.cos(al) * Math.sin(az), ly = -Math.cos(al) * Math.cos(az), lz = Math.sin(al);
  return Math.max(0, (nx * lx + ny * ly + nz * lz) / len);
}

// --- Colour helpers --------------------------------------------------------

export const hex = ({ r, g, b }) =>
  '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
export const rgb = h => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) });
export const mix = (a, b, t) => ({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
export const shade = (c, k) => ({ r: c.r * k, g: c.g * k, b: c.b * k });

// --- Geometry → SVG --------------------------------------------------------

export const pathOf = (rings, project, z) =>
  rings.map(r => 'M' + r.map(p => project(p.x, p.y, z ? z(p.x, p.y) : undefined).map(v => v.toFixed(1)).join(',')).join('L') + 'Z').join(' ');

export const lineOf = (pts, project, z) =>
  'M' + pts.map(p => project(p.x, p.y, z ? z(p.x, p.y) : undefined).map(v => v.toFixed(1)).join(',')).join('L');

/** Marching squares over the terrain grid → contour polylines at one level. */
export function contour(bundle, level) {
  const { frame } = bundle, T = bundle.terrain, n = T.n;
  const gx = i => frame.x0 + (frame.x1 - frame.x0) * i / (n - 1);
  const gy = j => frame.y0 + (frame.y1 - frame.y0) * j / (n - 1);
  const segs = [];
  const lerp = (p, q, a, b) => { const t = (level - a) / (b - a); return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }; };
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const v = [T.grid[j * n + i], T.grid[j * n + i + 1], T.grid[(j + 1) * n + i + 1], T.grid[(j + 1) * n + i]];
    const c = [{ x: gx(i), y: gy(j) }, { x: gx(i + 1), y: gy(j) }, { x: gx(i + 1), y: gy(j + 1) }, { x: gx(i), y: gy(j + 1) }];
    const idx = v.map(a => a > level ? 1 : 0);
    const pts = [];
    for (let e = 0; e < 4; e++) {
      const a = e, b = (e + 1) % 4;
      if (idx[a] !== idx[b]) pts.push(lerp(c[a], c[b], v[a], v[b]));
    }
    if (pts.length === 2) segs.push(pts);
  }
  return segs;
}

export const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/**
 * True perspective camera positioned behind the tee, looking up the hole —
 * the framing a player actually stands in. Returns a projector plus the
 * camera-space depth needed for painter's-algorithm sorting and haze.
 */
export function flyCamera(bundle, ground, {
  back = 150, up = 95, targetAlong = 0.78, fov = 38, width = 1400, height = 900, roll = 0, shift = 0,
} = {}) {
  const spine = bundle.features.spine;
  const tee = spine[0], green = spine[spine.length - 1];
  const len = Math.hypot(green.x - tee.x, green.y - tee.y);
  const dir = { x: (green.x - tee.x) / len, y: (green.y - tee.y) / len };

  const eye = {
    x: tee.x - dir.x * back + dir.y * roll,
    y: tee.y - dir.y * back - dir.x * roll,
    z: ground(tee.x, tee.y) + up,
  };
  const tx = tee.x + dir.x * len * targetAlong, ty = tee.y + dir.y * len * targetAlong;
  const target = { x: tx, y: ty, z: ground(tx, ty) };

  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const norm = v => { const l = Math.hypot(v.x, v.y, v.z); return { x: v.x / l, y: v.y / l, z: v.z / l }; };
  const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

  const f = norm(sub(target, eye));
  const r = norm(cross(f, { x: 0, y: 0, z: 1 }));
  const u = cross(r, f);
  const focal = (width / 2) / Math.tan(fov * Math.PI / 360);

  const project = (x, y, z) => {
    const v = { x: x - eye.x, y: y - eye.y, z: (z ?? ground(x, y)) - eye.z };
    const cz = dot(v, f);
    if (cz < 1) return null;
    return [width / 2 + dot(v, r) / cz * focal, height / 2 + shift - dot(v, u) / cz * focal, cz];
  };
  return { project, eye, width, height, focal, horizonY: height / 2 + (f.z / Math.hypot(f.x, f.y)) * focal };
}
