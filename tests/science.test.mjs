// Reachable science and the rover path, checked by code written apart from the app's: its
// own grid reading, distance, walking model and flood fill. Nothing below the imports of
// the code under test is shared with them.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { checkStop, basisLine, reachHtml, slopeWords, stopTag, summaryLine, timeWords } from '../js/reach.js';
import { DEFAULT_SETTINGS, measureRoute, turnBackPoint } from '../js/report.js';
import { CLASSES, classNames, decodeRoverPath, roverClasses, roverLines } from '../js/roverpath.js';
import { presetSettings } from '../js/presets.js';
import { slopeGrid } from '../js/slope.js';
import { dataPath, loadRealTerrain } from './helpers.mjs';

const terrain = await loadRealTerrain('full');
const slopes = slopeGrid(terrain.meta, terrain.samples);
const stops = JSON.parse(readFileSync(dataPath('science_stops.json'), 'utf8')).stops;
const roverFile = JSON.parse(readFileSync(dataPath('rover_slopes.json'), 'utf8'));
const steps = decodeRoverPath(roverFile);
const STANDARD = { ...DEFAULT_SETTINGS };
const stopNamed = (id) => stops.find((s) => s.id === id);
const HOME = { lat: stopNamed('oeb').lat, lon: stopNamed('oeb').lon };
const check = (id, settings = STANDARD) => checkStop(stopNamed(id), HOME, terrain, slopes, settings);

// --- The separate calculation ------------------------------------------------------
const { meta, samples } = terrain;
const RADIUS = 3389500;

function ownHeight(lat, lon) {
  const { west, east, north, south } = meta.bounds;
  const x = ((lon - west) / (east - west)) * meta.width - 0.5;
  const y = ((north - lat) / (north - south)) * meta.height - 0.5;
  const left = Math.floor(x);
  const top = Math.floor(y);
  const at = (r, c) => samples[r * meta.width + c] * meta.encoding.scale + meta.encoding.offset;
  const upper = at(top, left) + (at(top, left + 1) - at(top, left)) * (x - left);
  const lower = at(top + 1, left) + (at(top + 1, left + 1) - at(top + 1, left)) * (x - left);
  return upper + (lower - upper) * (y - top);
}

function ownDistance(a, b) {
  const unit = (p) => {
    const la = (p.lat * Math.PI) / 180;
    const lo = (p.lon * Math.PI) / 180;
    return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  };
  const [u, v] = [unit(a), unit(b)];
  return 2 * RADIUS * Math.asin(Math.min(1, Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]) / 2));
}

const ownSpeed = (grade, base) => (base * Math.exp(-3.5 * Math.abs(grade + 0.05))) / Math.exp(-3.5 * 0.05);

// Evenly spaced points on a straight line in degrees, then the report's sums by hand. The
// app follows the great circle, a few metres away over 7 km, so slopes agree to about 0.05°.
function ownWalk(points, settings) {
  let walked = 0;
  let hours = settings.scienceMinutes / 60;
  let steepest = 0;
  let steepestAt = 0;
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const length = ownDistance(a, b);
    const parts = Math.max(1, Math.ceil(length / settings.sampleStepM));
    let low = ownHeight(a.lat, a.lon);
    for (let k = 1; k <= parts; k++) {
      const high = ownHeight(a.lat + ((b.lat - a.lat) * k) / parts, a.lon + ((b.lon - a.lon) * k) / parts);
      const run = length / parts;
      const grade = (high - low) / run;
      const deg = (Math.atan(Math.abs(grade)) * 180) / Math.PI;
      walked += run;
      hours += run / 1000 / ownSpeed(grade, settings.baseSpeedKmh) + run / 1000 / ownSpeed(-grade, settings.baseSpeedKmh);
      if (deg > steepest) {
        steepest = deg;
        steepestAt = walked;
      }
      low = high;
    }
  }
  return { distanceM: walked, steepest, steepestAt, hours };
}

function assertMatches(used, points, settings) {
  const own = ownWalk(points, settings);
  assert.ok(Math.abs(own.distanceM - used.distanceM) < 0.5, `distance ${own.distanceM} against ${used.distanceM}`);
  assert.ok(Math.abs(own.steepest - used.maxSlopeDeg) < 0.05, `slope ${own.steepest} against ${used.maxSlopeDeg}`);
  assert.ok(Math.abs(own.steepestAt - used.maxSlopeAtM) < 1, `where ${own.steepestAt} against ${used.maxSlopeAtM}`);
  assert.ok(Math.abs(own.hours - used.evaUsedH) < 0.002, `time ${own.hours} against ${used.evaUsedH}`);
}

