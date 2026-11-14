// The safest route must never be one the report calls NO-GO because of slope.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cellFrame, cellsBetween, findRoute, noRouteText } from '../js/pathfind.js';
import { presetSettings } from '../js/presets.js';
import { DEFAULT_SETTINGS, decideVerdict, measureRoute } from '../js/report.js';
import { pathLengthM } from '../js/route.js';
import { slopeGrid } from '../js/slope.js';
import { loadRealTerrain } from './helpers.mjs';

const terrain = await loadRealTerrain('full');
const { meta } = terrain;
const slopes = slopeGrid(meta, terrain.samples);
const limits = { cautionSlopeDeg: 15, maxSlopeDeg: 25 };
const HOME = { lat: 18.44463, lon: 77.45089 };
// The two ends of the leg that fails the report on the scarp.
const FOOT = { lat: 18.4669, lon: 77.4298 };
const TOP = { lat: 18.4731, lon: 77.4214 };

const report = (points, s = DEFAULT_SETTINGS) => {
  const m = measureRoute(points, points[0], terrain, s);
  return { m, verdict: decideVerdict(m, s) };
};
const slopeFailed = (r) => r.verdict.reasons.some((x) => x.level === 'nogo' && x.text.startsWith('Slope'));

test('the straight line up the scarp fails, and the found route detours around it', () => {
  const straight = report([FOOT, TOP]);
  assert.ok(slopeFailed(straight), `straight line reads ${straight.m.maxSlopeDeg}`);

  const found = findRoute(slopes, meta, FOOT, TOP, limits);
  assert.ok(found.points, JSON.stringify(found));
  const r = report(found.points);
  assert.ok(r.m.maxSlopeDeg <= 25, `found route reads ${r.m.maxSlopeDeg}`);
  assert.ok(!slopeFailed(r));
  assert.ok(pathLengthM(found.points) > pathLengthM([FOOT, TOP]) * 1.1, 'it must go around, not over');
});

test('the found route starts and ends on the exact points asked for', () => {
  const { points } = findRoute(slopes, meta, FOOT, TOP, limits);
  assert.deepEqual(points[0], FOOT);
  assert.deepEqual(points.at(-1), TOP);
});

test('from the habitat to the scarp top, the report never fails on slope', () => {
  const { points } = findRoute(slopes, meta, HOME, TOP, limits);
  const r = report(points);
  assert.ok(!slopeFailed(r), `${r.m.maxSlopeDeg}`);
  assert.ok(points.length < 200, `${points.length} points is not an editable route`);
});

test('random pairs across the grid, at several limits and sample steps: never NO-GO on slope', () => {
  let x = 7;
  const random = () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return x / 4294967296;
  };
  const { bounds: b } = meta;
  const variants = [
    DEFAULT_SETTINGS,
    { ...DEFAULT_SETTINGS, sampleStepM: 20 },
    { ...DEFAULT_SETTINGS, sampleStepM: 200 },
    presetSettings('cautious'),
    presetSettings('ambitious'),
  ];
  let found = 0;
  let refused = 0;
  for (let n = 0; n < 60; n++) {
    const s = variants[n % variants.length];
    const start = { lat: b.south + 0.05 + random() * 0.9, lon: b.west + 0.05 + random() * 1.0 };
    const goal = { lat: start.lat + (random() - 0.5) * 0.08, lon: start.lon + (random() - 0.5) * 0.08 };
    const result = findRoute(slopes, meta, start, goal, s);
    if (result.none) {
      refused += 1;
      continue;
    }
    found += 1;
    const r = report(result.points, s);
    assert.ok(r.m.maxSlopeDeg <= s.maxSlopeDeg, `pair ${n}: ${r.m.maxSlopeDeg} over ${s.maxSlopeDeg}`);
    assert.ok(!slopeFailed(r), `pair ${n}`);
    assert.ok(!r.m.leavesCoverage, `pair ${n} left the data`);
  }
  assert.ok(found > 30, `${found} found, ${refused} refused`);
});

