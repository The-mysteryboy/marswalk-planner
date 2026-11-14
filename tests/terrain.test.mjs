import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Terrain, decodeGrid, decodeGridInSteps, slopeFromRise, terrainFromBytes, verifySamples } from '../js/terrain.js';
import { loadRealTerrain, readGridBytes, readMeta } from './helpers.mjs';

// A tiny 3 x 3 grid with known values, to pin down the bilinear math by hand.
// Stored values are in metres because scale = 1 and offset = 0.
function tinyGrid(values = [0, 10, 20, 0, 10, 20, 0, 10, 20]) {
  return new Terrain({
    width: 3, height: 3, nodata: -32768,
    bounds: { west: 0, east: 3, south: 0, north: 3 },
    encoding: { scale: 1, offset: 0 },
  }, Int16Array.from(values));
}

// The same predictor as tools/build_elevation.py, written independently here.
function encodeGrid(samples, width, height) {
  const at = (r, c) => samples[r * width + c];
  const out = new Int16Array(width * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      let predicted = 0;
      if (r === 0 && c > 0) predicted = at(r, c - 1);
      else if (c === 0 && r > 0) predicted = at(r - 1, c);
      else if (r > 0 && c > 0) predicted = at(r, c - 1) + at(r - 1, c) - at(r - 1, c - 1);
      out[r * width + c] = at(r, c) - predicted;
    }
  }
  return out;
}

const sha = (typed) => createHash('sha256').update(Buffer.from(typed.buffer)).digest('hex');

test('bilinear: exact at a cell center', () => {
  // Center of the top-left cell is (lon 0.5, lat 2.5).
  assert.equal(tinyGrid().elevationAt(2.5, 0.5), 0);
  assert.equal(tinyGrid().elevationAt(1.5, 1.5), 10);
});

test('bilinear: halfway between two centers is their mean', () => {
  assert.equal(tinyGrid().elevationAt(1.5, 1.0), 5);
});

test('bilinear: quarter of the way between centers, by hand', () => {
  // lon 0.75 is a quarter of the way from the 0 m column to the 10 m column.
  assert.equal(tinyGrid().elevationAt(1.5, 0.75), 2.5);
});

test('null outside coverage', () => {
  const t = tinyGrid();
  assert.equal(t.elevationAt(10, 10), null);
  assert.equal(t.elevationAt(-1, 1), null);
  // Outer half cell has no cell center beyond it to interpolate towards.
  assert.equal(t.elevationAt(2.9, 1.5), null);
});

test('null when any neighbouring cell is nodata', () => {
  const t = tinyGrid([0, 10, 20, 0, -32768, 20, 0, 10, 20]);
  assert.equal(t.elevationAt(2.0, 1.0), null);
});

test('rejects a grid of the wrong size', () => {
  assert.throws(() => new Terrain({ width: 3, height: 3 }, new Int16Array(4)), /expected 9/);
});

test('slopeFromRise: hand values', () => {
  assert.ok(Math.abs(slopeFromRise(100, 100) - 45) < 1e-9); // atan(1) = 45 deg
  assert.ok(Math.abs(slopeFromRise(-100, 100) - 45) < 1e-9); // direction does not matter
  assert.equal(slopeFromRise(0, 100), 0);
  assert.equal(slopeFromRise(5, 0), 0); // no run, no slope
});

test('decode: a small grid by hand', () => {
  // Original [[10, 12], [13, 16]]. Residuals: 10, 12-10, 13-10, 16-(13+12-10) = 1.
  assert.deepEqual([...decodeGrid(Int16Array.from([10, 2, 3, 1]), 2, 2)], [10, 12, 13, 16]);
});

test('decode: restores every value, including ones that wrap past 16 bits', () => {
  const width = 37;
  const height = 23;
  const original = new Int16Array(width * height);
  let seed = 12345;
  for (let i = 0; i < original.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    original[i] = (seed % 65536) - 32768; // Full Int16 range, so residuals overflow.
  }
  original[100] = -32768; // The nodata value must survive too.
  assert.deepEqual([...decodeGrid(encodeGrid(original, width, height), width, height)], [...original]);
});

