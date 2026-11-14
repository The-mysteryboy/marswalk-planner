// What the app can say about one map point, for Check a point mode. Pure functions, no DOM. Elevation and slope
// come only from the 40 m report grid. Until it has loaded this says Refining, and it
// never reads the preview grid, which can hide a steep slope.
import { esc } from './explain.js';
import { REFINING_WORD, walkingSpeedKmh } from './report.js';
import { haversineM } from './route.js';
import { slopeAt, slopeClass } from './slope.js';

const km = (m) => `${(m / 1000).toFixed(2)} km`;

/** One plain sentence built from the same limits the report uses. */
export function slopeSentence(degrees, s) {
  const shown = `Slope ${degrees.toFixed(1)}°`;
  const level = slopeClass(degrees, s);
  if (level === 'nogo') {
    return `${shown}: steeper than the ${s.maxSlopeDeg}° NO-GO limit (assumption), so a route climbing straight up here would be NO-GO.`;
  }
  if (level === 'caution') {
    const uphill = walkingSpeedKmh(Math.tan((degrees * Math.PI) / 180), s.baseSpeedKmh);
    return `${shown}: steeper than the ${s.cautionSlopeDeg}° CAUTION limit (assumption), so walking here is slow and risky: about ${uphill.toFixed(1)} km/h straight uphill on the walking model.`;
  }
  return `${shown}: within the ${s.cautionSlopeDeg}° CAUTION limit (assumption).`;
}

/** Nearest item of a list of {lat, lon}, with its distance from the point. */
export function nearest(point, items) {
  let best = null;
  let bestM = Infinity;
  for (const item of items) {
    const d = haversineM(point, item);
    if (d < bestM) {
      bestM = d;
      best = item;
    }
  }
  return best ? { item: best, distanceM: bestM } : null;
}

/**
 * @param {{lat: number, lon: number}} point
 * @param {object} ctx terrain and status from GridProgress, settings, habitat, stops, and
 *   layers: one {label, text} line for each active layer, written by the caller.
 */
export function inspectPoint(point, { terrain, status, settings, habitat, stops, layers }) {
  const out = {
    lat: point.lat,
    lon: point.lon,
    habitatM: habitat ? haversineM(point, habitat) : null,
    nearestStop: nearest(point, stops),
    layers,
  };
  if (status !== 'final') {
    return { ...out, pending: status === 'failed' ? 'no report grid' : REFINING_WORD };
  }
  const elevationM = terrain.elevationAt(point.lat, point.lon);
  const slopeDeg = slopeAt(terrain, point.lat, point.lon);
  if (elevationM === null || slopeDeg === null) {
    return { ...out, noData: true, sentence: 'No elevation data at this point, so the report calls any route through here NO-GO.' };
  }
  return { ...out, elevationM, slopeDeg, level: slopeClass(slopeDeg, settings), sentence: slopeSentence(slopeDeg, settings) };
}

export function inspectHtml(info) {
  const row = (label, value) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
  let terrainRows;
  if (info.pending) terrainRows = row('Elevation', info.pending) + row('Local slope', info.pending);
  else if (info.noData) terrainRows = row('Elevation', 'no data') + row('Local slope', 'no data');
  else terrainRows = row('Elevation', `${Math.round(info.elevationM)} m`) + row('Local slope', `${info.slopeDeg.toFixed(1)}°`);

  const home = info.habitatM === null ? '' : row('Back to base', km(info.habitatM));
  const stop = info.nearestStop ? row('Nearest science stop', `${info.nearestStop.item.name}, ${km(info.nearestStop.distanceM)}`) : '';
  const sentence = info.sentence ? `<p class="inspect-sentence">${esc(info.sentence)}</p>` : '';
  const scope = info.slopeDeg === undefined ? '' : '<p class="inspect-note">Local slope is the steepest direction in this 40 m cell. The report measures along the route, so a route can cross here more gently.</p>';
  const layers = info.layers.length
    ? `<h4 class="inspect-heading">Active layers here</h4><ul class="inspect-layers">${info.layers.map((l) => `<li><strong>${esc(l.label)}:</strong> ${esc(l.text)}</li>`).join('')}</ul>`
    : '';
  return `<div class="popup-title">${info.lat.toFixed(4)} N, ${info.lon.toFixed(4)} E</div>
    <dl class="inspect-values">${terrainRows}${home}${stop}</dl>${sentence}${scope}${layers}`;
}
