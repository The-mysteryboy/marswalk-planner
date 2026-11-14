// Route report: slope, time, abort distance, budget and verdict.
// Pure functions, no DOM. Every default below is an ASSUMPTION shown as such in
// the UI and README, and every one can be edited in the Assumptions panel.
import { haversineM, samplePath } from './route.js';
import { slopeFromRise } from './terrain.js';

export const DEFAULT_SETTINGS = Object.freeze({
  sampleStepM: 50,      // Route sampling interval. About one DEM cell.
  baseSpeedKmh: 3.5,    // Walking speed on flat ground.
  evaHours: 8,          // Placeholder EVA length. Not a NASA specification.
  scienceMinutes: 60,   // Time spent working at stops during the EVA.
  maxSlopeDeg: 25,      // Any slope above this is No-Go.
  cautionSlopeDeg: 15,  // Any slope above this is Caution.
  minMarginPct: 25,     // A spare budget under this is Caution.
  stopRadiusKm: 2,      // How far from the route a science stop can be.
});

export const WALKING_MODEL = Object.freeze({
  name: 'Tobler hiking function, rescaled',
  formula: 'speed = base x exp(-3.5 x |grade + 0.05|) / exp(-3.5 x 0.05)',
  source_name: 'Tobler (1993), Three Presentations on Geographical Analysis and Modeling, NCGIA Technical Report 93-1',
  source_url: 'https://escholarship.org/content/qt05r820mz/qt05r820mz.pdf',
});

/**
 * Walking speed in km/h on a grade (rise / run, uphill positive).
 * Tobler's W = 6 exp(-3.5 |S + 0.05|) gives about 5 km/h on flat ground for a
 * person hiking on Earth. Dividing by the flat-ground value keeps his shape but
 * makes flat ground equal the chosen base speed.
 */
export function walkingSpeedKmh(grade, baseKmh) {
  return (baseKmh * Math.exp(-3.5 * Math.abs(grade + 0.05))) / Math.exp(-3.5 * 0.05);
}

/** Turn a list of points into per-sample and whole-route measurements. */
export function measureRoute(points, habitat, terrain, settings) {
  const samples = samplePath(points, settings.sampleStepM).map((s) => ({
    ...s,
    z: terrain.elevationAt(s.lat, s.lon),
    abortM: haversineM(s, habitat),
    slopeDeg: null,
    outH: 0,  // Running time out to here.
    backH: 0, // Running time for the same ground, walked in the other direction.
  }));

  let outH = 0;
  let backH = 0;
  let ascentM = 0;
  let descentM = 0;
  let maxSlopeDeg = 0;
  let maxSlopeAtM = 0;
  let uncoveredM = 0;
  const base = settings.baseSpeedKmh;

  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const run = b.d - a.d;
    if (a.z === null || b.z === null) {
      // No terrain here, so walk it at the base speed. The route is No-Go
      // anyway, but the time shown should not silently drop this stretch.
      uncoveredM += run;
      outH += run / 1000 / base;
      backH += run / 1000 / base;
      b.outH = outH;
      b.backH = backH;
      continue;
    }
    const rise = b.z - a.z;
    const grade = rise / run;
    const slope = slopeFromRise(rise, run);
    b.slopeDeg = slope;
    if (slope > maxSlopeDeg) {
      maxSlopeDeg = slope;
      maxSlopeAtM = b.d;
    }
    if (rise > 0) ascentM += rise; else descentM -= rise;
    outH += run / 1000 / walkingSpeedKmh(grade, base);
    // The way back crosses the same ground in reverse, so the grade flips.
    backH += run / 1000 / walkingSpeedKmh(-grade, base);
    b.outH = outH;
    b.backH = backH;
  }

  let worst = samples[0] ?? null;
  for (const s of samples) if (s.abortM > worst.abortM) worst = s;

  const covered = samples.length > 0 && samples.every((s) => s.z !== null);
  const walkH = outH + backH;
  const evaUsedH = walkH + settings.scienceMinutes / 60;

  return {
    samples,
    distanceM: samples.at(-1)?.d ?? 0,
    outH,
    backH,
    walkH,
    evaUsedH,
    marginPct: (1 - evaUsedH / settings.evaHours) * 100,
    ascentM,
    descentM,
    maxSlopeDeg,
    maxSlopeAtM,
    abort: worst ? { maxM: worst.abortM, atM: worst.d, lat: worst.lat, lon: worst.lon } : null,
    leavesCoverage: samples.length > 0 && !covered,
    uncoveredM,
  };
}

