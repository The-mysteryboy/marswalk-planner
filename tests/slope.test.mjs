// The slope map has to agree with the report. A cell has one colour but a route can cross
// it in any direction, so the agreement is one-way and exact: no step of a route can be
// steeper than the steepest cell it crosses. So a route that fails a slope check always
// crosses a cell of that colour, and a route on green alone can never fail one.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DEFAULT_SETTINGS, decideVerdict, measureRoute } from '../js/report.js';
import { SLOPE_COLORS, paintSlopes, slopeAt, slopeBounds, slopeClass, slopeGrid } from '../js/slope.js';
import { loadRealTerrain, readMeta } from './helpers.mjs';

const terrain = await loadRealTerrain('full');
const { meta } = terrain;
const slopes = slopeGrid(meta, terrain.samples);
const w = meta.width - 1;
const h = meta.height - 1;
const settings = { ...DEFAULT_SETTINGS };
const HOME = { lat: 18.44463, lon: 77.45089 };
const DEMO = [HOME, { lat: 18.43396, lon: 77.44302 }, { lat: 18.45263, lon: 77.40776 }, { lat: 18.45865, lon: 77.40592 }, { lat: 18.4669, lon: 77.4298 }];
const SCARP = [...DEMO, { lat: 18.4731, lon: 77.4214 }];

const gridCol = (lon) => ((lon - meta.bounds.west) / (meta.bounds.east - meta.bounds.west)) * meta.width - 0.5;
const gridRow = (lat) => ((meta.bounds.north - lat) / (meta.bounds.north - meta.bounds.south)) * meta.height - 0.5;

/** Index of every cell the straight line from a to b passes through. */
function cellsCrossed(a, b) {
  const [c0, r0, c1, r1] = [gridCol(a.lon), gridRow(a.lat), gridCol(b.lon), gridRow(b.lat)];
  const cuts = [0, 1];
  for (const [from, to] of [[c0, c1], [r0, r1]]) {
    for (let v = Math.ceil(Math.min(from, to)); v <= Math.floor(Math.max(from, to)); v++) {
      if (to !== from) cuts.push((v - from) / (to - from));
    }
  }
  cuts.sort((x, y) => x - y);
  const cells = new Set();
  for (let i = 1; i < cuts.length; i++) {
    const t = (cuts[i - 1] + cuts[i]) / 2;
    cells.add(Math.floor(r0 + (r1 - r0) * t) * w + Math.floor(c0 + (c1 - c0) * t));
  }
  return [...cells];
}

const steepestCrossed = (a, b) => Math.max(...cellsCrossed(a, b).map((i) => slopes[i]));

/** Every step of a route, with the steepest cell it crosses. */
function steps(points, s) {
  const { samples } = measureRoute(points, points[0], terrain, s);
  const out = [];
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].slopeDeg !== null) out.push({ stepDeg: samples[i].slopeDeg, cellDeg: steepestCrossed(samples[i - 1], samples[i]) });
  }
  return out;
}

// A seeded generator, so a failure repeats exactly.
function randomFrom(seed) {
  let x = seed;
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return x / 4294967296;
  };
}

function randomRoute(random) {
  const { bounds: b } = meta;
  const inside = () => ({ lat: b.south + 0.02 + random() * (b.north - b.south - 0.04), lon: b.west + 0.02 + random() * (b.east - b.west - 0.04) });
  const start = inside();
  const points = [start];
  for (let i = 0; i < 3; i++) {
    const last = points.at(-1);
    points.push({
      lat: Math.min(b.north - 0.02, Math.max(b.south + 0.02, last.lat + (random() - 0.5) * 0.05)),
      lon: Math.min(b.east - 0.02, Math.max(b.west + 0.02, last.lon + (random() - 0.5) * 0.05)),
    });
  }
  return points;
}

test('the grid covers every cell between grid centers', () => {
  assert.equal(slopes.length, w * h);
  const bad = slopes.filter((v) => !(v >= 0 && v < 90));
  assert.equal(bad.length, 0, 'the report grid has no missing cells');
});

test('the slope grid and Inspect read the same value', () => {
  const random = randomFrom(11);
  for (let i = 0; i < 2000; i++) {
    const col = Math.floor(random() * w);
    const row = Math.floor(random() * h);
    const lon = meta.bounds.west + ((col + 1) / meta.width) * (meta.bounds.east - meta.bounds.west);
    const lat = meta.bounds.north - ((row + 1) / meta.height) * (meta.bounds.north - meta.bounds.south);
    const shown = slopes[row * w + col];
    assert.ok(Math.abs(slopeAt(terrain, lat, lon) - shown) < 1e-9, `${row},${col}`);
  }
});

test('validated routes: no step beats the cells it crosses', () => {
  for (const points of [DEMO, SCARP]) {
    for (const { stepDeg, cellDeg } of steps(points, settings)) assert.ok(stepDeg <= cellDeg + 1e-3, `${stepDeg} over ${cellDeg}`);
  }
});

test('the NO-GO link crosses red, and the demo crosses yellow where its verdict says', () => {
  const scarp = steps(SCARP, settings);
  const nogoSteps = scarp.filter((x) => x.stepDeg > 25);
  assert.ok(nogoSteps.length > 0);
  for (const x of nogoSteps) assert.equal(slopeClass(x.cellDeg, settings), 'nogo');

  const demo = steps(DEMO, settings);
  const cautionSteps = demo.filter((x) => x.stepDeg > 15);
  assert.ok(cautionSteps.length > 0);
  for (const x of cautionSteps) assert.notEqual(slopeClass(x.cellDeg, settings), 'go');
});