// Each grid cell's steepest corner gradient, then a flood fill from the base across cells
// at or under the limit. It answers one thing: can the stop be reached at all?
function ownCellSlope(row, col) {
  const { north, south, west, east } = meta.bounds;
  const toRad = Math.PI / 180;
  const stepLat = (north - south) / meta.height;
  const stepLon = (east - west) / meta.width;
  const dy = RADIUS * stepLat * toRad;
  const topLat = north - (row + 0.5) * stepLat;
  const dx = RADIUS * stepLon * toRad * Math.min(Math.cos(topLat * toRad), Math.cos((topLat - stepLat) * toRad));
  const at = (r, c) => samples[r * meta.width + c];
  const corners = [at(row, col), at(row, col + 1), at(row + 1, col), at(row + 1, col + 1)];
  if (corners.includes(meta.nodata)) return NaN;
  const [a, b, c, d] = corners.map((v) => v * meta.encoding.scale);
  const across = Math.max(Math.abs(b - a), Math.abs(d - c)) / dx;
  const along = Math.max(Math.abs(c - a), Math.abs(d - b)) / dy;
  return (Math.atan(Math.hypot(across, along)) * 180) / Math.PI;
}

function canReach(from, to, limit) {
  const { north, south, west, east } = meta.bounds;
  const w = meta.width - 1;
  const h = meta.height - 1;
  const stepLat = (north - south) / meta.height;
  const stepLon = (east - west) / meta.width;
  const cell = (p) => [Math.floor((north - stepLat / 2 - p.lat) / stepLat), Math.floor((p.lon - west - stepLon / 2) / stepLon)];
  const [startRow, startCol] = cell(from);
  const [goalRow, goalCol] = cell(to);
  const open = (r, c) => ownCellSlope(r, c) <= limit;
  if (!open(startRow, startCol) || !open(goalRow, goalCol)) return false;
  const seen = new Uint8Array(w * h);
  const queue = [[startRow, startCol]];
  seen[startRow * w + startCol] = 1;
  while (queue.length) {
    const [r, c] = queue.pop();
    if (r === goalRow && c === goalCol) return true;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const [nr, nc] = [r + dr, c + dc];
      if (nr < 0 || nc < 0 || nr >= h || nc >= w || seen[nr * w + nc] || !open(nr, nc)) continue;
      seen[nr * w + nc] = 1;
      queue.push([nr, nc]);
    }
  }
  return false;
}

// --- Reachable science --------------------------------------------------------------
test('Standard: every stop, from the separate calculation, matches the app', () => {
  for (const stop of stops) {
    const r = check(stop.id);
    assert.equal(r.route, 'straight', stop.id);
    assert.ok(r.slopeOk && r.timeOk, stop.id);
    if (!r.atBase) assertMatches(r.used, r.points, STANDARD);
  }
});

test('a stop reachable by the straight route: Brac', () => {
  const r = check('brac');
  assert.equal(r.route, 'straight');
  assert.equal(slopeWords(r), 'SLOPE: yes, by the straight route');
  assert.equal(timeWords(r), 'TIME: the round trip fits');
  assert.equal(r.points.length, 2);
  assert.equal((r.used.distanceM / 1000).toFixed(2), '0.77');
  assert.equal(r.used.maxSlopeDeg.toFixed(1), '2.5');
  assertMatches(r.used, r.points, STANDARD);
});

test('a stop reachable only by the safest route: Comet Geyser under an 8° limit', () => {
  const settings = { ...STANDARD, maxSlopeDeg: 8, cautionSlopeDeg: 8 };
  const r = check('cometgeyser', settings);
  assert.ok(r.straight.maxSlopeDeg > 8);
  assert.equal(r.route, 'safest');
  assert.ok(r.points.length > 2);
  assert.ok(r.used.maxSlopeDeg <= 8);
  assert.ok(r.used.distanceM > r.straight.distanceM);
  assertMatches(r.used, r.points, settings);
  assert.ok(canReach(HOME, stopNamed('cometgeyser'), 8));
  assert.ok(slopeWords(r).startsWith('SLOPE: yes, by the safest route. The straight route reaches 10.4°'));
});

test('a stop not reachable: Cheyava Falls under an 8° limit, confirmed by a flood fill', () => {
  const settings = { ...STANDARD, maxSlopeDeg: 8, cautionSlopeDeg: 8 };
  const r = check('cheyava', settings);
  assert.ok(r.straight.maxSlopeDeg > 8);
  assert.equal(r.route, 'none');
  assert.equal(r.slopeOk, false);
  assert.equal(r.points.length, 0);
  assert.equal(slopeWords(r), 'SLOPE: not reachable under our assumed slope limit');
  assert.equal(timeWords(r), 'TIME: not checked, no route');
  assert.equal(canReach(HOME, stopNamed('cheyava'), 8), false);
});