/** Stretches of the route steeper than the caution limit, merged and rated. */
export function steepSections(samples, settings) {
  const sections = [];
  let current = null;
  // If someone sets the caution limit above the No-Go limit, still flag No-Go ground.
  const limit = Math.min(settings.cautionSlopeDeg, settings.maxSlopeDeg);
  for (let i = 1; i < samples.length; i++) {
    const s = samples[i];
    if (s.slopeDeg !== null && s.slopeDeg > limit) {
      if (!current) {
        current = { fromM: samples[i - 1].d, toM: s.d, maxDeg: s.slopeDeg };
        sections.push(current);
      }
      current.toM = s.d;
      current.maxDeg = Math.max(current.maxDeg, s.slopeDeg);
    } else {
      current = null;
    }
  }
  return sections.map((x) => ({ ...x, severity: x.maxDeg > settings.maxSlopeDeg ? 'nogo' : 'caution' }));
}

const km = (m) => `${(m / 1000).toFixed(2)} km`;

/**
 * The last sample a walker can reach and still be back inside the time budget, using
 * the report's own running times: out to the point, back from it, plus the science time.
 * Exactly at the budget fits, as it does in the verdict. Time at the far end is the same
 * wherever it is spent, so the total only rises along the route.
 */
export function turnBackPoint(m, settings) {
  const { samples } = m;
  const scienceH = settings.scienceMinutes / 60;
  const usedH = (s) => s.outH + s.backH + scienceH;
  if (usedH(samples.at(-1)) <= settings.evaHours) return { kind: 'fits', spareH: settings.evaHours - m.evaUsedH };
  const first = samples[1] ?? samples[0];
  if (usedH(first) > settings.evaHours) return { kind: 'none', firstM: first.d, firstH: usedH(first) };
  let i = 1;
  while (usedH(samples[i + 1]) <= settings.evaHours) i += 1;
  const s = samples[i];
  return {
    kind: 'turn',
    index: i,
    lat: s.lat,
    lon: s.lon,
    atM: s.d,
    outH: s.outH,
    backH: s.backH,
    usedH: usedH(s),
    nextM: samples[i + 1].d,
    nextH: usedH(samples[i + 1]),
  };
}

/** The turn-back point in words, with the numbers behind it. */
export function turnBackText(point, m, settings) {
  const limit = `our assumed ${settings.evaHours} h limit`;
  const science = formatDuration(settings.scienceMinutes / 60);
  let text = `The whole round trip fits: ${formatDuration(m.evaUsedH)} of ${limit}, with ${formatDuration(point.spareH)} to spare.`;
  if (point.kind === 'none') text = `Even the first ${km(point.firstM)} does not fit: there and back with ${science} of science takes ${formatDuration(point.firstH)}, over ${limit}.`;
  if (point.kind === 'turn') text = `Turn back by ${km(point.atM)}: ${formatDuration(point.outH)} out, ${science} of science and ${formatDuration(point.backH)} back make ${formatDuration(point.usedH)}, within ${limit}. Going on to ${km(point.nextM)} would take ${formatDuration(point.nextH)}.`;
  return m.leavesCoverage ? `${text} Stretches with no elevation data use the flat-ground speed.` : text;
}

