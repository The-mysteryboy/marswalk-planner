// Mission scenarios: a sourced story, a preset route, and a goal checked by the real
// report. No numbers are stored here. Every number a scenario shows is read from the
// report for the route on the map, so a result can never drift from the engine. The
// routes come from tools/find_scenarios.mjs, and tests/scenarios.test.mjs checks them.
import { esc } from './explain.js';
import { presetNote } from './presets.js';
import { REFINING_WORD, decideVerdict, formatDuration, stopsNearRoute } from './report.js';
import { haversineM } from './route.js';

const km = (m) => `${(m / 1000).toFixed(2)} km`;
const deg = (d) => `${d.toFixed(1)}°`;
const WORDS = { go: 'GO', caution: 'CAUTION', nogo: 'NO-GO' };

const DELTA_SOURCE = { name: 'NASA Trek HiRISE mosaic record', url: 'https://trek.nasa.gov/tiles/Mars/EQ/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd/1.0.0/WMTSCapabilities.xml' };

const near = (r) => stopsNearRoute(r.stops, r.m.samples, r.settings.stopRadiusKm);

export const SCENARIOS = [
  {
    id: 'delta',
    title: 'Landing site to the delta front',
    blurb: 'Walk from where Perseverance landed to the rocks of the ancient delta.',
    route: [{ stop: 'oeb' }, { stop: 'threeforks' }, { stop: 'wildcat' }],
    captions: [
      { stop: 'oeb' },
      { stop: 'threeforks' },
      { stop: 'wildcat' },
      { computed: (r) => `On foot, this route is ${km(r.m.distanceM)} one way. The report gives ${WORDS[r.verdict.level]}, with a steepest step of ${deg(r.m.maxSlopeDeg)}.` },
    ],
    goal: 'Reach Wildcat Ridge without a NO-GO.',
    check: (r) => {
      const wildcat = r.stops.find((s) => s.id === 'wildcat');
      const gapM = haversineM(r.points.at(-1), wildcat);
      if (gapM > 100) return { pass: false, text: `The route ends ${km(gapM)} from Wildcat Ridge.` };
      if (r.verdict.level === 'nogo') return { pass: false, text: 'The route reaches Wildcat Ridge, but the report says NO-GO.' };
      return { pass: true, text: `The route reaches Wildcat Ridge, and the report says ${WORDS[r.verdict.level]}.` };
    },
  },
  {
    id: 'scarp',
    title: 'The scarp that turns a route NO-GO',
    blurb: 'See how one steep climb changes the verdict.',
    route: [{ stop: 'oeb' }, { lat: 18.43396, lon: 77.44302 }, { lat: 18.45263, lon: 77.40776 }, { lat: 18.45865, lon: 77.40592 }, { lat: 18.4669, lon: 77.4298 }, { lat: 18.4731, lon: 77.4214 }],
    captions: [
      { text: 'Perseverance went to Jezero to investigate an ancient delta for evidence of past microbial life.', source: DELTA_SOURCE },
      { computed: (r) => (r.before ? `Without the last waypoint, this route is ${WORDS[r.before.level]}, with a steepest step of ${deg(r.before.m.maxSlopeDeg)}.` : 'Add at least two waypoints to compare the last leg.') },
      { computed: (r) => `The last leg climbs the scarp. Slope reaches ${deg(r.m.maxSlopeDeg)} at ${km(r.m.maxSlopeAtM)}, and the limit is ${r.settings.maxSlopeDeg}° (assumption).` },
    ],
    goal: 'Find the one leg that turns this route NO-GO.',
    check: (r) => {
      const overLimit = r.verdict.level === 'nogo' && r.m.maxSlopeDeg > r.settings.maxSlopeDeg;
      if (!overLimit) return { pass: false, text: 'The route does not go over the slope limit.' };
      if (!r.before || r.before.level === 'nogo') return { pass: false, text: 'The route is over the limit even without its last leg.' };
      return { pass: true, text: `One leg changes ${WORDS[r.before.level]} to NO-GO, at ${deg(r.m.maxSlopeDeg)}.` };
    },
  },
  {
    id: 'longest',
    title: 'The longest straight walk that stays GO',
    blurb: 'See how far you can walk before time runs short.',
    route: [{ stop: 'oeb' }, { lat: 18.565073973, lon: 77.539868789 }],
    captions: [
      { computed: (r) => `The budget sets the range: ${r.settings.evaHours} h of EVA, ${r.settings.scienceMinutes} min of science, and ${r.settings.minMarginPct}% kept in reserve. All three are assumptions.` },
      { text: 'This line is the farthest GO walk from the landing site, found by trying every 5° of bearing to the nearest 50 m with the default assumptions.', source: { name: 'tools/find_scenarios.mjs', url: 'https://github.com/The-mysteryboy/marswalk-planner/blob/main/tools/find_scenarios.mjs' } },
      { computed: (r) => `It runs ${km(r.m.distanceM)} and uses ${formatDuration(r.m.evaUsedH)}. The steepest step is only ${deg(r.m.maxSlopeDeg)}, so time sets this limit, not slope.` },
    ],
    goal: 'Use the budget right up to the reserve target and stay GO.',
    check: (r) => {
      if (r.verdict.level !== 'go') return { pass: false, text: `The report says ${WORDS[r.verdict.level]}.` };
      const spare = r.m.marginPct - r.settings.minMarginPct;
      if (spare >= 1) return { pass: false, text: `It is GO, with ${r.m.marginPct.toFixed(1)}% in reserve, so there is room to walk farther.` };
      return { pass: true, text: `GO, with ${r.m.marginPct.toFixed(1)}% in reserve against a ${r.settings.minMarginPct}% target.` };
    },
  },
  {
    id: 'stops',
    title: 'Every science stop on one GO route',
    blurb: 'One straight walk that passes near all nine science stops.',
    route: [{ stop: 'oeb' }, { stop: 'cometgeyser' }],
    captions: [
      { stop: 'cheyava' },
      { stop: 'cometgeyser' },
      { computed: (r) => `One straight leg passes within ${r.settings.stopRadiusKm} km (assumption) of ${near(r).length} of the ${r.stops.length} stops. The farthest is ${km(Math.max(...near(r).map((s) => s.distanceM), 0))} off the route, so this is passing nearby, not visiting.` },
    ],
    goal: 'Pass every science stop and stay GO.',
    check: (r) => {
      const count = near(r).length;
      if (r.verdict.level !== 'go') return { pass: false, text: `The report says ${WORDS[r.verdict.level]}.` };
      if (count < r.stops.length) return { pass: false, text: `GO, but only ${count} of ${r.stops.length} stops are near the route.` };
      return { pass: true, text: `GO, with all ${count} stops within ${r.settings.stopRadiusKm} km of the route.` };
    },
  },
];

