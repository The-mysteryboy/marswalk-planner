// Steepest slope of each elevation grid cell, for Check a point and the slope map.
// Pure functions with no DOM, so the worker and the tests run this same code.
//
// The report measures slope along a route, between samples about 50 m apart, on the
// bilinear surface in terrain.js. Here a cell is one bilinear patch between four grid
// values, and its value is the steepest gradient anywhere inside it. On that surface
// the gradient's size is largest at a corner, so the four corners are enough. A step
// along a route averages its grade over the ground it crosses, which can never beat
// the steepest gradient on that ground. So every route step is at or below the highest
// value among the cells it crosses, whatever its direction or length.
//
// That is a one-way rule, and it has to be: a cell has one colour but a route can cross
// it in any direction. A route along the contour of a red cell can be gentle. A route
// that only touches green cells can never fail a slope check.
import { MARS_RADIUS_M } from './route.js';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** The same comparisons as decideVerdict. Exactly at a limit passes. */
export function slopeClass(deg, settings) {
  if (deg > settings.maxSlopeDeg) return 'nogo';
  if (deg > settings.cautionSlopeDeg) return 'caution';
  return 'go';
}

// Grid values sit at cell centers, so patch rows and columns run between centers.
function patchSize(meta) {
  const { bounds: b, width, height } = meta;
  const dLat = (b.north - b.south) / height;
  const dLon = (b.east - b.west) / width;
  return { dLat, dLon, dyM: MARS_RADIUS_M * dLat * RAD, unitDxM: MARS_RADIUS_M * dLon * RAD };
}

/** The patch's width in metres, taken at its poleward edge, where it is narrowest. */
function patchWidthM(meta, size, row) {
  const top = meta.bounds.north - (row + 0.5) * size.dLat;
  const bottom = top - size.dLat;
  return size.unitDxM * Math.min(Math.cos(top * RAD), Math.cos(bottom * RAD));
}

function steepestDeg(q00, q01, q10, q11, dxM, dyM) {
  const across = Math.max(Math.abs(q01 - q00), Math.abs(q11 - q10)) / dxM;
  const along = Math.max(Math.abs(q10 - q00), Math.abs(q11 - q01)) / dyM;
  return Math.atan(Math.hypot(across, along)) * DEG;
}

/** Steepest slope in degrees of the cell holding a point, or null with no data there. */
export function slopeAt(terrain, lat, lon) {
  const { meta } = terrain;
  const { bounds: b, width, height } = meta;
  const col = Math.floor(((lon - b.west) / (b.east - b.west)) * width - 0.5);
  const row = Math.floor(((b.north - lat) / (b.north - b.south)) * height - 0.5);
  if (col < 0 || row < 0 || col >= width - 1 || row >= height - 1) return null;
  const q00 = terrain.cell(row, col);
  const q01 = terrain.cell(row, col + 1);
  const q10 = terrain.cell(row + 1, col);
  const q11 = terrain.cell(row + 1, col + 1);
  if (q00 === null || q01 === null || q10 === null || q11 === null) return null;
  const size = patchSize(meta);
  return steepestDeg(q00, q01, q10, q11, patchWidthM(meta, size, row), size.dyM);
}

/** Map bounds of the slope image: from the first grid center to the last. */
export function slopeBounds(meta) {
  const { dLat, dLon } = patchSize(meta);
  const b = meta.bounds;
  return [[b.south + dLat / 2, b.west + dLon / 2], [b.north - dLat / 2, b.east - dLon / 2]];
}

/** Every cell's steepest slope in degrees, NaN where there is no data. */
export function slopeGrid(meta, samples) {
  const w = meta.width - 1;
  const h = meta.height - 1;
  const { scale } = meta.encoding;
  const size = patchSize(meta);
  const out = new Float64Array(w * h);
  let at = 0;
  for (let row = 0; row < h; row++) {
    const dxM = patchWidthM(meta, size, row);
    const above = row * meta.width;
    const below = above + meta.width;
    for (let col = 0; col < w; col++, at++) {
      const a = samples[above + col];
      const b = samples[above + col + 1];
      const c = samples[below + col];
      const d = samples[below + col + 1];
      const missing = a === meta.nodata || b === meta.nodata || c === meta.nodata || d === meta.nodata;
      out[at] = missing ? NaN : steepestDeg(a * scale, b * scale, c * scale, d * scale, dxM, size.dyM);
    }
  }
  return out;
}

// The app's own Go, Caution and No-Go colours, so the map and the verdict read the same.
export const SLOPE_COLORS = Object.freeze({ go: '#46d39a', caution: '#ffec80', nogo: '#f0386b' });

function rgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

/** Colour every cell into an RGBA buffer. Cells with no data stay fully transparent. */
export function paintSlopes(slopes, settings, pixels = new Uint8ClampedArray(slopes.length * 4)) {
  const colors = { go: rgb(SLOPE_COLORS.go), caution: rgb(SLOPE_COLORS.caution), nogo: rgb(SLOPE_COLORS.nogo) };
  for (let i = 0, p = 0; i < slopes.length; i++, p += 4) {
    const deg = slopes[i];
    if (Number.isNaN(deg)) {
      pixels[p + 3] = 0;
      continue;
    }
    const c = colors[slopeClass(deg, settings)];
    pixels[p] = c[0];
    pixels[p + 1] = c[1];
    pixels[p + 2] = c[2];
    pixels[p + 3] = 255;
  }
  return pixels;
}