/** The Go / Caution / No-Go rules. Exactly at a limit passes: only "exceeds" fails. */
export function decideVerdict(m, settings) {
  const reasons = [];
  const budget = `${settings.evaHours} h`;

  if (m.leavesCoverage) {
    reasons.push({ level: 'nogo', text: `${km(m.uncoveredM)} of the route has no elevation data, so its safety is unknown.` });
  }
  if (m.maxSlopeDeg > settings.maxSlopeDeg) {
    reasons.push({
      level: 'nogo',
      text: `Slope reaches ${m.maxSlopeDeg.toFixed(1)}° at ${km(m.maxSlopeAtM)}; limit is ${settings.maxSlopeDeg}° (assumption).`,
      line: `Slope reaches ${m.maxSlopeDeg.toFixed(1)}° at ${km(m.maxSlopeAtM)}; our assumed limit is ${settings.maxSlopeDeg}°.`,
    });
  }
  if (m.evaUsedH > settings.evaHours) {
    reasons.push({
      level: 'nogo',
      text: `Round trip plus science takes ${formatDuration(m.evaUsedH)}; EVA budget is ${budget} (assumption).`,
      line: `Round trip plus science takes ${formatDuration(m.evaUsedH)}; our assumed time limit is ${budget}.`,
    });
  }
  if (m.maxSlopeDeg > settings.cautionSlopeDeg && m.maxSlopeDeg <= settings.maxSlopeDeg) {
    reasons.push({
      level: 'caution',
      text: `Slope reaches ${m.maxSlopeDeg.toFixed(1)}° at ${km(m.maxSlopeAtM)}; caution limit is ${settings.cautionSlopeDeg}° (assumption).`,
      line: `Slope reaches ${m.maxSlopeDeg.toFixed(1)}° at ${km(m.maxSlopeAtM)}; our assumed caution limit is ${settings.cautionSlopeDeg}°.`,
    });
  }
  if (m.marginPct < settings.minMarginPct && m.evaUsedH <= settings.evaHours) {
    reasons.push({
      level: 'caution',
      text: `Only ${m.marginPct.toFixed(0)}% of the EVA budget is left; reserve target is ${settings.minMarginPct}% (assumption).`,
      line: `Only ${m.marginPct.toFixed(0)}% of the time is left; our assumed reserve is ${settings.minMarginPct}%.`,
    });
  }

  const level = reasons.some((r) => r.level === 'nogo') ? 'nogo'
    : reasons.some((r) => r.level === 'caution') ? 'caution' : 'go';

  if (level === 'go') {
    reasons.push({
      level: 'ok',
      text: `Max slope ${m.maxSlopeDeg.toFixed(1)}° stays within the ${settings.cautionSlopeDeg}° caution limit (assumption).`,
      line: `Steepest slope ${m.maxSlopeDeg.toFixed(1)}° stays within our assumed ${settings.cautionSlopeDeg}° caution limit.`,
    });
    reasons.push({
      level: 'ok',
      text: `${m.marginPct.toFixed(0)}% of the ${budget} EVA budget (assumption) stays in reserve.`,
      line: `${m.marginPct.toFixed(0)}% of our assumed ${budget} time limit stays in reserve.`,
    });
    reasons.push({ level: 'ok', text: 'The whole route has elevation data.' });
  }
  return { level, reasons };
}

export const REFINING_WORD = 'Refining...';

const VERDICT_WORDS = { go: 'GO', caution: 'CAUTION', nogo: 'NO-GO' };

/**
 * What the verdict panel may say, given how far the grids have loaded. Only the
 * validated report grid can produce a verdict. A preview is drawn from a smoothed
 * grid that can hide a steep slope, so it never names a level, not even with a
 * label beside it, because a green tick reads as a result whatever sits next to it.
 */
export function verdictForDisplay(verdict, gridStatus, previewCellM) {
  if (gridStatus === 'final') {
    return { state: verdict.level, word: VERDICT_WORDS[verdict.level], reasons: verdict.reasons };
  }
  if (gridStatus === 'failed') {
    return {
      state: 'unavailable',
      word: 'No verdict',
      reasons: [{ level: 'ok', text: 'The 40 m report grid did not load, so no safety verdict can be given. Reload the page to try again.' }],
    };
  }
  return {
    state: 'refining',
    word: REFINING_WORD,
    reasons: [{ level: 'ok', text: `Still loading the detailed elevation map, so there is no verdict yet. The rough ${previewCellM} m preview never gives one.` }],
  };
}

