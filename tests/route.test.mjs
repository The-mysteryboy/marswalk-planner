import test from 'node:test';
import assert from 'node:assert/strict';
import { MARS_RADIUS_M, haversineM, pathLengthM, interpolate, samplePath } from '../js/route.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} got ${a}, expected ${b} +/- ${tol}`);

test('haversine: one degree of latitude is 2 pi R / 360', () => {
  // 2 * pi * 3389500 / 360 = 59,157.92 m, computed by hand.
  close(haversineM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }), 59157.92, 0.1);
});

test('haversine: one degree of longitude at the equator equals one degree of latitude', () => {
  close(haversineM({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }), 59157.92, 0.1);
});

test('haversine: one degree of longitude shrinks by cos(lat)', () => {
  // At 60 N, cos(lat) = 0.5, so about 29.58 km.
  close(haversineM({ lat: 60, lon: 0 }, { lat: 60, lon: 1 }), 29578.2, 8);
});

test('haversine: half the planet apart is pi R', () => {
  close(haversineM({ lat: 0, lon: 0 }, { lat: 0, lon: 180 }), Math.PI * MARS_RADIUS_M, 1e-6);
});

test('haversine: agrees with the spherical law of cosines at Jezero', () => {
  // An independent formula, same points as the Phase 3 checkpoint.
  const a = { lat: 18.44462715, lon: 77.45088572 };
  const b = { lat: 18.4356, lon: 77.2332 };
  const r = Math.PI / 180;
  const c = Math.acos(Math.sin(a.lat * r) * Math.sin(b.lat * r) +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r));
  close(haversineM(a, b), c * MARS_RADIUS_M, 0.01);
});

test('path length adds its legs', () => {
  const p = [{ lat: 0, lon: 0 }, { lat: 1, lon: 0 }, { lat: 1, lon: 1 }];
  close(pathLengthM(p), haversineM(p[0], p[1]) + haversineM(p[1], p[2]), 1e-6);
  assert.equal(pathLengthM([]), 0);
  assert.equal(pathLengthM([p[0]]), 0);
});

test('interpolate: endpoints and midpoint', () => {
  const a = { lat: 0, lon: 0 };
  const b = { lat: 0, lon: 10 };
  close(interpolate(a, b, 0).lon, 0, 1e-9);
  close(interpolate(a, b, 1).lon, 10, 1e-9);
  close(interpolate(a, b, 0.5).lon, 5, 1e-9);
  close(interpolate(a, a, 0.5).lat, 0, 1e-12); // identical points do not divide by zero
});

test('samplePath: step, vertices and cumulative distance', () => {
  const p = [{ lat: 18, lon: 77 }, { lat: 18.01, lon: 77 }, { lat: 18.01, lon: 77.01 }];
  const s = samplePath(p, 50);
  assert.deepEqual([s[0].lat, s[0].lon, s[0].d], [18, 77, 0]);
  close(s.at(-1).d, pathLengthM(p), 1e-6, 'end distance');
  for (let i = 1; i < s.length; i++) {
    const gap = s[i].d - s[i - 1].d;
    assert.ok(gap > 0 && gap <= 50, `gap ${gap}`);
    close(haversineM(s[i - 1], s[i]), gap, 0.01, 'stored distance matches the geometry');
  }
  assert.ok(s.some((x) => x.lat === 18.01 && x.lon === 77), 'keeps the middle vertex');
});

test('samplePath: empty and single point', () => {
  assert.deepEqual(samplePath([], 50), []);
  assert.equal(samplePath([{ lat: 1, lon: 1 }], 50).length, 1);
});

test('samplePath: duplicate points add no zero-length steps', () => {
  const a = { lat: 18, lon: 77 };
  assert.equal(samplePath([a, a], 50).length, 1);
});
