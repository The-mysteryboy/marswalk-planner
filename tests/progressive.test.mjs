// Progressive loading. Two rules matter here: the validated grid alone decides
// safety, and the preview can never be mistaken for a result.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GridProgress, loadGrids } from '../js/terrain.js';
import { DEFAULT_SETTINGS, REFINING_WORD, decideVerdict, measureRoute, verdictForDisplay } from '../js/report.js';
import { dataPath, loadRealTerrain, readIndex } from './helpers.mjs';

const S = { ...DEFAULT_SETTINGS };
const COARSE = { name: 'coarse' };
const FULL = { name: 'full' };

// The routes behind the checks on the live site.
const HOME = { lat: 18.44463, lon: 77.45089 };
const DEMO = [HOME, { lat: 18.43396, lon: 77.44302 }, { lat: 18.45263, lon: 77.40776 }, { lat: 18.45865, lon: 77.40592 }, { lat: 18.4669, lon: 77.4298 }];
const SCARP = [...DEMO, { lat: 18.4731, lon: 77.4214 }];
const OFF_MAP = [HOME, { lat: 18.45865, lon: 77.40592 }, { lat: 19.05, lon: 77.4 }];

const report = (t, points) => {
  const m = measureRoute(points, HOME, t, S);
  return { m, verdict: decideVerdict(m, S) };
};
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b}`);

test('status: starts loading, then refining, and only the full grid is final', () => {
  const p = new GridProgress();
  assert.equal(p.status, 'loading');
  p.offerCoarse(COARSE);
  assert.equal(p.status, 'refining');
  assert.equal(p.terrain, COARSE);
  p.offerFull(FULL);
  assert.equal(p.status, 'final');
  assert.equal(p.terrain, FULL);
});

test('status: a preview arriving late can never replace the full grid', () => {
  const p = new GridProgress();
  p.offerFull(FULL);
  p.offerCoarse(COARSE);
  assert.equal(p.terrain, FULL);
  assert.equal(p.status, 'final');
});

test('status: if the full grid fails, the preview never becomes final', () => {
  const p = new GridProgress();
  p.offerCoarse(COARSE);
  p.fullFailed();
  assert.equal(p.status, 'failed');
  assert.equal(p.isFinal, false);
});

test('status: a failed preview does not stop the full grid', () => {
  const p = new GridProgress();
  p.offerFull(FULL);
  assert.equal(p.status, 'final');
  p.fullFailed(); // Nothing can undo a final grid.
  assert.equal(p.status, 'final');
});

for (const level of ['go', 'caution', 'nogo']) {
  const verdict = { level, reasons: [{ level, text: 'Secret reason' }] };

  test(`display: a ${level} from the preview grid is never shown`, () => {
    const shown = verdictForDisplay(verdict, 'refining', 80);
    assert.equal(shown.word, REFINING_WORD);
    assert.equal(shown.state, 'refining');
    const text = JSON.stringify(shown);
    assert.ok(!/\bGO\b|CAUTION|NO-GO|Secret/.test(text), text);
  });

  test(`display: a ${level} is also hidden if the full grid failed`, () => {
    const shown = verdictForDisplay(verdict, 'failed', 80);
    assert.equal(shown.word, 'No verdict');
    assert.ok(!/\bGO\b|CAUTION|NO-GO|Secret/.test(JSON.stringify(shown)));
  });
}

test('display: the full grid shows the verdict as it is', () => {
  const shown = verdictForDisplay({ level: 'caution', reasons: [{ level: 'caution', text: 'Steep' }] }, 'final', 80);
  assert.deepEqual([shown.state, shown.word, shown.reasons[0].text], ['caution', 'CAUTION', 'Steep']);
});

const urlFor = (name) => `http://site.test/data/${name}`;

test('loader: the report grid waits for the preview, and survives its failure', async () => {
  const index = readFileSync(dataPath('terrain.json'), 'utf8');
  const order = [];
  const fetchFn = async (url) => {
    const name = url.split('/').pop();
    order.push(name);
    if (name === 'terrain.json') return new Response(index);
    if (name === 'terrain_coarse.bin') return new Response('', { status: 500 });
    return new Response(readFileSync(dataPath(name)));
  };
  const { coarse, full } = loadGrids(urlFor, fetchFn);
  await assert.rejects(coarse, /HTTP 500/);
  const t = await full;
  assert.equal(t.meta.role, 'report');
  assert.deepEqual(order, ['terrain.json', 'terrain_coarse.bin', 'terrain_full.bin']);
});

