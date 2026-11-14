// Route geometry: great-circle distance, interpolation and sampling on Mars.
// Pure functions, no DOM, so they run in the browser and under `node --test`.

// Mars volumetric mean radius, NASA NSSDC Mars Fact Sheet.
export const MARS_RADIUS_M = 3389500;
export const MARS_RADIUS_SOURCE = {
  name: 'NASA NSSDC Mars Fact Sheet',
  url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html',
};

const RAD = Math.PI / 180;

/** Great-circle distance in metres between two {lat, lon} points in degrees. */
export function haversineM(a, b) {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * MARS_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Total length in metres of a list of points. */
export function pathLengthM(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineM(points[i - 1], points[i]);
  return total;
}

/** Point a fraction f (0 to 1) of the way from a to b along the great circle. */
export function interpolate(a, b, f) {
  const d = haversineM(a, b) / MARS_RADIUS_M;
  if (d < 1e-12) return { lat: a.lat, lon: a.lon };
  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const [lat1, lon1, lat2, lon2] = [a.lat * RAD, a.lon * RAD, b.lat * RAD, b.lon * RAD];
  const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
  const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
  const z = A * Math.sin(lat1) + B * Math.sin(lat2);
  return { lat: Math.atan2(z, Math.hypot(x, y)) / RAD, lon: Math.atan2(y, x) / RAD };
}

/**
 * Sample a path at intervals of at most stepM, always keeping every vertex.
 * Returns [{lat, lon, d}] where d is the distance along the path in metres.
 */
export function samplePath(points, stepM) {
  if (points.length === 0) return [];
  const out = [{ lat: points[0].lat, lon: points[0].lon, d: 0 }];
  let travelled = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = haversineM(a, b);
    if (len === 0) continue;
    const n = Math.max(1, Math.ceil(len / stepM));
    for (let k = 1; k <= n; k++) {
      const p = k === n ? b : interpolate(a, b, k / n);
      out.push({ lat: p.lat, lon: p.lon, d: travelled + (len * k) / n });
    }
    travelled += len;
  }
  return out;
}
