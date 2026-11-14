// The explanations must only repeat what the report computed, for the same route.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { explainHtml, explainItem, whyList } from '../js/explain.js';
import { inspectHtml, inspectPoint, nearest, slopeSentence } from '../js/inspect.js';
import { BASE_LAYERS, TILE_OVERLAYS, VECTOR_OVERLAYS } from '../js/layers.js';
import { DEFAULT_SETTINGS, decideVerdict, formatDuration, measureRoute, verdictForDisplay } from '../js/report.js';
import { slopeAt, slopeClass } from '../js/slope.js';
import { loadRealTerrain } from './helpers.mjs';

const terrain = await loadRealTerrain('full');
const coarse = await loadRealTerrain('coarse');
const HOME = { lat: 18.44463, lon: 77.45089 };
const DEMO = [HOME, { lat: 18.43396, lon: 77.44302 }, { lat: 18.45263, lon: 77.40776 }, { lat: 18.45865, lon: 77.40592 }, { lat: 18.4669, lon: 77.4298 }];
const SCARP = [...DEMO, { lat: 18.4731, lon: 77.4214 }];
const OFF_MAP = [HOME, { lat: 18.45865, lon: 77.40592 }, { lat: 19.05, lon: 77.40 }];
const settings = { ...DEFAULT_SETTINGS };

function report(points, status = 'final', grid = terrain, s = settings) {
  const m = measureRoute(points, points[0], grid, s);
  return { m, verdict: decideVerdict(m, s), settings: s, status, legs: points.length - 1, previewCellM: 80 };
}

test('verdict reasons say which limits are assumptions', () => {
  const { verdict } = report(SCARP);
  assert.equal(verdict.level, 'nogo');
  assert.ok(verdict.reasons.some((r) => r.level === 'nogo' && r.text === 'Slope reaches 26.7° at 5.13 km; limit is 25° (assumption).'));
});

test('the verdict line says our assumed limit, and Why? keeps the exact wording', () => {
  const nogo = report(SCARP);
  const slope = nogo.verdict.reasons.find((r) => r.level === 'nogo');
  assert.equal(slope.line, 'Slope reaches 26.7° at 5.13 km; our assumed limit is 25°.');
  assert.ok(whyList(nogo.m, nogo.verdict, settings).some((w) => w.text === 'Slope reaches 26.7° at 5.13 km; limit is 25° (assumption).'));
  const caution = report(DEMO).verdict.reasons.find((r) => r.level === 'caution');
  assert.equal(caution.line, 'Slope reaches 18.1° at 4.44 km; our assumed caution limit is 15°.');
});

test('every line on the verdict says the limit is assumed, without the bare word', () => {
  const m = {
    leavesCoverage: false, uncoveredM: 0, maxSlopeAtM: 100, evaUsedH: 7.5, marginPct: 6,
  };
  const cases = [
    decideVerdict({ ...m, maxSlopeDeg: 10 }, settings), // Low reserve.
    decideVerdict({ ...m, maxSlopeDeg: 18 }, settings),
    decideVerdict({ ...m, maxSlopeDeg: 30, evaUsedH: 9, marginPct: -12 }, settings),
    decideVerdict({ ...m, maxSlopeDeg: 5, evaUsedH: 2, marginPct: 75 }, settings), // GO.
  ];
  for (const verdict of cases) {
    for (const r of verdict.reasons) {
      if (r.text === 'The whole route has elevation data.') continue;
      assert.match(r.line, /assumed/, r.text);
      assert.ok(!r.line.includes('(assumption)'), r.line);
    }
  }
});

test('why list: failed lines are the verdict reasons, and each rule appears once', () => {
  for (const points of [DEMO, SCARP, OFF_MAP, [HOME, DEMO[1]]]) {
    const r = report(points);
    const why = whyList(r.m, r.verdict, settings);
    const failed = why.filter((w) => w.level !== 'ok');
    assert.deepEqual(failed, r.verdict.reasons.filter((x) => x.level !== 'ok'));
    assert.equal(new Set(why.map((w) => w.text)).size, why.length);
    if (r.verdict.level === 'go') assert.equal(failed.length, 0);
    else assert.ok(failed.length > 0);
  }
});