test('loader: a failed report grid rejects instead of falling back', async () => {
  const fetchFn = async (url) => {
    const name = url.split('/').pop();
    if (name === 'terrain.json') return new Response(readFileSync(dataPath(name), 'utf8'));
    if (name === 'terrain_coarse.bin') return new Response(readFileSync(dataPath(name)));
    return new Response('', { status: 503 });
  };
  const { coarse, full } = loadGrids(urlFor, fetchFn);
  assert.equal((await coarse).meta.role, 'preview');
  await assert.rejects(full, /HTTP 503/);
});

// A cached copy that fails its SHA-256 check gets one fresh download.
function damagedCopyFetch({ stillDamaged }) {
  const asked = [];
  const good = readFileSync(dataPath('terrain_coarse.bin'));
  const fetchFn = async (url, options) => {
    const name = url.split('/').pop();
    if (name === 'terrain.json') return new Response(readFileSync(dataPath(name), 'utf8'));
    if (name !== 'terrain_coarse.bin') return new Response(readFileSync(dataPath(name)));
    asked.push(options?.cache ?? 'default');
    const body = Buffer.from(good);
    if (stillDamaged || options?.cache !== 'reload') body[5000] ^= 1;
    return new Response(body);
  };
  return { fetchFn, asked };
}

test('loader: a damaged saved copy is replaced by one fresh download', async () => {
  const { fetchFn, asked } = damagedCopyFetch({ stillDamaged: false });
  const { coarse } = loadGrids(urlFor, fetchFn);
  assert.equal((await coarse).meta.role, 'preview');
  assert.deepEqual(asked, ['default', 'reload']);
});

test('loader: if the fresh download fails the check too, nothing is accepted', async () => {
  const { fetchFn, asked } = damagedCopyFetch({ stillDamaged: true });
  await assert.rejects(loadGrids(urlFor, fetchFn).coarse, /integrity/);
  assert.equal(asked.length, 2);
});

test('grids: the preview has 4x fewer cells over exactly the same area', async () => {
  const { full, coarse } = readIndex();
  assert.equal(full.width, 1546);
  assert.equal(full.height, 1482);
  assert.equal(coarse.width * 2, full.width);
  assert.equal(coarse.height * 2, full.height);
  assert.deepEqual(coarse.bounds, full.bounds);
  assert.equal(full.cell_size_m, 40);
  assert.equal(coarse.cell_size_m, 80);
  assert.equal(full.role, 'report');
  assert.equal(coarse.role, 'preview');
  assert.equal((await loadRealTerrain('coarse')).samples.length, coarse.width * coarse.height);
});

test('validated numbers: the demo route is CAUTION at 18.1 degrees, 4.44 km', async () => {
  const { m, verdict } = report(await loadRealTerrain(), DEMO);
  assert.equal(verdict.level, 'caution');
  assert.equal(m.maxSlopeDeg.toFixed(1), '18.1');
  assert.equal((m.maxSlopeAtM / 1000).toFixed(2), '4.44');
  assert.equal((m.distanceM / 1000).toFixed(2), '4.83');
  close(m.evaUsedH, 4 + 2 / 60, 0.01, 'EVA hours');
});

test('validated numbers: the scarp route is NO-GO at 26.7 degrees, 5.13 km', async () => {
  const { m, verdict } = report(await loadRealTerrain(), SCARP);
  assert.equal(verdict.level, 'nogo');
  assert.equal(m.maxSlopeDeg.toFixed(1), '26.7');
  assert.equal((m.maxSlopeAtM / 1000).toFixed(2), '5.13');
});

test('validated numbers: a route leaving the data area is NO-GO for missing elevation', async () => {
  const { m, verdict } = report(await loadRealTerrain(), OFF_MAP);
  assert.equal(verdict.level, 'nogo');
  assert.equal(m.leavesCoverage, true);
  assert.ok(verdict.reasons.some((r) => r.text.includes('no elevation data')));
});

test('why previews are hidden: the coarse grid understates the demo route slope', async () => {
  const coarse = report(await loadRealTerrain('coarse'), DEMO).m.maxSlopeDeg;
  const full = report(await loadRealTerrain(), DEMO).m.maxSlopeDeg;
  assert.ok(coarse < full, `coarse ${coarse.toFixed(1)} should be under full ${full.toFixed(1)}`);
});