/**
 * One plain sentence above the numbers, built from the same values they show. It is
 * empty until the report grid has loaded, so a preview can never reach it. A route off
 * the elevation data has no full slope or time to state, so it says only that.
 */
export function routeSentence(m, verdict, settings, gridStatus) {
  if (gridStatus !== 'final') return '';
  const lead = `This walk of ${km(m.distanceM)} each way gets a ${VERDICT_WORDS[verdict.level]}`;
  if (m.leavesCoverage) return `${lead}: ${km(m.uncoveredM)} of it has no elevation data, so its safety is unknown.`;

  const where = m.maxSlopeDeg > 0 ? ` at ${km(m.maxSlopeAtM)}` : '';
  let limit = `within our assumed caution limit of ${settings.cautionSlopeDeg}°`;
  if (m.maxSlopeDeg > settings.maxSlopeDeg) limit = `over our assumed limit of ${settings.maxSlopeDeg}°`;
  else if (m.maxSlopeDeg > settings.cautionSlopeDeg) limit = `over our assumed caution limit of ${settings.cautionSlopeDeg}°`;

  const outside = formatDuration(m.evaUsedH);
  const spare = `${m.marginPct.toFixed(0)}% of the time to spare`;
  let time = `it takes ${outside} outside with ${spare}`;
  if (m.evaUsedH > settings.evaHours) time = `it takes ${outside} outside, over our assumed time limit of ${settings.evaHours} h`;
  else if (m.marginPct < settings.minMarginPct) time = `it takes ${outside} outside with only ${spare}, under our assumed reserve of ${settings.minMarginPct}%`;

  return `${lead}: its steepest slope is ${m.maxSlopeDeg.toFixed(1)}°${where}, ${limit}, and ${time}.`;
}

/** Near stops in the order the route passes them, nearest first where two tie. */
export function alongRoute(near) {
  return [...near].sort((a, b) => a.alongM - b.alongM || a.distanceM - b.distanceM);
}

/** Science stops within radiusKm of the route, nearest first. */
export function stopsNearRoute(stops, samples, radiusKm) {
  if (samples.length === 0) return [];
  const limit = radiusKm * 1000;
  return stops
    .map((stop) => {
      let best = samples[0];
      let bestM = Infinity;
      for (const s of samples) {
        const dist = haversineM(stop, s);
        if (dist < bestM) {
          bestM = dist;
          best = s;
        }
      }
      return { ...stop, distanceM: bestM, alongM: best.d };
    })
    .filter((s) => s.distanceM <= limit)
    .sort((a, b) => a.distanceM - b.distanceM);
}

/** Per-leg numbers for the text view of the route. */
export function legTable(samples, points) {
  if (samples.length === 0 || points.length < 2) return [];
  // samplePath keeps every vertex, so each leg ends at the first sample that
  // reaches its cumulative distance. A repeated point is a zero-length leg.
  const legs = [];
  let start = 0;
  let reached = 0;
  for (let p = 1; p < points.length; p++) {
    reached += haversineM(points[p - 1], points[p]);
    let end = start;
    while (end < samples.length - 1 && samples[end].d < reached - 1e-6) end += 1;
    const part = samples.slice(start, end + 1);
    const slopes = part.slice(1).map((s) => s.slopeDeg).filter((v) => v !== null);
    legs.push({
      leg: p,
      lengthM: samples[end].d - samples[start].d,
      startZ: samples[start].z,
      endZ: samples[end].z,
      maxSlopeDeg: slopes.length ? Math.max(...slopes) : null,
    });
    start = end;
  }
  return legs;
}

/** Distance along the route of each waypoint, for marking them on the profile. */
export function waypointDistances(points) {
  const out = [];
  let d = 0;
  for (let p = 1; p < points.length; p++) {
    d += haversineM(points[p - 1], points[p]);
    out.push(d);
  }
  return out;
}

export function formatDuration(hours) {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h === 0 ? `${m} min` : `${h} h ${String(m).padStart(2, '0')} min`;
}
