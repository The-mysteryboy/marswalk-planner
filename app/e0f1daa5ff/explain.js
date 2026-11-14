// Plain-English explanations of the route report. Pure functions, no DOM. Every number
// here comes from measureRoute, the settings or a source in SOURCES.md. Nothing is
// estimated separately from what the report itself shows.
import { WALKING_MODEL, formatDuration } from './report.js';

const SOURCES = {
  dem: { name: 'USGS Mars 2020 CTX DEM mosaic', url: 'https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic' },
  rover: { name: 'NASA/JPL Perseverance waypoints', url: 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json' },
  radius: { name: 'NASA Mars Fact Sheet', url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html' },
  tobler: { name: 'Tobler 1993', url: WALKING_MODEL.source_url },
};

// tests/accuracy.test.mjs recomputes these on every run.
const GRID_CHECK = "Compared with 708 points on Perseverance's route (about 3 m typical difference, 3.1 m RMS): RMS difference 3.084 m, mean difference -0.836 m. This is a comparison, not an independent measurement.";

const km = (m) => `${(m / 1000).toFixed(2)} km`;
const deg = (d) => `${d.toFixed(1)}°`;
const metres = (m) => `${Math.round(m)} m`;

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

/**
 * The Why? list: every rule the route was checked against, failed ones first. The failed
 * lines are the verdict's own reasons, so the two can never disagree.
 */
export function whyList(m, verdict, s) {
  const failed = verdict.reasons.filter((r) => r.level !== 'ok');
  const passed = [];
  if (!m.leavesCoverage) passed.push('The whole route has elevation data.');
  if (m.maxSlopeDeg <= s.maxSlopeDeg) passed.push(`Max slope ${deg(m.maxSlopeDeg)} is within the ${s.maxSlopeDeg}° No-Go limit (assumption).`);
  if (m.maxSlopeDeg <= s.cautionSlopeDeg) passed.push(`Max slope ${deg(m.maxSlopeDeg)} is within the ${s.cautionSlopeDeg}° caution limit (assumption).`);
  if (m.evaUsedH <= s.evaHours) passed.push(`Round trip plus science takes ${formatDuration(m.evaUsedH)}, within the ${s.evaHours} h EVA budget (assumption).`);
  if (m.marginPct >= s.minMarginPct && m.evaUsedH <= s.evaHours) passed.push(`${m.marginPct.toFixed(0)}% of the EVA budget stays in reserve, at or above the ${s.minMarginPct}% target (assumption).`);
  return [...failed, ...passed.map((text) => ({ level: 'ok', text }))];
}

/** The two samples either side of the steepest step, for a worked example. */
function steepestStep(m) {
  const i = m.samples.findIndex((x, n) => n > 0 && x.d === m.maxSlopeAtM && x.slopeDeg === m.maxSlopeDeg);
  return i > 0 ? { a: m.samples[i - 1], b: m.samples[i] } : null;
}

// The plain name shown beside the number, then the exact term.
const TITLES = {
  verdict: 'Why this result',
  slope: 'Steepest slope (max slope)',
  time: 'Walk out (walking time, one way)',
  back: 'Walk back (return leg)',
  eva: 'Total time outside (EVA time used)',
  margin: 'Time to spare (EVA budget left)',
  abort: 'Farthest from base (max abort distance)',
  climb: 'Climb / drop (ascent / descent)',
};

const walkInputs = (s) => [
  { label: 'Speed on flat ground', value: `${s.baseSpeedKmh} km/h`, assumption: true },
  { label: 'Route sampled every', value: `${s.sampleStepM} m` },
];

const WALK_ASSUMPTION = 'Tobler fitted this model to people hiking on Earth. It is not a NASA EVA model, and it does not model a spacesuit.';

const ITEMS = {
  distance: ({ m, legs }) => ({
    title: 'Distance, one way',
    value: km(m.distanceM),
    rule: 'Each leg is the shortest path over a sphere the size of Mars (the haversine formula), and the legs are added up. It is map distance, so climbing does not add length.',
    inputs: [{ label: 'Legs from the habitat', value: String(legs) }, { label: 'Mars mean radius', value: '3389.5 km' }],
    assumptions: ['Mars is treated as a sphere.'],
    sources: [SOURCES.radius],
  }),

  slope: ({ m, s, previewCellM }) => {
    const step = steepestStep(m);
    const inputs = step ? [
      { label: 'Elevation before the steepest step', value: `${step.a.z.toFixed(1)} m` },
      { label: 'Elevation after it', value: `${step.b.z.toFixed(1)} m` },
      { label: 'Rise or drop', value: `${Math.abs(step.b.z - step.a.z).toFixed(1)} m` },
      { label: 'Run', value: `${(step.b.d - step.a.d).toFixed(1)} m` },
    ] : [{ label: 'Steepest step', value: 'no data on this route' }];
    inputs.push({ label: 'Caution limit', value: `${s.cautionSlopeDeg}°`, assumption: true });
    inputs.push({ label: 'No-Go limit', value: `${s.maxSlopeDeg}°`, assumption: true });
    return {
      title: TITLES.slope,
      value: step ? `${deg(m.maxSlopeDeg)} at ${km(m.maxSlopeAtM)}` : 'no data',
      rule: `The route is sampled every ${s.sampleStepM} m. Each step's slope is atan(rise / run) on the 40 m elevation grid, and the report shows the steepest step. The ${previewCellM} m preview grid is never used for this.`,
      inputs,
      notes: [
        'This is the slope in the direction you walk. The same ground can be steeper if you cross it head-on.',
        'Anything smaller than a 40 m grid cell is not in the elevation data, so a boulder or a small ledge is not in this number.',
        GRID_CHECK,
      ],
      assumptions: ['Both slope limits are planning placeholders for this tool, not NASA requirements.'],
      sources: [SOURCES.dem, SOURCES.rover],
    };
  },

  time: ({ m, s }) => ({
    title: TITLES.time,
    value: formatDuration(m.outH),
    rule: `Each step takes its length divided by the speed on its grade, and the steps are added up. ${WALKING_MODEL.formula}, where grade is rise / run.`,
    inputs: [...walkInputs(s), { label: 'Average speed on this route', value: `${(m.distanceM / 1000 / m.outH).toFixed(2)} km/h` }],
    assumptions: [WALK_ASSUMPTION],
    sources: [SOURCES.tobler, SOURCES.dem],
  }),

  back: ({ m, s }) => ({
    title: TITLES.back,
    value: formatDuration(m.backH),
    rule: 'The way back follows the same route in reverse, so every uphill step becomes downhill and every downhill step becomes uphill. It uses the same speed formula, which is why it is not simply the time out again.',
    inputs: [...walkInputs(s), { label: 'Time out', value: formatDuration(m.outH) }, { label: 'Time back', value: formatDuration(m.backH) }],
    assumptions: [WALK_ASSUMPTION],
    sources: [SOURCES.tobler, SOURCES.dem],
  }),

  eva: ({ m, s }) => ({
    title: TITLES.eva,
    value: `${formatDuration(m.evaUsedH)} of ${s.evaHours} h`,
    rule: 'EVA means extravehicular activity: time spent outside the habitat. EVA time used = walk out + walk back + science time. Going over the budget is No-Go.',
    inputs: [
      { label: 'Walk out', value: formatDuration(m.outH) },
      { label: 'Walk back', value: formatDuration(m.backH) },
      { label: 'Science time', value: `${s.scienceMinutes} min`, assumption: true },
      { label: 'EVA budget', value: `${s.evaHours} h`, assumption: true },
    ],
    assumptions: ['The EVA budget and the science time are placeholders chosen for this tool, not NASA specifications.', WALK_ASSUMPTION],
    sources: [SOURCES.tobler],
  }),

  margin: ({ m, s }) => ({
    title: TITLES.margin,
    value: `${m.marginPct.toFixed(0)}%`,
    rule: `Budget left = 1 - (EVA time used / EVA budget). Under the ${s.minMarginPct}% reserve target is Caution.`,
    inputs: [
      { label: 'EVA time used', value: formatDuration(m.evaUsedH) },
      { label: 'EVA budget', value: `${s.evaHours} h`, assumption: true },
      { label: 'Reserve target', value: `${s.minMarginPct}%`, assumption: true },
    ],
    assumptions: ['The budget and the reserve target are placeholders chosen for this tool, not NASA specifications.'],
    sources: [],
  }),

  abort: ({ m }) => ({
    title: TITLES.abort,
    value: `${km(m.abort.maxM)} at ${km(m.abort.atM)}`,
    rule: 'The straight-line distance to the habitat is measured from every route sample, and the report shows the largest. The dotted line on the map joins that point to the habitat.',
    inputs: [{ label: 'Farthest point along the route', value: km(m.abort.atM) }, { label: 'Mars mean radius', value: '3389.5 km' }],
    notes: ['The dotted line is not a checked walking route, and this number does not change the verdict.'],
    assumptions: ['Mars is treated as a sphere.'],
    sources: [SOURCES.radius],
  }),

  climb: ({ m, s }) => ({
    title: TITLES.climb,
    value: `+${metres(m.ascentM)} / -${metres(m.descentM)}`,
    rule: `Every rise between two route samples is added to the ascent, and every drop to the descent. Samples are ${s.sampleStepM} m apart on the 40 m elevation grid.`,
    inputs: [{ label: 'Net change along the route', value: metres(m.ascentM - m.descentM) }],
    notes: [GRID_CHECK],
    assumptions: [],
    sources: [SOURCES.dem, SOURCES.rover],
  }),
};

// Distance and abort distance use positions only, so a preview grid cannot change them.
const NEEDS_REPORT_GRID = new Set(['verdict', 'slope', 'time', 'back', 'eva', 'margin', 'climb']);


const LEVEL_WORDS = { go: 'GO', caution: 'CAUTION', nogo: 'NO-GO' };

/**
 * One explanation, using this route's real values. Anything that depends on elevation
 * waits for the 40 m grid, so nothing here can present a preview as an answer.
 * @param {string} key verdict, distance, slope, time, back, eva, margin, abort or climb
 * @param {{m: object, verdict: object, settings: object, status: string, legs: number, previewCellM: number}} report
 */
export function explainItem(key, { m, verdict, settings, status, legs, previewCellM }) {
  if (status !== 'final' && NEEDS_REPORT_GRID.has(key)) {
    const text = status === 'failed'
      ? 'The 40 m report grid did not load, so this cannot be worked out. Reload the page to try again.'
      : 'Refining... This appears when the 40 m report grid has loaded.';
    return { key, pending: true, title: TITLES[key], text };
  }
  if (key === 'verdict') {
    return {
      key,
      title: 'Why this verdict',
      value: LEVEL_WORDS[verdict.level],
      why: whyList(m, verdict, settings),
      rule: 'Any NO-GO line makes the route NO-GO. Otherwise any CAUTION line makes it CAUTION. If every line passes, it is GO. Exactly at a limit passes.',
      assumptions: ['Every limit marked (assumption) is a planning placeholder for this tool, not a NASA requirement. Change them in More tools, under Assumptions.'],
      sources: [],
    };
  }
  return { key, ...ITEMS[key]({ m, s: settings, legs, previewCellM }) };
}

const TAG = '<span class="tag-assumption">ASSUMPTION</span>';
const WHY_PREFIX = { nogo: 'NO-GO', caution: 'CAUTION', ok: 'Passed' };

/** The explanation as HTML. */
export function explainHtml(item) {
  const head = `<h3 class="explain-title">${esc(item.title)}${item.value ? `: <span>${esc(item.value)}</span>` : ''}</h3>`;
  if (item.pending) return `${head}<p class="explain-rule">${esc(item.text)}</p>`;
  const why = item.why
    ? `<ul class="why-list">${item.why.map((r) => `<li class="why-${r.level}"><strong>${WHY_PREFIX[r.level]}:</strong> ${esc(r.text)}</li>`).join('')}</ul>`
    : '';
  const inputs = item.inputs?.length
    ? `<dl class="explain-inputs">${item.inputs.map((i) => `<div><dt>${esc(i.label)}</dt><dd>${esc(i.value)}${i.assumption ? ` ${TAG}` : ''}</dd></div>`).join('')}</dl>`
    : '';
  const notes = (item.notes ?? []).map((n) => `<p class="explain-note">${esc(n)}</p>`).join('');
  const assumptions = item.assumptions.map((a) => `<p class="explain-note">${TAG} ${esc(a)}</p>`).join('');
  const sources = item.sources.length
    ? `<p class="explain-note">Source: ${item.sources.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a>`).join(', ')}</p>`
    : '';
  return `${head}${why}<p class="explain-rule">${esc(item.rule)}</p>${inputs}${notes}${assumptions}${sources}`;
}