test('why list: the demo passes everything but the caution slope', () => {
  const r = report(DEMO);
  const why = whyList(r.m, r.verdict, settings);
  assert.deepEqual(why.filter((w) => w.level !== 'ok').map((w) => w.level), ['caution']);
  assert.ok(why.some((w) => w.level === 'ok' && w.text.includes('within the 25° No-Go limit (assumption)')));
  assert.ok(why.some((w) => w.level === 'ok' && w.text.includes('8 h EVA budget (assumption)')));
});

test('slope explanation works the steepest step from the real samples', () => {
  for (const [points, shown] of [[DEMO, '18.1° at 4.44 km'], [SCARP, '26.7° at 5.13 km']]) {
    const item = explainItem('slope', report(points));
    assert.equal(item.value, shown);
    const value = (label) => parseFloat(item.inputs.find((i) => i.label === label).value);
    const worked = Math.atan(value('Rise or drop') / value('Run')) * (180 / Math.PI);
    assert.ok(Math.abs(worked - parseFloat(shown)) < 0.2, `${worked} from the shown rise and run`);
  }
});

test('every number with a limit or a placeholder is labeled as an assumption', () => {
  const r = report(DEMO);
  const labeled = (key, label) => explainItem(key, r).inputs.find((i) => i.label === label).assumption;
  assert.ok(labeled('slope', 'Caution limit'));
  assert.ok(labeled('slope', 'No-Go limit'));
  assert.ok(labeled('time', 'Speed on flat ground'));
  assert.ok(labeled('back', 'Speed on flat ground'));
  assert.ok(labeled('eva', 'Science time'));
  assert.ok(labeled('eva', 'EVA budget'));
  assert.ok(labeled('margin', 'Reserve target'));
});

test('time, return and EVA explanations repeat the report values', () => {
  const r = report(DEMO);
  assert.equal(explainItem('time', r).value, formatDuration(r.m.outH));
  assert.equal(explainItem('back', r).value, formatDuration(r.m.backH));
  assert.equal(explainItem('eva', r).value, `${formatDuration(r.m.evaUsedH)} of 8 h`);
  assert.equal(explainItem('margin', r).value, `${r.m.marginPct.toFixed(0)}%`);
});

test('explanations follow edited settings', () => {
  const s = { ...settings, maxSlopeDeg: 30, cautionSlopeDeg: 20, baseSpeedKmh: 2 };
  const item = explainItem('slope', report(DEMO, 'final', terrain, s));
  assert.equal(item.inputs.find((i) => i.label === 'No-Go limit').value, '30°');
  assert.equal(explainItem('time', report(DEMO, 'final', terrain, s)).inputs[0].value, '2 km/h');
});

test('nothing that depends on elevation is explained from the preview grid', () => {
  const r = report(SCARP, 'refining', coarse);
  const shown = verdictForDisplay(r.verdict, 'refining', 80);
  assert.equal(shown.state, 'refining');
  for (const key of ['verdict', 'slope', 'time', 'back', 'eva', 'margin', 'climb']) {
    const item = explainItem(key, r);
    assert.ok(item.pending, key);
    const html = explainHtml(item);
    assert.ok(html.includes('Refining...'), key);
    assert.ok(!/\bGO\b|CAUTION|NO-GO|°/.test(html), `${key} must name no level or slope: ${html}`);
  }
  // Positions do not depend on a grid, so these stay available.
  assert.ok(!explainItem('distance', r).pending);
  assert.ok(!explainItem('abort', r).pending);
});

test('a failed report grid never explains a result', () => {
  const r = report(SCARP, 'failed', coarse);
  const html = explainHtml(explainItem('verdict', r));
  assert.ok(html.includes('did not load'));
  assert.ok(!/\bGO\b|CAUTION|NO-GO/.test(html));
});