/** The scenario's route as points. The first point is the habitat. */
export function scenarioRoute(scenario, stops) {
  return scenario.route.map((p) => {
    if (!p.stop) return p;
    const stop = stops.find((s) => s.id === p.stop);
    return { lat: stop.lat, lon: stop.lon };
  });
}

function sameRoute(a, b) {
  return a.length === b.length && a.every((p, i) => haversineM(p, b[i]) < 1);
}

/**
 * Everything the panel shows for one scenario, from the report for the route on the map.
 * @param {object} scenario
 * @param {{m: object, verdict: object, settings: object, status: string}|null} report
 * @param {{stops: object[], points: object[], measure: (points: object[]) => object}} ctx
 */
export function scenarioView(scenario, report, { stops, points, measure }) {
  const edited = !sameRoute(points, scenarioRoute(scenario, stops));
  const isFinal = report?.status === 'final';
  const pendingWord = report?.status === 'failed' ? 'no report grid' : REFINING_WORD;
  let facts = null;
  if (isFinal) {
    const shorter = points.slice(0, -1);
    let before = null;
    if (shorter.length > 1) {
      const m = measure(shorter);
      before = { m, level: decideVerdict(m, report.settings).level };
    }
    facts = { ...report, stops, points, before };
  }
  const captions = scenario.captions.map((c) => {
    if (c.computed) return { text: facts ? c.computed(facts) : pendingWord, source: null, computed: true };
    if (c.stop) {
      const stop = stops.find((s) => s.id === c.stop);
      return { text: `${stop.name}: ${stop.why}`, source: { name: stop.source_name, url: stop.source_url } };
    }
    return c;
  });
  return {
    id: scenario.id,
    title: scenario.title,
    goal: scenario.goal,
    edited,
    captions,
    result: facts ? scenario.check(facts) : null,
    pendingWord,
    ranUnder: report ? presetNote(report.settings) : '',
  };
}

export function scenarioHtml(view, step) {
  const caption = view.captions[step];
  const source = caption.source
    ? `<a href="${esc(caption.source.url)}" target="_blank" rel="noopener">Source: ${esc(caption.source.name)}</a>`
    : caption.computed ? 'From the report for this route.' : '';
  const result = view.result
    ? `<p class="goal-result" data-pass="${view.result.pass}"><strong>${view.result.pass ? 'Goal met' : 'Goal not met'}:</strong> ${esc(view.result.text)}</p>`
    : `<p class="goal-result"><strong>${esc(view.pendingWord)}</strong></p>`;
  const edited = view.edited ? '<p class="fine">You changed this route, so the result is for your version.</p>' : '';
  const ranUnder = view.ranUnder ? `<p class="fine"><span class="tag-assumption">ASSUMPTION</span> Ran under: ${esc(view.ranUnder)}</p>` : '';
  return `<h3 class="scenario-title">${esc(view.title)}</h3>
    <p class="scenario-caption">${esc(caption.text)}</p>
    <p class="scenario-source">${source}</p>
    <div class="scenario-nav">
      <button type="button" class="btn" data-scenario-step="-1"${step === 0 ? ' disabled' : ''}>Back</button>
      <span class="scenario-count">${step + 1} of ${view.captions.length}</span>
      <button type="button" class="btn" data-scenario-step="1"${step === view.captions.length - 1 ? ' disabled' : ''}>Next</button>
    </div>
    <p class="scenario-goal"><strong>Goal:</strong> ${esc(view.goal)}</p>
    ${result}${edited}${ranUnder}`;
}