test('every line of the result stays on allowed cells', () => {
  const frame = cellFrame(meta);
  const { points } = findRoute(slopes, meta, FOOT, TOP, limits);
  for (let i = 1; i < points.length; i++) {
    const a = { row: frame.row(points[i - 1].lat), col: frame.col(points[i - 1].lon) };
    const b = { row: frame.row(points[i].lat), col: frame.col(points[i].lon) };
    for (const cell of cellsBetween(a, b, frame.w)) assert.ok(slopes[cell] <= 25, `leg ${i} crosses ${slopes[cell]}°`);
  }
});

// A 6 by 6 cell test grid with a chosen slope in each cell.
function tinyGrid(fill) {
  const small = { width: 7, height: 7, bounds: { north: 1, south: 0, west: 0, east: 1 } };
  const grid = new Float64Array(36);
  for (let row = 0; row < 6; row++) for (let col = 0; col < 6; col++) grid[row * 6 + col] = fill(row, col);
  return { small, grid };
}
const cellPoint = (small, row, col) => cellFrame(small).point(row + 0.5, col + 0.5);

test('a full wall means no route, and says so', () => {
  const { small, grid } = tinyGrid((row, col) => (col === 3 ? 40 : 1));
  const result = findRoute(grid, small, cellPoint(small, 2, 0), cellPoint(small, 2, 5), limits);
  assert.deepEqual(result, { none: 'no-path' });
});

test('a gap in the wall is found, even a one-cell gap', () => {
  const { small, grid } = tinyGrid((row, col) => (col === 3 && row !== 5 ? 40 : 1));
  const result = findRoute(grid, small, cellPoint(small, 0, 0), cellPoint(small, 0, 5), limits);
  assert.ok(result.points, JSON.stringify(result));
});

test('a route cannot squeeze diagonally between two walls', () => {
  const { small, grid } = tinyGrid((row, col) => ((row < 3 && col === 3) || (row >= 3 && col === 2) ? 40 : 1));
  const result = findRoute(grid, small, cellPoint(small, 0, 0), cellPoint(small, 5, 5), limits);
  assert.deepEqual(result, { none: 'no-path' });
});

test('gentle ground is preferred to steep ground that is still allowed', () => {
  // Wide enough that going round is cheaper than crossing. A thin band is worth crossing.
  const { small, grid } = tinyGrid((row, col) => (col >= 1 && col <= 4 && row < 5 ? 24 : 1));
  const result = findRoute(grid, small, cellPoint(small, 0, 0), cellPoint(small, 0, 5), limits);
  const frame = cellFrame(small);
  const crossed = new Set();
  for (let i = 1; i < result.points.length; i++) {
    const at = (p) => ({ row: frame.row(p.lat), col: frame.col(p.lon) });
    for (const c of cellsBetween(at(result.points[i - 1]), at(result.points[i]), frame.w)) crossed.add(c);
  }
  assert.ok([...crossed].every((c) => grid[c] === 1), 'it should go round the 24° band');
});

test('impossible ends are refused with their own reason', () => {
  const outside = { lat: 19.05, lon: 77.4 };
  assert.deepEqual(findRoute(slopes, meta, outside, TOP, limits), { none: 'start-no-data' });
  assert.deepEqual(findRoute(slopes, meta, FOOT, outside, limits), { none: 'goal-no-data' });
  const { small, grid } = tinyGrid((row, col) => (col === 0 || col === 5 ? 40 : 1));
  assert.deepEqual(findRoute(grid, small, cellPoint(small, 2, 0), cellPoint(small, 2, 2), limits), { none: 'start-too-steep' });
  assert.deepEqual(findRoute(grid, small, cellPoint(small, 2, 2), cellPoint(small, 2, 5), limits), { none: 'goal-too-steep' });
});

test('every refusal has a plain sentence naming the limit', () => {
  for (const reason of ['no-path', 'start-too-steep', 'goal-too-steep']) {
    assert.match(noRouteText(reason, limits), /25° .*\(assumption\)/, reason);
  }
  for (const reason of ['start-no-data', 'goal-no-data']) assert.match(noRouteText(reason, limits), /no elevation data/);
});
