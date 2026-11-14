// Assumption presets. Standard is the app's defaults, unchanged. Cautious and Ambitious
// are this project's own labeled assumptions. None of these is a NASA value, and the UI
// says so wherever a preset is in use. A preset only sets the fields listed here.
import { esc } from './explain.js';
import { DEFAULT_SETTINGS, decideVerdict, formatDuration } from './report.js';

export const NOT_NASA = 'Assumptions chosen for this project, not NASA values or a NASA standard.';

export const PRESETS = Object.freeze([
  { id: 'cautious', label: 'Cautious', values: Object.freeze({ baseSpeedKmh: 3, evaHours: 6, cautionSlopeDeg: 10, maxSlopeDeg: 20 }) },
  { id: 'standard', label: 'Standard', values: Object.freeze({}) },
  { id: 'ambitious', label: 'Ambitious', values: Object.freeze({ baseSpeedKmh: 4, evaHours: 10, cautionSlopeDeg: 20, maxSlopeDeg: 30 }) },
]);

/** The full settings for a preset: the defaults, plus only what the preset changes. */
export function presetSettings(id) {
  return { ...DEFAULT_SETTINGS, ...PRESETS.find((p) => p.id === id).values };
}

/** Which preset these settings are, or null once someone has edited a value. */
export function presetOf(settings) {
  return PRESETS.find((p) => {
    const full = presetSettings(p.id);
    return Object.keys(full).every((k) => full[k] === settings[k]);
  }) ?? null;
}

/** A short name for the settings in use, for labels beside a result. */
export function presetName(settings) {
  return presetOf(settings)?.label ?? 'Custom';
}

/** The line shown beside a result, or '' for Standard, which needs no warning. */
export function presetNote(settings) {
  const name = presetName(settings);
  if (name === 'Standard') return '';
  return name === 'Custom' ? `Custom assumptions. ${NOT_NASA}` : `${name} preset. ${NOT_NASA}`;
}

/**
 * The same route under two sets of assumptions.
 * @param {(settings: object) => object} measure measures the route on the map
 */
export function compareVerdicts(measure, before, after) {
  const side = (settings) => {
    const m = measure(settings);
    const verdict = decideVerdict(m, settings);
    return { name: presetName(settings), level: verdict.level, m, settings };
  };
  return { before: side(before), after: side(after) };
}

const WORDS = { go: 'GO', caution: 'CAUTION', nogo: 'NO-GO' };

function compareColumn(title, side) {
  const s = side.settings;
  return `<div class="compare-side" data-level="${side.level}">
    <div class="compare-title">${esc(title)}: ${esc(side.name)}</div>
    <div class="compare-word">${WORDS[side.level]}</div>
    <dl>
      <div><dt>Slope limits</dt><dd>${s.cautionSlopeDeg}° / ${s.maxSlopeDeg}°</dd></div>
      <div><dt>Walking speed</dt><dd>${s.baseSpeedKmh} km/h</dd></div>
      <div><dt>EVA used</dt><dd>${formatDuration(side.m.evaUsedH)} of ${s.evaHours} h</dd></div>
    </dl>
  </div>`;
}

/** Before and after, side by side. The caller passes null until the report grid arrives. */
export function compareHtml(comparison, pendingWord) {
  const body = comparison
    ? `<div class="compare-sides">${compareColumn('Before', comparison.before)}${compareColumn('Now', comparison.after)}</div>`
    : `<p class="fine">${esc(pendingWord)}</p>`;
  return `<h4 class="eyebrow">Same route, before and after</h4>${body}`;
}