test('the flood fill agrees with the app across limits and stops', () => {
  for (const limit of [8, 5, 4]) {
    const settings = { ...STANDARD, maxSlopeDeg: limit, cautionSlopeDeg: limit };
    for (const id of ['rochette', 'threeforks', 'skinner']) {
      const r = check(id, settings);
      if (r.route === 'straight') continue; // Only the search needs the fill.
      assert.equal(r.slopeOk, canReach(HOME, stopNamed(id), limit), `${id} at ${limit}°`);
    }
  }
});

test('slope and time stay separate: a route can pass one and fail the other', () => {
  const settings = { ...STANDARD, evaHours: 5 };
  const r = check('cometgeyser', settings);
  assert.equal(r.slopeOk, true);
  assert.equal(r.timeOk, false);
  const m = measureRoute(r.points, HOME, terrain, settings);
  assert.equal(r.turnBackM, turnBackPoint(m, settings).atM);
  assert.equal(slopeWords(r), 'SLOPE: yes, by the straight route');
  assert.equal(timeWords(r), `TIME: does not fit. Turn back by ${(r.turnBackM / 1000).toFixed(2)} km`);
  assert.deepEqual(stopTag(r), { text: 'Straight route, over time', level: 'caution' });
});

test('the summary comes only from the results, and keeps the two questions apart', () => {
  const results = stops.map((s) => check(s.id));
  assert.equal(summaryLine(results), '9 of 9 stops are reachable under our assumed limits. SLOPE: 9 have a route under the slope limit. TIME: 9 of those round trips fit the time budget. One of them is your base.');
  const tight = { ...STANDARD, evaHours: 5 };
  const line = summaryLine(stops.map((s) => check(s.id, tight)));
  assert.ok(line.startsWith('7 of 9 stops are reachable'), line);
  assert.ok(line.includes('SLOPE: 9 have a route') && line.includes('TIME: 7 of those'), line);
});

test('the results say which assumptions they belong to', () => {
  assert.ok(basisLine(presetSettings('standard')).startsWith('Standard preset: slope limit 25°, time budget 8 h'));
  assert.ok(basisLine(presetSettings('cautious')).startsWith('Cautious preset: slope limit 20°, time budget 6 h'));
  assert.ok(basisLine({ ...STANDARD, evaHours: 9 }).startsWith('Custom assumptions: slope limit 25°, time budget 9 h'));
  assert.ok(basisLine(STANDARD).endsWith('Changing an assumption checks every stop again.'));
});

test('a stop under a tighter preset moves as it should', () => {
  const cautious = presetSettings('cautious');
  const r = check('cheyava', cautious);
  assert.equal(r.slopeOk, true);
  assert.equal(r.timeOk, false);
  assert.ok(r.turnBackM > 0);
});

test('the table shows the report verdict and the limits statement stays plain', () => {
  const results = stops.map((s) => check(s.id));
  const html = reachHtml(results, STANDARD);
  assert.ok(html.includes('Report: CAUTION'));
  assert.ok(html.includes('8.75 km') && html.includes('6 h 14 min of 8 h'));
  assert.equal((html.match(/data-reach-stop=/g) ?? []).length, 8, 'the base has no route to load');
  const page = readFileSync(new URL('../index.src.html', import.meta.url), 'utf8');
  assert.ok(page.includes("This uses our assumed slope limits and time budget, not NASA's rover or suit limits. The safest route guarantees slope only."));
});

test('the base itself reads as the base, even when science time alone is over budget', () => {
  const settings = { ...STANDARD, evaHours: 0.5 };
  const r = check('oeb', settings);
  assert.ok(r.atBase);
  assert.equal(r.timeOk, false);
  assert.equal(slopeWords(r), 'SLOPE: yes, this is your base');
  assert.equal(turnBackPoint(measureRoute([HOME, stopNamed('oeb')], HOME, terrain, settings), settings).kind, 'none');
});

// --- The rover path --------------------------------------------------------------------
const STEP_TOLERANCE_DEG = 0.0051; // The file holds slopes to 0.01°.

test('the file covers the recorded path, and is small', () => {
  assert.ok(readFileSync(dataPath('rover_slopes.json')).length < 20000);
  assert.equal(steps.length, 936);
  assert.equal(roverFile.vertices, 35010);
  assert.deepEqual(roverFile.sols, [14, 2022]);
  assert.equal(roverFile.stepM, DEFAULT_SETTINGS.sampleStepM);
  assert.equal(roverFile.odometerKm, 45.25);
  assert.ok(Math.abs(steps.reduce((sum, s) => sum + s.runM, 0) - roverFile.totalM) < 0.2);
  assert.equal(steps[0].from[0], 18.444627);
  assert.equal(steps[0].from[1], 77.450886);
});

