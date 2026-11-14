// Ground truth check. Runs the rover validation through the same JavaScript the
// browser uses, so a change to how the grid is stored or decoded cannot quietly
// change an elevation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadRealTerrain } from './helpers.mjs';

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/rover_elevations.json', import.meta.url)), 'utf8'));

test('rover validation: the grid matches 708 measured elevations', async () => {
  const t = await loadRealTerrain();
  const diffs = fixture.waypoints.map(([lat, lon, elev]) => {
    const z = t.elevationAt(lat, lon);
    assert.notEqual(z, null, `no elevation at ${lat}, ${lon}`);
    return z - elev;
  });
  assert.equal(diffs.length, 708);
  const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
  const rms = Math.sqrt(diffs.reduce((s, d) => s + d * d, 0) / diffs.length);
  // Baseline through this code path: RMS 3.084 m, bias -0.836 m. Never worse.
  assert.ok(rms <= 3.0845, `RMS ${rms.toFixed(4)} m`);
  assert.ok(Math.abs(mean) <= 0.8365, `bias ${mean.toFixed(4)} m`);
});