test('explanation HTML is built for every key on every kind of route', () => {
  for (const points of [DEMO, SCARP, OFF_MAP]) {
    for (const key of ['verdict', 'distance', 'slope', 'time', 'back', 'eva', 'margin', 'abort', 'climb']) {
      const html = explainHtml(explainItem(key, report(points)));
      assert.ok(html.startsWith('<h3'), key);
      assert.ok(!html.includes('undefined') && !html.includes('NaN'), `${key}: ${html}`);
    }
  }
});

test('slope sentence uses the same limits as the report', () => {
  assert.match(slopeSentence(18.04, settings), /^Slope 18\.0°: steeper than the 15° CAUTION limit \(assumption\), so walking here is slow and risky: about [\d.]+ km\/h/);
  assert.match(slopeSentence(26, settings), /steeper than the 25° NO-GO limit/);
  assert.match(slopeSentence(15, settings), /within the 15° CAUTION limit/);
  assert.match(slopeSentence(25, settings), /CAUTION limit/);
});

test('slope classes match decideVerdict at and around each limit', () => {
  const neutral = { leavesCoverage: false, uncoveredM: 0, evaUsedH: 1, marginPct: 87.5, maxSlopeAtM: 100 };
  for (const deg of [0, 14.99, 15, 15.01, 24.99, 25, 25.01, 60]) {
    assert.equal(slopeClass(deg, settings), decideVerdict({ ...neutral, maxSlopeDeg: deg }, settings).level, `${deg}`);
  }
  const odd = { ...settings, cautionSlopeDeg: 30, maxSlopeDeg: 20 }; // Limits set the wrong way round.
  for (const deg of [10, 20, 25, 31]) assert.equal(slopeClass(deg, odd), decideVerdict({ ...neutral, maxSlopeDeg: deg }, odd).level, `${deg}`);
});

test('inspect: real values on the 40 m grid', () => {
  const stops = [{ name: 'Near', ...HOME }, { name: 'Far', lat: 18.6, lon: 77.2 }];
  const point = { lat: 18.4731, lon: 77.4214 };
  const info = inspectPoint(point, { terrain, status: 'final', settings, habitat: HOME, stops, layers: [{ label: 'CTX', text: 'A mosaic.' }] });
  assert.equal(info.elevationM, terrain.elevationAt(point.lat, point.lon));
  assert.equal(info.slopeDeg, slopeAt(terrain, point.lat, point.lon));
  assert.equal(info.level, slopeClass(info.slopeDeg, settings));
  assert.equal(info.nearestStop.item.name, 'Near');
  const html = inspectHtml(info);
  assert.ok(html.includes('Nearest science stop') && html.includes('CTX') && html.includes('A mosaic.'));
});

test('inspect: says Refining until the report grid arrives, with no slope or level', () => {
  const info = inspectPoint({ lat: 18.4731, lon: 77.4214 }, { terrain: coarse, status: 'refining', settings, habitat: HOME, stops: [], layers: [] });
  assert.equal(info.pending, 'Refining...');
  assert.equal(info.slopeDeg, undefined);
  const html = inspectHtml(info);
  assert.ok(html.includes('Refining...'));
  assert.ok(!/\bGO\b|CAUTION|NO-GO|°/.test(html), html);
});

test('inspect: off the elevation data', () => {
  const info = inspectPoint({ lat: 19.05, lon: 77.4 }, { terrain, status: 'final', settings, habitat: HOME, stops: [], layers: [] });
  assert.ok(info.noData);
  assert.match(inspectHtml(info), /no data/);
});

test('nearest finds the closest item', () => {
  assert.equal(nearest({ lat: 0, lon: 0 }, [{ lat: 1, lon: 1 }, { lat: 0.1, lon: 0 }]).item.lat, 0.1);
  assert.equal(nearest({ lat: 0, lon: 0 }, []), null);
});

test('every layer has a complete card', () => {
  for (const cfg of [...BASE_LAYERS, ...TILE_OVERLAYS, ...VECTOR_OVERLAYS]) {
    for (const field of ['mission', 'instrument', 'resolution', 'shows', 'why', 'key', 'source_name', 'source_url']) {
      assert.ok(cfg[field], `${cfg.id} is missing ${field}`);
    }
  }
});