test('each stored slope matches the separate elevation reading', () => {
  for (let i = 0; i < steps.length; i += 7) {
    const { from, to, deg, runM } = steps[i];
    const rise = ownHeight(to[0], to[1]) - ownHeight(from[0], from[1]);
    assert.ok(Math.abs((Math.atan(Math.abs(rise) / runM) * 180) / Math.PI - deg) < STEP_TOLERANCE_DEG, `step ${i}`);
  }
});

test('percentages sum to 100 under every preset', () => {
  for (const id of ['cautious', 'standard', 'ambitious']) {
    const { percent } = roverClasses(steps, presetSettings(id));
    assert.ok(Math.abs(CLASSES.reduce((sum, c) => sum + percent[c], 0) - 100) < 1e-9, id);
  }
});

test('shares match a separate sum, over the whole path and over several stretches', () => {
  const stretches = [[0, steps.length], [0, 100], [640, 720], [690, 700], [300, 500], [900, 936]];
  for (const [from, to] of stretches) {
    const part = steps.slice(from, to);
    const app = roverClasses(part, STANDARD);
    let low = 0;
    let middle = 0;
    let high = 0;
    for (const { from: a, to: b, runM } of part) {
      const deg = (Math.atan(Math.abs(ownHeight(b[0], b[1]) - ownHeight(a[0], a[1])) / runM) * 180) / Math.PI;
      if (deg > 25) high += runM;
      else if (deg > 15) middle += runM;
      else low += runM;
    }
    const whole = low + middle + high;
    assert.ok(Math.abs((low / whole) * 100 - app.percent.go) < 0.25, `${from} to ${to}: under`);
    assert.ok(Math.abs((middle / whole) * 100 - app.percent.caution) < 0.25, `${from} to ${to}: between`);
    assert.ok(Math.abs((high / whole) * 100 - app.percent.nogo) < 0.25, `${from} to ${to}: over`);
  }
});

test('the Standard results, as printed', () => {
  const lines = roverLines(roverClasses(steps, STANDARD), roverFile, STANDARD);
  assert.deepEqual(lines.classes.map((c) => c.text), ['Up to 15°: 98.7%, 46.15 km', 'Over 15° to 25°: 1.3%, 0.60 km', 'Over 25°: 0.0%, 0.00 km']);
  assert.equal(lines.steepest, 'Steepest step: 17.7° at 34.90 km along the path.');
  assert.ok(lines.total.startsWith('Distance analysed: 46.75 km'));
  assert.ok(lines.fine.includes('30.4°'), 'the point-to-point figure stays stated');
});

test('every step lands in the class its slope and the limits say, at any limits', () => {
  for (const settings of [STANDARD, presetSettings('cautious'), presetSettings('ambitious'), { ...STANDARD, cautionSlopeDeg: 3, maxSlopeDeg: 7 }]) {
    const { metres } = roverClasses(steps, settings);
    const by = (test2) => steps.filter(test2).reduce((sum, s) => sum + s.runM, 0);
    assert.equal(metres.go, by((s) => s.deg <= settings.cautionSlopeDeg));
    assert.equal(metres.caution, by((s) => s.deg > settings.cautionSlopeDeg && s.deg <= settings.maxSlopeDeg));
    assert.equal(metres.nogo, by((s) => s.deg > settings.maxSlopeDeg));
  }
});

test('the classes move the right way under another preset', () => {
  const cautious = roverClasses(steps, presetSettings('cautious'));
  const standard = roverClasses(steps, STANDARD);
  const ambitious = roverClasses(steps, presetSettings('ambitious'));
  assert.ok(cautious.percent.go < standard.percent.go && standard.percent.go < ambitious.percent.go);
  assert.ok(cautious.percent.caution > standard.percent.caution);
  assert.equal(ambitious.percent.caution, 0);
  assert.equal(cautious.steepest.deg, ambitious.steepest.deg, 'the ground does not change');
  assert.equal(classNames(presetSettings('cautious')).caution, 'Over 10° to 20°');
});

test('exactly at a limit is the lower class, as in the verdict', () => {
  const at = steps[10].deg;
  const { metres } = roverClasses([steps[10]], { cautionSlopeDeg: at, maxSlopeDeg: at + 1 });
  assert.equal(metres.go, steps[10].runM);
});

test('the drawn lines hold every step, in class order along the path', () => {
  const { lines } = roverClasses(steps, STANDARD);
  assert.equal(lines.reduce((sum, l) => sum + l.latlngs.length - 1, 0), steps.length);
  for (let i = 1; i < lines.length; i++) assert.notEqual(lines[i].level, lines[i - 1].level);
});
