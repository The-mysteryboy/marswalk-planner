// A scenario's goal must be a real result: it follows the report, and it can fail.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { presetSettings } from '../js/presets.js';
import { DEFAULT_SETTINGS, decideVerdict, measureRoute } from '../js/report.js';
import { SCENARIOS, scenarioHtml, scenarioRoute, scenarioView } from '../js/scenarios.js';
import { dataPath, loadRealTerrain } from './helpers.mjs';

const terrain = await loadRealTerrain('full');
const coarse = await loadRealTerrain('coarse');
const { stops } = JSON.parse(readFileSync(dataPath('science_stops.json'), 'utf8'));
const byId = (id) => SCENARIOS.find((s) => s.id === id);

function view(scenario, { points = scenarioRoute(scenario, stops), settings = { ...DEFAULT_SETTINGS }, status = 'final', grid = terrain } = {}) {
  const measure = (p) => measureRoute(p, p[0], grid, settings);
  const m = measure(points);
  const report = { m, verdict: decideVerdict(m, settings), settings, status };
  return { report, view: scenarioView(scenario, report, { stops, points, measure }) };
}

test('there are three or four scenarios, each complete', () => {
  assert.ok(SCENARIOS.length >= 3 && SCENARIOS.length <= 4);
  for (const s of SCENARIOS) {
    assert.ok(s.title && s.goal && typeof s.check === 'function', s.id);
    assert.ok(s.captions.length >= 2 && s.captions.length <= 4, `${s.id} has ${s.captions.length} captions`);
    assert.ok(scenarioRoute(s, stops).length >= 2, s.id);
  }
});

test('every fixed caption has a source, and every other caption is computed', () => {
  for (const s of SCENARIOS) {
    const { view: v } = view(s);
    for (const c of v.captions) {
      if (c.computed) continue;
      assert.ok(c.source?.url?.startsWith('https://'), `${s.id}: ${c.text}`);
      assert.ok(c.source.name, `${s.id}: ${c.text}`);
    }
  }
});

test('with default assumptions every scenario meets its goal, from real report values', () => {
  for (const s of SCENARIOS) {
    const { view: v } = view(s);
    assert.equal(v.result.pass, true, `${s.id}: ${v.result.text}`);
    assert.equal(v.edited, false, s.id);
  }
});

test('scarp: uses the validated numbers, and the leg before it is not NO-GO', () => {
  const { report, view: v } = view(byId('scarp'));
  assert.equal(report.verdict.level, 'nogo');
  assert.equal(report.m.maxSlopeDeg.toFixed(1), '26.7');
  assert.equal((report.m.maxSlopeAtM / 1000).toFixed(2), '5.13');
  assert.match(v.captions[2].text, /26\.7° at 5\.13 km, and the limit is 25° \(assumption\)/);
  assert.match(v.captions[1].text, /CAUTION, with a steepest step of 18\.1°/);
  assert.match(v.result.text, /CAUTION to NO-GO, at 26\.7°/);
});

test('longest: 1% farther along the same line is no longer GO', () => {
  const s = byId('longest');
  const { report } = view(s);
  assert.equal(report.verdict.level, 'go');
  assert.ok(report.m.marginPct >= DEFAULT_SETTINGS.minMarginPct);
  const [home, end] = scenarioRoute(s, stops);
  const farther = { lat: home.lat + (end.lat - home.lat) * 1.01, lon: home.lon + (end.lon - home.lon) * 1.01 };
  const m = measureRoute([home, farther], home, terrain, DEFAULT_SETTINGS);
  assert.notEqual(decideVerdict(m, DEFAULT_SETTINGS).level, 'go');
});

test('all nine stops really are near the stops route', () => {
  const { view: v } = view(byId('stops'));
  assert.match(v.result.text, /all 9 stops/);
  assert.match(v.captions[2].text, /9 of the 9 stops/);
});

test('goals can fail: a harder limit, a shorter route, an edited route', () => {
  const strict = { ...DEFAULT_SETTINGS, cautionSlopeDeg: 3, maxSlopeDeg: 5 };
  assert.equal(view(byId('stops'), { settings: strict }).view.result.pass, false);
  assert.equal(view(byId('longest'), { settings: strict }).view.result.pass, false);

  const delta = byId('delta');
  const short = scenarioRoute(delta, stops).slice(0, 2);
  const cut = view(delta, { points: short }).view;
  assert.equal(cut.result.pass, false);
  assert.equal(cut.edited, true);

  const scarp = byId('scarp');
  const noScarp = scenarioRoute(scarp, stops).slice(0, -1);
  assert.equal(view(scarp, { points: noScarp }).view.result.pass, false);

  const spare = view(byId('longest'), { points: scenarioRoute(byId('delta'), stops) }).view;
  assert.equal(spare.result.pass, false, 'a short route leaves budget unused');
});

test('goal text follows edited settings', () => {
  const s = { ...DEFAULT_SETTINGS, maxSlopeDeg: 30 };
  const { view: v } = view(byId('scarp'), { settings: s });
  assert.equal(v.result.pass, false);
  assert.match(v.captions[2].text, /limit is 30° \(assumption\)/);
});

test('nothing computed is shown until the report grid arrives', () => {
  for (const s of SCENARIOS) {
    const { view: v } = view(s, { status: 'refining', grid: coarse });
    assert.equal(v.result, null, s.id);
    for (let step = 0; step < v.captions.length; step++) {
      const html = scenarioHtml(v, step);
      assert.ok(html.includes('Refining...'), `${s.id} step ${step}`);
      assert.ok(!html.includes('Goal met') && !html.includes('Goal not met'));
    }
    for (const c of v.captions.filter((x) => x.computed)) {
      assert.equal(c.text, 'Refining...', s.id);
    }
  }
});

test('a failed report grid shows no result', () => {
  const { view: v } = view(byId('scarp'), { status: 'failed', grid: coarse });
  assert.equal(v.result, null);
  assert.ok(scenarioHtml(v, 1).includes('no report grid'));
});

test('a scenario says which preset it ran under, and Standard needs no note', () => {
  const s = byId('scarp');
  assert.equal(view(s).view.ranUnder, '');
  assert.ok(!scenarioHtml(view(s).view, 0).includes('Ran under'));
  const ambitious = view(s, { settings: presetSettings('ambitious') }).view;
  assert.ok(scenarioHtml(ambitious, 0).includes('Ran under: Ambitious preset.'));
  assert.ok(scenarioHtml(ambitious, 0).includes('not NASA values'));
  const custom = view(s, { settings: { ...DEFAULT_SETTINGS, evaHours: 7 } }).view;
  assert.ok(scenarioHtml(custom, 0).includes('Ran under: Custom assumptions.'));
});

test('caption stepping stays in range', () => {
  const { view: v } = view(byId('delta'));
  assert.match(scenarioHtml(v, 0), /data-scenario-step="-1" disabled/);
  assert.match(scenarioHtml(v, v.captions.length - 1), /data-scenario-step="1" disabled/);
  assert.ok(!scenarioHtml(v, 1).includes('disabled'));
});
