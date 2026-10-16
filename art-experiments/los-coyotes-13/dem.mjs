// USGS 3DEP elevation: fetch a float32 GeoTIFF for a WGS84 bbox and parse it.
// Minimal baseline-TIFF reader — the service returns uncompressed float32 strips.
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8, 16: 8 };

export function parseTiff(buf) {
  const le = buf.toString('ascii', 0, 2) === 'II';
  const u16 = o => le ? buf.readUInt16LE(o) : buf.readUInt16BE(o);
  const u32 = o => le ? buf.readUInt32LE(o) : buf.readUInt32BE(o);
  const f32 = o => le ? buf.readFloatLE(o) : buf.readFloatBE(o);

  const tags = {};
  let ifd = u32(4);
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    const tag = u16(e), type = u16(e + 2), n = u32(e + 4);
    const size = (TYPE_SIZE[type] || 1) * n;
    const at = size <= 4 ? e + 8 : u32(e + 8);
    const vals = [];
    for (let j = 0; j < n; j++) {
      const o = at + j * (TYPE_SIZE[type] || 1);
      vals.push(type === 3 ? u16(o) : type === 4 ? u32(o) : type === 11 ? f32(o) : type === 12 ? (le ? buf.readDoubleLE(o) : buf.readDoubleBE(o)) : buf[o]);
    }
    tags[tag] = vals;
  }

  const width = tags[256][0], height = tags[257][0];
  const bits = tags[258][0];
  if (bits !== 32) throw new Error(`expected float32, got ${bits}-bit`);

  const data = new Float32Array(width * height);

  if (tags[324]) {
    // Tiled layout (what 3DEP returns): detile into row-major order.
    const tw = tags[322][0], th = tags[323][0];
    const offsets = tags[324];
    const across = Math.ceil(width / tw);
    for (let t = 0; t < offsets.length; t++) {
      const tx = (t % across) * tw, ty = Math.floor(t / across) * th;
      for (let r = 0; r < th; r++) {
        for (let c = 0; c < tw; c++) {
          const gx = tx + c, gy = ty + r;
          if (gx >= width || gy >= height) continue;
          data[gy * width + gx] = f32(offsets[t] + (r * tw + c) * 4);
        }
      }
    }
  } else {
    const offsets = tags[273], counts = tags[279];
    let w = 0;
    for (let s = 0; s < offsets.length; s++) {
      for (let o = 0; o + 4 <= counts[s] && w < data.length; o += 4) data[w++] = f32(offsets[s] + o);
    }
  }
  return { width, height, data };
}

/** Fetch a DEM grid covering [south,west,north,east]; cached on disk. */
export async function fetchDem(bbox, size = 400, cacheFile = null) {
  const [s, w, n, e] = bbox;
  if (cacheFile && existsSync(cacheFile)) return parseTiff(readFileSync(cacheFile));
  const url = `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage`
    + `?bbox=${w},${s},${e},${n}&bboxSR=4326&size=${size},${size}&format=tiff&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image`;
  let last;
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'golf-caddie-art/0.1' } });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (cacheFile) writeFileSync(cacheFile, buf);
      return parseTiff(buf);
    }
    last = res.status;
    await new Promise(r => setTimeout(r, 1500 * (i + 1)));
  }
  throw new Error(`3DEP fetch failed: ${last}`);
}

/** Bilinear sample by normalized [0..1] grid coords (u right, v down). */
export function sample(dem, u, v) {
  const x = Math.max(0, Math.min(dem.width - 1.001, u * (dem.width - 1)));
  const y = Math.max(0, Math.min(dem.height - 1.001, v * (dem.height - 1)));
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const g = (xx, yy) => dem.data[yy * dem.width + xx];
  return g(x0, y0) * (1 - fx) * (1 - fy) + g(x0 + 1, y0) * fx * (1 - fy)
       + g(x0, y0 + 1) * (1 - fx) * fy + g(x0 + 1, y0 + 1) * fx * fy;
}
