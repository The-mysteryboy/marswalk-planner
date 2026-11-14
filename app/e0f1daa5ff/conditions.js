// Cited conditions. A hard-coded table of published measurements, not a forecast. Each
// entry says where and when it was measured, because the sites and dates differ. The
// latest reading from Curiosity's outreach weather feed sits beside it, fetched only when
// the panel opens. None of this feeds any verdict or any number in the report.

const JPL_WEATHER = {
  source_name: 'NASA/JPL, First weather report from Jezero Crater (Apr 6, 2021)',
  source_url: 'https://www.jpl.nasa.gov/news/nasas-first-weather-report-from-jezero-crater-on-mars/',
};

const MEDA = { instrument: 'MEDA', mission: 'Mars 2020 (Perseverance)', location: 'Jezero Crater' };

export const CONDITIONS = [
  {
    id: 'temp-high', label: 'Temperature, high', value: -22, unit: '°C', approx: true,
    date_or_sol: 'Sols 43-44 (Apr 3-4, 2021)', ...MEDA, ...JPL_WEATHER,
  },
  {
    id: 'temp-low', label: 'Temperature, low', value: -83, unit: '°C', approx: true,
    date_or_sol: 'Sols 43-44 (Apr 3-4, 2021)', ...MEDA, ...JPL_WEATHER,
  },
  {
    id: 'gust', label: 'Wind gusts', value: 10, unit: 'm/s', approx: true,
    date_or_sol: 'Sols 43-44 (Apr 3-4, 2021)', ...MEDA, ...JPL_WEATHER,
  },
  {
    // The source gives this with MEDA's first data points, not with sols 43-44.
    id: 'pressure', label: 'Pressure', value: 718, unit: 'Pa', approx: false,
    date_or_sol: 'First MEDA data, 2021. Models predicted 705-735 Pa.', ...MEDA, ...JPL_WEATHER,
  },
  {
    id: 'dust', label: 'Dust and aerosol optical depth', value: '0.5 morning, 0.4 afternoon', unit: '', approx: true,
    date_or_sol: 'First 250 sols, during the clear season. This is not a dust storm value.',
    instrument: 'MEDA SkyCam', mission: 'Mars 2020 (Perseverance)', location: 'Jezero Crater',
    source_name: 'Rodriguez-Manfredi et al. (2023), Nature Geoscience',
    source_url: 'https://www.nature.com/articles/s41561-022-01084-0',
  },
  {
    id: 'radiation', label: 'Surface radiation', value: 0.67, unit: 'mSv/day', approx: false,
    date_or_sol: 'Aug 2012 to Jun 2013, with no major solar storms. Measured at Gale, not Jezero.',
    instrument: 'RAD', mission: 'Mars Science Laboratory (Curiosity)', location: 'Gale Crater',
    source_name: 'NASA/JPL, Curiosity: human exploration help (Dec 2013)',
    source_url: 'https://www.jpl.nasa.gov/news/nasa-curiosity-first-mars-age-measurement-and-human-exploration-help/',
  },
];

export const CONDITIONS_NOTE = 'One published snapshot from each source, not a forecast or a yearly range.';

// Tested 2026-11-14: Perseverance's own feed (category=mars2020) ends at sol 1133,
// 2024-04-27, so it is not used. Curiosity's works from a browser page on this site.
export const LATEST_FEED = Object.freeze({
  url: 'https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json',
  name: "Curiosity's REMS weather feed",
  page: 'https://mars.nasa.gov/msl/weather/',
});

export const FEED_LABEL = "Outreach-grade feed, not science-grade, not live. Curiosity's weather is from Gale Crater, not Jezero.";

const DAY_MS = 86400000;
const number = (v) => (typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) ? Number(v) : NaN);

/**
 * The newest reading in the feed, or null if it is missing, a placeholder such as "--",
 * or outside what the sensor can plausibly read. Nothing partial is shown.
 * Ranges: air -140 to 40 °C, and the low no higher than the high; pressure 300 to 1300 Pa.
 */
export function latestReading(feed, today = new Date()) {
  const entries = Array.isArray(feed?.soles) ? feed.soles : [];
  if (entries.length === 0) return null;
  const newest = entries.reduce((a, b) => (number(b.sol) > number(a.sol) ? b : a));
  const sol = number(newest.sol);
  const minC = number(newest.min_temp);
  const maxC = number(newest.max_temp);
  const pressurePa = number(newest.pressure);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(newest.terrestrial_date ?? '') ? new Date(`${newest.terrestrial_date}T00:00:00Z`) : null;
  const ageDays = date ? Math.floor((Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - date.getTime()) / DAY_MS) : NaN;
  const valid = Number.isInteger(sol) && sol > 0 && ageDays >= 0
    && minC >= -140 && maxC <= 40 && minC <= maxC
    && pressurePa >= 300 && pressurePa <= 1300;
  return valid ? { sol, date: newest.terrestrial_date, ageDays, minC, maxC, pressurePa } : null;
}

export function latestLine(r) {
  const age = r.ageDays === 0 ? 'today' : r.ageDays === 1 ? '1 day ago' : `${r.ageDays} days ago`;
  return `Latest reported: sol ${r.sol} (${r.date}), ${age}, from ${LATEST_FEED.name}. Air ${r.minC} °C to ${r.maxC} °C, pressure ${r.pressurePa} Pa.`;
}