test('500 random routes, at several sample steps and limits: the report never beats the map', () => {
  const random = randomFrom(2026);
  const variants = [
    settings,
    { ...settings, sampleStepM: 20 },
    { ...settings, sampleStepM: 200 },
    { ...settings, cautionSlopeDeg: 5, maxSlopeDeg: 10 },
  ];
  let stepsChecked = 0;
  let onlyGreen = 0;
  for (let n = 0; n < 500; n++) {
    const s = variants[n % variants.length];
    const points = randomRoute(random);
    const m = measureRoute(points, points[0], terrain, s);
    const all = steps(points, s);
    stepsChecked += all.length;
    const worstCell = Math.max(...all.map((x) => x.cellDeg));
    for (const x of all) assert.ok(x.stepDeg <= x.cellDeg + 1e-3, `route ${n}: ${x.stepDeg} over ${x.cellDeg}`);
    // Route level: the verdict's slope rules against the colours the route crosses.
    assert.ok(m.maxSlopeDeg <= worstCell + 1e-3);
    const colours = new Set(all.map((x) => slopeClass(x.cellDeg, s)));
    if (m.maxSlopeDeg > s.maxSlopeDeg) assert.ok(colours.has('nogo'), `route ${n} is No-Go on slope but crosses no red`);
    if (m.maxSlopeDeg > s.cautionSlopeDeg) assert.ok(colours.has('nogo') || colours.has('caution'), `route ${n} crosses only green`);
    if (colours.size === 1 && colours.has('go')) {
      onlyGreen += 1;
      const level = decideVerdict({ ...m, evaUsedH: 0, marginPct: 100 }, s).level;
      assert.equal(level, 'go', `route ${n} is all green but fails a slope check`);
    }
  }
  assert.ok(stepsChecked > 20000, `${stepsChecked} steps`);
  assert.ok(onlyGreen > 0, 'some random route must stay on green, or that rule was never tested');
});

test('map classes use the same limits and the same strict comparison as the verdict', () => {
  const cell = new Float64Array([14.9, 15, 15.1, 25, 25.1, NaN]);
  const px = paintSlopes(cell, settings);
  const hex = (i) => `#${[0, 1, 2].map((k) => px[i * 4 + k].toString(16).padStart(2, '0')).join('')}`;
  assert.deepEqual([0, 1, 2, 3, 4].map(hex), [SLOPE_COLORS.go, SLOPE_COLORS.go, SLOPE_COLORS.caution, SLOPE_COLORS.caution, SLOPE_COLORS.nogo]);
  assert.equal(px[5 * 4 + 3], 0, 'no data is transparent');
  assert.equal(px[3], 255);
});

test('small No-Go text reaches 4.5:1, and the validated map colours did not move', () => {
  const css = readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
  const token = (name) => css.match(new RegExp(`--${name}: (#[0-9a-f]{6})`))[1];
  const channel = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const luminance = (hex) => [1, 3, 5].map((i, n) => [0.2126, 0.7152, 0.0722][n] * channel(parseInt(hex.slice(i, i + 2), 16))).reduce((a, b) => a + b);
  const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  assert.equal(token('nogo'), SLOPE_COLORS.nogo);
  assert.equal(token('caution'), SLOPE_COLORS.caution);
  assert.equal(token('go'), SLOPE_COLORS.go);
  assert.equal(SLOPE_COLORS.nogo, '#f0386b');
  assert.ok(contrast(token('nogo-text'), token('surface-2')) >= 4.5);
  assert.ok(contrast(token('nogo-text'), token('surface')) >= 4.5);
});

test('map colours follow edited limits', () => {
  const px = paintSlopes(new Float64Array([20]), { ...settings, cautionSlopeDeg: 21, maxSlopeDeg: 30 });
  assert.equal(px[1], 0xd3, 'green under the raised limit');
  const again = paintSlopes(new Float64Array([20]), { ...settings, cautionSlopeDeg: 5, maxSlopeDeg: 10 });
  assert.equal(again[0], 0xf0, 'red under the lowered limit');
});

test('a missing grid value leaves its cells without a colour', () => {
  const small = {
    width: 3,
    height: 3,
    nodata: -32768,
    bounds: { north: 1, south: 0, west: 0, east: 1 },
    encoding: { scale: 0.1, offset: 0 },
  };
  const grid = slopeGrid(small, new Int16Array([0, 0, 0, 0, -32768, 0, 0, 0, 0]));
  assert.equal(grid.length, 4);
  assert.ok(grid.every(Number.isNaN), 'the middle value touches all four cells');
});

test('slope image bounds run from the first grid center to the last', () => {
  const meta2 = readMeta();
  const [[south, west], [north, east]] = slopeBounds(meta2);
  const dLat = (meta2.bounds.north - meta2.bounds.south) / meta2.height;
  assert.ok(Math.abs(north - (meta2.bounds.north - dLat / 2)) < 1e-12);
  assert.ok(south > meta2.bounds.south && west > meta2.bounds.west && east < meta2.bounds.east);
});
