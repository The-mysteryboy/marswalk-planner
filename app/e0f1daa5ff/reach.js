// Reachable science: can each of the nine stops be reached on foot from the base? It runs
// the report on the straight route, and the safest-route search where slope rules that out.
// Slope and time stay two separate questions, and neither becomes a score. The check runs
// in the worker on the 40 m report grid, so a preview can never reach it.
import { esc } from './explain.js';
import { findRoute } from './pathfind.js';
import { presetName } from './presets.js';
import { decideVerdict, formatDuration, measureRoute, turnBackPoint } from './report.js';

// Stops sit close together in pairs, so their labels go opposite ways.
export const TAG_SIDES = Object.freeze({
  oeb: 'top', wbf: 'right', rochette: 'bottom', brac: 'left', skinner: 'top', wildcat: 'left', threeforks: 'bottom', cometgeyser: 'top', cheyava: 'top',
});

const brief = (m, settings) => ({
  level: decideVerdict(m, settings).level,
  distanceM: m.distanceM,
  maxSlopeDeg: m.maxSlopeDeg,
  maxSlopeAtM: m.maxSlopeAtM,
  evaUsedH: m.evaUsedH,
});

/** One stop under one set of assumptions. Every number comes from the standard report. */
export function checkStop(stop, habitat, terrain, slopes, settings) {
  const goal = { lat: stop.lat, lon: stop.lon };
  const straight = measureRoute([habitat, goal], habitat, terrain, settings);
  const result = { id: stop.id, name: stop.name, atBase: straight.samples.length < 2, straight: brief(straight, settings), route: 'straight', reason: '', points: [habitat, goal] };

  let measured = straight;
  if (straight.leavesCoverage || straight.maxSlopeDeg > settings.maxSlopeDeg) {
    const found = findRoute(slopes, terrain.meta, habitat, goal, settings);
    measured = found.points ? measureRoute(found.points, habitat, terrain, settings) : null;
    // The search should rule this out. It is checked anyway, with the report itself.
    if (measured && !measured.leavesCoverage && measured.maxSlopeDeg <= settings.maxSlopeDeg) {
      result.route = 'safest';
      result.points = found.points;
    } else {
      result.route = 'none';
      result.reason = found.none ?? 'no-path';
      result.points = [];
      return { ...result, used: null, slopeOk: false, timeOk: false };
    }
  }

  const point = turnBackPoint(measured, settings);
  return {
    ...result,
    used: brief(measured, settings),
    slopeOk: true,
    timeOk: point.kind === 'fits',
    turnBackM: point.kind === 'turn' ? point.atM : null,
  };
}

const km = (m) => (m / 1000).toFixed(2);
const WORDS = { go: 'GO', caution: 'CAUTION', nogo: 'NO-GO' };

/** The standard report's verdict on the route shown. */
export function reportWords(r) {
  return r.used ? `Report: ${WORDS[r.used.level]}` : `Straight route's report: ${WORDS[r.straight.level]}`;
}

/** SLOPE: does a route exist under the limit? */
export function slopeWords(r) {
  if (r.atBase) return 'SLOPE: yes, this is your base';
  if (r.route === 'straight') return 'SLOPE: yes, by the straight route';
  if (r.route === 'safest') return `SLOPE: yes, by the safest route. The straight route reaches ${r.straight.maxSlopeDeg.toFixed(1)}°`;
  if (r.reason.endsWith('no-data')) return 'SLOPE: not reachable, no elevation data';
  return 'SLOPE: not reachable under our assumed slope limit';
}

/** TIME: does the round trip fit the budget? */
export function timeWords(r) {
  if (!r.slopeOk) return 'TIME: not checked, no route';
  if (r.timeOk) return 'TIME: the round trip fits';
  return r.turnBackM === null ? 'TIME: does not fit, even the first step' : `TIME: does not fit. Turn back by ${km(r.turnBackM)} km`;
}

/** The label beside a stop on the map, and the class that colours it. */
export function stopTag(r) {
  if (!r.slopeOk) return { text: 'No route', level: 'nogo' };
  const way = r.atBase ? 'Base' : r.route === 'safest' ? 'Safest route' : 'Straight route';
  return r.timeOk ? { text: way, level: 'go' } : { text: `${way}, over time`, level: 'caution' };
}

/** A line built only from the results. */
export function summaryLine(results) {
  const slopeOk = results.filter((r) => r.slopeOk).length;
  const both = results.filter((r) => r.slopeOk && r.timeOk).length;
  const base = results.some((r) => r.atBase) ? ' One of them is your base.' : '';
  return `${both} of ${results.length} stops are reachable under our assumed limits. SLOPE: ${slopeOk} have a route under the slope limit. TIME: ${both} of those round trips fit the time budget.${base}`;
}

/** Which assumptions these results belong to. */
export function basisLine(settings) {
  const name = presetName(settings);
  const label = name === 'Custom' ? 'Custom assumptions' : `${name} preset`;
  return `${label}: slope limit ${settings.maxSlopeDeg}°, time budget ${settings.evaHours} h, walking ${settings.baseSpeedKmh} km/h on flat ground, ${settings.scienceMinutes} min of science. Changing an assumption checks every stop again.`;
}

function row(r, settings) {
  const shown = r.used ?? r.straight;
  const steepest = r.atBase ? '-' : `${shown.maxSlopeDeg.toFixed(1)}° at ${km(shown.maxSlopeAtM)} km`;
  const trip = r.used ? `${formatDuration(r.used.evaUsedH)} of ${settings.evaHours} h` : 'No route';
  const name = r.points.length && !r.atBase
    ? `<button type="button" class="linklike" data-reach-stop="${esc(r.id)}">${esc(r.name)}</button>`
    : esc(r.name);
  return `<tr class="reach-name"><th scope="rowgroup" colspan="4">${name}</th></tr>
    <tr data-level="${stopTag(r).level}"><td>${esc(slopeWords(r))}<br>${esc(timeWords(r))}<br>${esc(reportWords(r))}</td><td>${km(shown.distanceM)} km</td><td>${steepest}</td><td>${trip}</td></tr>`;
}

export function reachHtml(results, settings) {
  return `<p class="reach-summary">${esc(summaryLine(results))}</p>
    <p class="fine">${esc(basisLine(settings))}</p>
    <table class="reach-table">
      <thead><tr><th scope="col">Result</th><th scope="col">Distance</th><th scope="col">Steepest slope</th><th scope="col">Round trip</th></tr></thead>
      ${results.map((r) => `<tbody>${row(r, settings)}</tbody>`).join('')}
    </table>
    <p class="fine">Choose a stop's name to load that route and its report.</p>`;
}
