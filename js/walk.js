// Play the walk: the finished report, replayed over time. Every number comes from the
// report's own samples and totals, so this adds none of its own. It reads the report
// and never writes to the route, the verdict or the share link.
import { formatDuration, turnBackPoint, verdictForDisplay } from './report.js';
import { haversineM } from './route.js';

// A playback rate, not data. At 1x a 4 hour walk takes about a minute to watch.
export const MINUTES_PER_SECOND = 4;
const LONGEST_STEP_S = 0.25; // After a stalled frame, carry on instead of jumping ahead.
const TURN_PAUSE_S = 2; // Time to read the turn-back message, at any speed.
const CAPTION_MS = 3000; // How long a passing-stop caption stays up.

/**
 * Where the walk out first comes within the stop search distance of each nearby stop,
 * in the order the walker meets them. The stops are the report's own near-route list,
 * so this adds none: it only finds the first sample inside the same distance.
 */
export function stopPasses(samples, near, radiusM, lastIndex = samples.length - 1) {
  const passes = [];
  for (const stop of near) {
    for (let i = 0; i <= lastIndex; i++) {
      if (haversineM(samples[i], stop) <= radiusM) {
        passes.push({ id: stop.id, name: stop.name, why: stop.why, d: samples[i].d, h: samples[i].outH, alongM: stop.alongM, offM: stop.distanceM });
        break;
      }
    }
  }
  // Stops already in range at the same point go in the order the route passes them.
  return passes.sort((a, b) => a.d - b.d || a.alongM - b.alongM || a.offM - b.offM);
}

/** The caption for one or more stops reached at the same moment. */
export const passCaption = (passes) => passes.map((p) => `Passing ${p.name}: ${p.why}`).join(' ');

/** The replay for a report, or null unless the 40 m report grid produced it. */
export function buildWalk(report) {
  if (report?.status !== 'final' || report.m.samples.length < 2) return null;
  const { m, verdict, settings, sections } = report;
  // The same rule as the report's steepest slope, kept for every point along the way.
  const steepest = [{ deg: 0, atM: 0 }];
  for (let i = 1; i < m.samples.length; i++) {
    const s = m.samples[i];
    const best = steepest[i - 1];
    steepest.push(s.slopeDeg !== null && s.slopeDeg > best.deg ? { deg: s.slopeDeg, atM: s.d } : best);
  }
  // The walk the replay can show: all of it, or out to the turn-back point and home.
  const turnBack = turnBackPoint(m, settings);
  const cut = { fits: m.samples.length - 1, none: 0, turn: turnBack.index }[turnBack.kind];
  const far = m.samples[cut];
  const scienceH = turnBack.kind === 'none' ? 0 : settings.scienceMinutes / 60;
  return {
    m,
    settings,
    sections,
    steepest,
    word: verdictForDisplay(verdict, 'final', 0).word,
    turnBack,
    cut,
    farM: far.d,
    outH: far.outH,
    backH: far.backH,
    scienceH,
    totalH: turnBack.kind === 'fits' ? m.evaUsedH : turnBack.kind === 'none' ? 0 : far.outH + far.backH + scienceH,
    passes: turnBack.kind === 'none' ? [] : stopPasses(m.samples, report.near ?? [], settings.stopRadiusKm * 1000, cut),
  };
}

/** Speed over one step of the route: its length over the report's time for it. */
function speedOn(samples, i, key) {
  const a = samples[i - 1];
  const b = samples[i];
  const hours = b[key] - a[key];
  return hours > 0 ? (b.d - a.d) / 1000 / hours : 0;
}

/** Where a running time puts the walker: the leg it is on, and how far along it. */
function placeOn(samples, key, value) {
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid][key] < value) lo = mid; else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  const span = b[key] - a[key];
  const f = span > 0 ? Math.min(1, Math.max(0, (value - a[key]) / span)) : 1;
  return { i: hi, f, lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, d: a.d + (b.d - a.d) * f };
}

/** The whole state of the replay at a time outside, in hours. */
export function frameAt(walk, hours) {
  const { m, scienceH, totalH, sections, cut, farM, outH, backH } = walk;
  const { samples } = m;
  const h = Math.max(0, Math.min(hours, totalH));

  let phase;
  let at;
  if (h >= totalH) {
    phase = 'done';
    at = { i: 1, f: 0, lat: samples[0].lat, lon: samples[0].lon, d: 0 };
  } else if (h < outH) {
    phase = 'out';
    at = placeOn(samples, 'outH', h);
  } else if (h <= outH + scienceH) {
    phase = 'science';
    at = { i: cut, f: 1, lat: samples[cut].lat, lon: samples[cut].lon, d: farM };
  } else {
    phase = 'back';
    at = placeOn(samples, 'backH', backH - (h - outH - scienceH));
  }

  const index = at.f < 0.5 ? at.i - 1 : at.i;
  return {
    phase,
    timeH: phase === 'done' ? totalH : h,
    lat: at.lat,
    lon: at.lon,
    d: at.d,
    coveredM: phase === 'out' ? at.d : phase === 'back' ? farM - at.d : farM,
    index,
    elevationM: samples[index].z,
    slopeDeg: samples[at.i].slopeDeg,
    speedKmh: phase === 'out' ? speedOn(samples, at.i, 'outH') : phase === 'back' ? speedOn(samples, at.i, 'backH') : 0,
    steepest: walk.steepest[phase === 'out' ? at.i : cut],
    section: phase === 'done' ? -1 : sections.findIndex((s) => at.d >= s.fromM && at.d <= s.toM),
  };
}

