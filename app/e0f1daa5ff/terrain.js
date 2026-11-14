// Elevation sampling over the grids built by tools/build_elevation.py.
import { haversineM } from './route.js';

const RAD_TO_DEG = 180 / Math.PI;

export class IntegrityError extends Error {}

/**
 * Undo the 2-D predictor from tools/build_elevation.py, in place. Each cell was
 * stored as itself minus left + above - above-left. Int16Array wraps exactly as
 * the encoder did, so the result is identical to the original samples.
 */
export function decodeGrid(residuals, width, height, fromRow = 0, toRow = height) {
  const s = residuals;
  if (fromRow === 0) {
    for (let c = 1; c < width; c++) s[c] += s[c - 1];
  }
  for (let r = Math.max(fromRow, 1); r < toRow; r++) {
    const row = r * width;
    s[row] += s[row - width];
    for (let i = row + 1; i < row + width; i++) s[i] += s[i - 1] + s[i - width] - s[i - width - 1];
  }
  return s;
}

const ROWS_PER_STEP = 150;

/** Decode a few rows at a time, so a slow phone can still draw between steps. */
export async function decodeGridInSteps(residuals, width, height) {
  for (let from = 0; from < height; from += ROWS_PER_STEP) {
    decodeGrid(residuals, width, height, from, Math.min(from + ROWS_PER_STEP, height));
    await new Promise((resolve) => { setTimeout(resolve); });
  }
  return residuals;
}

/** Throw unless the decoded samples are exactly the ones the build tool wrote. */
export async function verifySamples(samples, expectedSha256) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return; // Only missing on plain-http pages, which never serve the live site.
  const digest = await subtle.digest('SHA-256', samples.buffer);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hex !== expectedSha256) throw new IntegrityError('Elevation data failed its integrity check');
}

/** Build a Terrain from one grid's metadata and the raw bytes of its .bin file. */
export async function terrainFromBytes(meta, bytes) {
  const residuals = new Int16Array(bytes);
  if (meta.encoding.filter !== 'predict-2d') throw new Error(`Unknown grid filter: ${meta.encoding.filter}`);
  if (residuals.length !== meta.width * meta.height) {
    throw new Error(`Elevation grid has ${residuals.length} samples, expected ${meta.width * meta.height}`);
  }
  const samples = await decodeGridInSteps(residuals, meta.width, meta.height);
  await verifySamples(samples, meta.encoding.sha256);
  return new Terrain(meta, samples);
}

async function fetchGrid(meta, urlFor, fetchFn) {
  const read = async (options) => {
    const res = await fetchFn(urlFor(meta.encoding.file), options);
    if (!res.ok) throw new Error(`Elevation grid ${meta.encoding.file}: HTTP ${res.status}`);
    return terrainFromBytes(meta, await res.arrayBuffer());
  };
  try {
    return await read();
  } catch (err) {
    if (!(err instanceof IntegrityError)) throw err;
    // A damaged saved copy. Skip every cache once, and accept nothing unverified.
    return read({ cache: 'reload' });
  }
}

/**
 * Start both downloads and return a promise for each grid. The report grid waits
 * for the preview, so the two never share a slow connection, and it still loads
 * if the preview fails.
 * @param {(name: string) => string} urlFor where a file from data/ is published
 */
export function loadGrids(urlFor, fetchFn = (url, options) => fetch(url, options)) {
  const index = fetchFn(urlFor('terrain.json')).then((res) => {
    if (!res.ok) throw new Error(`Elevation index: HTTP ${res.status}`);
    return res.json();
  });
  const coarse = index.then((i) => fetchGrid(i.coarse, urlFor, fetchFn));
  const full = coarse.catch(() => null).then(() => index).then((i) => fetchGrid(i.full, urlFor, fetchFn));
  return { coarse, full };
}

/**
 * Which grid the app is using, and whether its numbers may be treated as final.
 * Only the full grid is validated, so only it can make the status 'final'.
 */
export class GridProgress {
  terrain = null;
  isFinal = false;
  failed = false;

  offerCoarse(terrain) {
    if (!this.isFinal) this.terrain = terrain;
  }

  offerFull(terrain) {
    this.terrain = terrain;
    this.isFinal = true;
    this.failed = false;
  }

  fullFailed() {
    if (!this.isFinal) this.failed = true;
  }

  /** 'loading', 'refining', 'final', or 'failed' when the report grid did not arrive. */
  get status() {
    if (this.isFinal) return 'final';
    if (this.failed) return 'failed';
    return this.terrain ? 'refining' : 'loading';
  }
}

export class Terrain {
  /**
   * @param {object} meta one grid's entry from the terrain index
   * @param {Int16Array} samples decoded samples
   */
  constructor(meta, samples) {
    const expected = meta.width * meta.height;
    if (samples.length !== expected) {
      throw new Error(`Elevation grid has ${samples.length} samples, expected ${expected}`);
    }
    this.meta = meta;
    this.samples = samples;
    this.source = meta.source;
  }

  /** Grid value in metres at integer indices, or null for nodata. */
  cell(row, col) {
    const v = this.samples[row * this.meta.width + col];
    if (v === this.meta.nodata) return null;
    return v * this.meta.encoding.scale + this.meta.encoding.offset;
  }

  /** Bilinear elevation in metres at a point, or null outside coverage or on nodata. */
  elevationAt(lat, lon) {
    const { bounds: b, width, height } = this.meta;
    // Cell values sit at cell centers, hence the half-cell shift.
    const col = ((lon - b.west) / (b.east - b.west)) * width - 0.5;
    const row = ((b.north - lat) / (b.north - b.south)) * height - 0.5;
    const c0 = Math.floor(col);
    const r0 = Math.floor(row);
    if (c0 < 0 || r0 < 0 || c0 >= width - 1 || r0 >= height - 1) return null;
    const q00 = this.cell(r0, c0);
    const q01 = this.cell(r0, c0 + 1);
    const q10 = this.cell(r0 + 1, c0);
    const q11 = this.cell(r0 + 1, c0 + 1);
    if (q00 === null || q01 === null || q10 === null || q11 === null) return null;
    const fx = col - c0;
    const fy = row - r0;
    return q00 * (1 - fx) * (1 - fy) + q01 * fx * (1 - fy) + q10 * (1 - fx) * fy + q11 * fx * fy;
  }

  /** Slope in degrees between two {lat, lon} points, or null if either is uncovered. */
  slopeDeg(a, b) {
    const za = this.elevationAt(a.lat, a.lon);
    const zb = this.elevationAt(b.lat, b.lon);
    if (za === null || zb === null) return null;
    return slopeFromRise(zb - za, haversineM(a, b));
  }
}

/** Slope in degrees for a rise over a horizontal run, both in metres. */
export function slopeFromRise(riseM, runM) {
  if (runM <= 0) return 0;
  return Math.atan(Math.abs(riseM) / runM) * RAD_TO_DEG;
}