test('decode: in steps gives exactly the same grid as all at once', async () => {
  const meta = readMeta();
  const whole = decodeGrid(new Int16Array(readGridBytes(meta)), meta.width, meta.height);
  const stepped = await decodeGridInSteps(new Int16Array(readGridBytes(meta)), meta.width, meta.height);
  assert.equal(sha(stepped), sha(whole));
  assert.equal(sha(stepped), meta.encoding.sha256);
});

test('decode: in steps handles a grid shorter than one step', async () => {
  assert.deepEqual([...await decodeGridInSteps(Int16Array.from([10, 2, 3, 1]), 2, 2)], [10, 12, 13, 16]);
});

test('decode: single row and single column grids', () => {
  assert.deepEqual([...decodeGrid(encodeGrid(Int16Array.from([5, -3, 9]), 3, 1), 3, 1)], [5, -3, 9]);
  assert.deepEqual([...decodeGrid(encodeGrid(Int16Array.from([5, -3, 9]), 1, 3), 1, 3)], [5, -3, 9]);
});

test('integrity: accepts matching samples and rejects any other', async () => {
  const samples = Int16Array.from([1, 2, 3, 4]);
  await verifySamples(samples, sha(samples));
  await assert.rejects(verifySamples(Int16Array.from([1, 2, 3, 5]), sha(samples)), /integrity/);
});

const smallMeta = (samples, over = {}) => ({
  width: 2, height: 2, nodata: -32768, bounds: { west: 0, east: 2, south: 0, north: 2 },
  encoding: { scale: 1, offset: 0, filter: 'predict-2d', sha256: sha(samples), ...over },
});

test('terrainFromBytes: decodes, checks, and rejects a bad file', async () => {
  const samples = Int16Array.from([10, 12, 13, 16]);
  const residuals = encodeGrid(samples, 2, 2);
  const t = await terrainFromBytes(smallMeta(samples), residuals.slice().buffer);
  assert.equal(t.cell(1, 1), 16);
  await assert.rejects(terrainFromBytes(smallMeta(samples), new Int16Array(3).buffer), /expected 4/);
  await assert.rejects(terrainFromBytes(smallMeta(samples, { filter: 'mystery' }), residuals.slice().buffer), /Unknown grid filter/);
  const undecoded = samples.slice().buffer; // Heights passed off as residuals must not load.
  await assert.rejects(terrainFromBytes(smallMeta(samples), undecoded), /integrity/);
});

test('real grid: the shipped file passes its integrity check', async () => {
  const t = await loadRealTerrain();
  assert.equal(t.samples.length, t.meta.width * t.meta.height);
  assert.equal(sha(t.samples), '0391d9c111d53b4f971c379fff1b4e0e0f9fa54463297a4d4d3de9ad7191cec4');
});

test('real grid: one changed byte is caught', async () => {
  const meta = readMeta();
  const bytes = new Uint8Array(readGridBytes(meta));
  bytes[2000000] ^= 1;
  await assert.rejects(terrainFromBytes(meta, bytes.buffer), /integrity/);
});

test('real grid: matches the Python sampler at named points', async () => {
  const t = await loadRealTerrain();
  // Expected values printed by tools/build_elevation.py.
  assert.ok(Math.abs(t.elevationAt(18.4082, 77.6873) - -2628.4) < 0.1);
  assert.ok(Math.abs(t.elevationAt(18.44462715, 77.45088572) - -2567.4) < 0.1);
});

test('real grid: crater floor sits below the rim', async () => {
  const t = await loadRealTerrain();
  assert.ok(t.elevationAt(18.4446, 77.4509) < t.elevationAt(18.4356, 77.2332));
});

test('real grid: matches rover-measured elevation at the landing site within 5 m', async () => {
  // M20_waypoints.json, sol 13: elev_geoid = -2569.91 m.
  const t = await loadRealTerrain();
  assert.ok(Math.abs(t.elevationAt(18.44462715, 77.45088572) - -2569.91) < 5);
});