const km = (m) => (m / 1000).toFixed(2);

/** The frame as the player prints it, in the report's own formats. */
export function frameText(walk, frame) {
  const { m, settings, scienceH, sections, farM, turnBack } = walk;
  const slopeText = (best) => (best.deg > 0 ? `${best.deg.toFixed(1)}° at ${km(best.atM)} km` : m.leavesCoverage ? 'no data' : '0.0°');
  const steepest = slopeText(frame.steepest);
  const time = formatDuration(frame.timeH);
  const leg = frame.phase === 'back' ? 'back' : 'out';
  const cutShort = turnBack.kind !== 'fits';
  let distance = `${km(frame.coveredM)} of ${km(farM)} km ${leg}`;
  if (frame.phase === 'done') distance = `${km(farM)} km each way${cutShort ? ', turned back' : ''}`;
  if (frame.phase === 'done' && turnBack.kind === 'none') distance = 'Stayed at base';

  // The report's own totals for the whole route, so a shortened walk ends on them too.
  const report = `${walk.word}: steepest slope ${slopeText(walk.steepest.at(-1))}.`;
  const whole = `The full route is ${km(m.distanceM)} km each way and would take ${formatDuration(m.evaUsedH)}. ${report}`;

  let status = { out: 'Walking out.', back: 'Walking back.' }[frame.phase] ?? '';
  if (frame.phase === 'science') {
    status = cutShort
      ? `Turn back here: staying longer would use more than the assumed time.${scienceH > 0 ? ` Science time, ${formatDuration(scienceH)} (ASSUMPTION).` : ''}`
      : `Science time, ${formatDuration(scienceH)}. ASSUMPTION: the replay puts it at the far end.`;
  }
  if (frame.phase === 'done') {
    status = `Back at base after ${time}. ${report}`;
    if (turnBack.kind === 'turn') status = `Back at base after ${time}, turned back at ${km(farM)} km. ${whole}`;
    if (turnBack.kind === 'none') status = `This walk cannot start: even the first ${km(turnBack.firstM)} km does not fit the assumed time. ${whole}`;
  }
  const section = sections[frame.section];
  if (section) {
    const limit = section.severity === 'nogo' ? `our assumed limit of ${settings.maxSlopeDeg}°` : `our assumed caution limit of ${settings.cautionSlopeDeg}°`;
    status += ` Steep section, over ${limit}.`;
  }

  return {
    distance,
    elevation: frame.elevationM === null ? 'no data' : `${Math.round(frame.elevationM)} m`,
    slope: frame.slopeDeg === null ? 'no data' : `${frame.slopeDeg.toFixed(1)}°`,
    speed: frame.speedKmh > 0 ? `${frame.speedKmh.toFixed(1)} km/h` : 'Stopped',
    time,
    steepest,
    status,
  };
}

/** Wires the player to the page. onStart, onFrame and onEnd draw on the map and profile. */
export function setupWalk({ onStart, onFrame, onEnd }) {
  const $ = (id) => document.getElementById(id);
  const panel = $('walk');
  const play = $('walk-play');
  const stop = $('walk-stop');
  const slider = $('walk-slider');
  const speeds = [...document.querySelectorAll('[data-walk-speed]')];
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let walk = null;
  let open = false;
  let running = false;
  let stepped = false;
  let hours = 0;
  let speed = 1;
  let frameId = 0;
  let lastTime = 0;
  let waiting = 0;
  const shown = new Set();
  const queue = [];
  let captionTimer = 0;

  // Each stop gets one caption, on the way out, as the walker first comes within range.
  function nextCaption() {
    if (captionTimer || queue.length === 0) return;
    $('walk-caption').textContent = passCaption(queue.shift());
    $('walk-caption').hidden = false;
    // At 16x the walk is over in seconds, so each caption is shorter there.
    captionTimer = setTimeout(() => {
      captionTimer = 0;
      $('walk-caption').hidden = true;
      nextCaption();
    }, speed >= 16 ? CAPTION_MS / 2 : CAPTION_MS);
  }

  function clearCaptions() {
    shown.clear();
    queue.length = 0;
    clearTimeout(captionTimer);
    captionTimer = 0;
    $('walk-caption').hidden = true;
  }

  function captionsFor(frame) {
    if (stepped) {
      // Reduced motion: a stop's caption shows on the slider step that reaches it.
      const here = walk.passes.filter((p) => p.h <= hours && hours < p.h + 1 / 60 && frame.phase === 'out');
      $('walk-caption').textContent = passCaption(here);
      $('walk-caption').hidden = here.length === 0;
      return;
    }
    if (frame.phase !== 'out' && frame.phase !== 'science') return;
    const due = walk.passes.filter((p) => p.h <= hours && !shown.has(p.id));
    if (due.length === 0) return;
    // One stop per caption, in the order the walk reaches them.
    for (const p of due) {
      shown.add(p.id);
      queue.push([p]);
    }
    nextCaption();
  }

  function draw() {
    const frame = frameAt(walk, hours);
    const text = frameText(walk, frame);
    for (const key of ['distance', 'elevation', 'slope', 'speed', 'time', 'steepest']) $(`walk-${key}`).textContent = text[key];
    // Announced to screen readers, so it only changes when the words do.
    if ($('walk-status').textContent !== text.status) $('walk-status').textContent = text.status;
    slider.setAttribute('aria-valuetext', `${text.time} outside, ${text.distance}`);
    play.textContent = running ? 'Pause' : hours >= walk.totalH ? 'Play again' : 'Play';
    captionsFor(frame);
    onFrame(frame);
  }

  function tick(now) {
    const seconds = Math.min((now - lastTime) / 1000, LONGEST_STEP_S);
    lastTime = now;
    if (waiting > 0) {
      waiting -= seconds;
    } else {
      const before = hours;
      hours += seconds * speed * (MINUTES_PER_SECOND / 60);
      if (walk.turnBack.kind === 'turn' && before < walk.outH && hours >= walk.outH) {
        hours = walk.outH;
        waiting = TURN_PAUSE_S;
      }
      if (hours >= walk.totalH) {
        hours = walk.totalH;
        running = false;
      }
    }
    draw();
    if (running) frameId = requestAnimationFrame(tick);
  }

  function run() {
    if (hours >= walk.totalH) {
      hours = 0;
      clearCaptions();
    }
    waiting = 0;
    running = true;
    lastTime = performance.now();
    frameId = requestAnimationFrame(tick);
    draw();
  }

  function pause() {
    running = false;
    cancelAnimationFrame(frameId);
    draw();
  }

  function start() {
    open = true;
    stepped = reducedMotion();
    hours = 0;
    document.body.classList.add('is-walking');
    $('walk-live').hidden = false;
    stop.hidden = false;
    $('walk-speeds').hidden = stepped;
    play.hidden = stepped;
    $('walk-step').hidden = !stepped;
    slider.max = Math.ceil(walk.totalH * 60);
    slider.value = 0;
    clearCaptions();
    // With reduced motion the stops become steps of their own, beside the slider.
    $('walk-passes').replaceChildren(...(stepped ? walk.passes : []).map((p) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'linklike';
      button.textContent = `Passing ${p.name}`;
      button.addEventListener('click', () => {
        hours = p.h;
        slider.value = Math.round(p.h * 60);
        draw();
      });
      li.append(button);
      return li;
    }));
    $('walk-passes').hidden = !stepped || walk.passes.length === 0;
    onStart();
    if (stepped) {
      draw();
      slider.focus({ preventScroll: true });
    } else {
      run();
    }
  }

  function end() {
    if (!open) return;
    open = false;
    running = false;
    cancelAnimationFrame(frameId);
    document.body.classList.remove('is-walking');
    $('walk-live').hidden = true;
    $('walk-speeds').hidden = true;
    $('walk-step').hidden = true;
    $('walk-status').textContent = '';
    clearCaptions();
    $('walk-passes').hidden = true;
    stop.hidden = true;
    play.hidden = false;
    play.textContent = 'Play the walk';
    onEnd();
  }

  function endByHand() {
    end();
    play.focus();
  }

  play.addEventListener('click', () => {
    if (!open) start();
    else if (running) pause();
    else run();
  });
  stop.addEventListener('click', endByHand);
  slider.addEventListener('input', () => {
    hours = Math.min(Number(slider.value) / 60, walk.totalH);
    // Each step is a minute, so land on the turn-back point rather than pass it.
    if (walk.turnBack.kind === 'turn' && Math.abs(hours - walk.outH) < 1 / 60) hours = walk.outH;
    draw();
  });
  for (const button of speeds) {
    button.addEventListener('click', () => {
      speed = Number(button.dataset.walkSpeed);
      for (const b of speeds) b.setAttribute('aria-pressed', String(b === button));
    });
  }

  // Caught on the way down, so Escape here stops the walk and nothing else. An open
  // About box or tour keeps its own Escape.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !open || $('about').open || !$('tour').hidden) return;
    e.stopPropagation();
    endByHand();
  }, true);

  return {
    /** A new report ends any replay, because the one playing no longer describes the route. */
    update(report) {
      end();
      walk = buildWalk(report);
      panel.hidden = !walk;
    },
    isOpen: () => open,
  };
}
