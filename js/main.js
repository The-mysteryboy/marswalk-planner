// Map setup, layers and UI wiring. Science and maths live in the other modules.
import { ASSETS } from './assets.js';
import { BASE_LAYERS, COMPUTED_OVERLAYS, TILE_OVERLAYS, UNDERLAY, VECTOR_OVERLAYS } from './layers.js';
import { MARS_RADIUS_M, pathLengthM } from './route.js';
import { GridProgress, loadGrids } from './terrain.js';
import {
  DEFAULT_SETTINGS, REFINING_WORD, WALKING_MODEL, decideVerdict, formatDuration, legTable, measureRoute,
  alongRoute, routeSentence, steepSections, stopsNearRoute, turnBackPoint, turnBackText, verdictForDisplay, waypointDistances,
} from './report.js';
import { CONDITIONS, CONDITIONS_NOTE, FEED_LABEL, LATEST_FEED, latestLine, latestReading } from './conditions.js';
import { ProfileChart } from './chart.js';
import { decodeState, encodeState } from './hash.js';
import { TilePrefetcher, linkIsSlow, tileUrls } from './prefetch.js';
import { explainHtml, explainItem } from './explain.js';
import { inspectHtml, inspectPoint, nearest } from './inspect.js';
import { SLOPE_COLORS, slopeAt, slopeBounds, slopeClass } from './slope.js';
import { SCENARIOS, scenarioHtml, scenarioRoute, scenarioView } from './scenarios.js';
import { noRouteText } from './pathfind.js';
import { NOT_NASA, PRESETS, compareHtml, compareVerdicts, presetNote, presetOf, presetSettings } from './presets.js';
import { setupTour } from './tour.js';
import { setupWalk } from './walk.js';

const L = window.L;

// First thing the script does: the terrain downloads run alongside map setup.
const grids = loadGrids((name) => new URL(ASSETS[name], document.baseURI).href);

const MIN_ZOOM = 8;
const MAX_ZOOM = 17;
const START = { center: [18.45, 77.42], zoom: 11 };
// The demo walks past three real sites and stops at the foot of the delta scarp,
// so it shows a Caution. Drag the last waypoint up the scarp to see a No-Go.
const DEMO = { habitat: 'oeb', stops: ['brac', 'threeforks', 'wildcat'], end: { lat: 18.4669, lon: 77.4298 } };
const NO_DATA_TILE = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
// Checked for separation under normal and colour-blind vision with the dataviz validator.
const COLORS = { route: '#ff8a3d', caution: '#ffec80', nogo: '#f0386b' };

// L.CRS.EPSG4326 matches the Trek tile grid. Its distance() assumes Earth, so
// the radius is swapped here or the scale bar would read 1.9 times too long.
const MARS_CRS = L.Util.extend({}, L.CRS.EPSG4326, { R: MARS_RADIUS_M });

const $ = (id) => document.getElementById(id);

const state = {
  habitat: null,
  waypoints: [],
  baseId: BASE_LAYERS[0].id,
  overlays: new Set([...TILE_OVERLAYS, ...VECTOR_OVERLAYS].filter((l) => l.defaultOn).map((l) => l.id)),
  opacity: Object.fromEntries([...TILE_OVERLAYS, ...COMPUTED_OVERLAYS].map((l) => [l.id, l.opacity])),
  settings: { ...DEFAULT_SETTINGS },
};

const progress = new GridProgress();
let stops = [];
const stopMarkers = new Map();

// doubleClickZoom is off because a double click would add two waypoints.
const map = L.map('map', {
  crs: MARS_CRS,
  center: START.center,
  zoom: START.zoom,
  minZoom: MIN_ZOOM,
  maxZoom: MAX_ZOOM,
  maxBounds: BASE_LAYERS[0].bounds,
  maxBoundsViscosity: 0.8,
  doubleClickZoom: false,
  fadeAnimation: false,
  attributionControl: true,
});
map.attributionControl.setPrefix(false);
L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);
new ResizeObserver(() => {
  map.invalidateSize();
  setTouchPanning();
  sizePopups();
}).observe($('map'));

// Popups stay right of the zoom buttons, below the mode switch and Layers, and above the
// credits. On a narrow or touch screen the stylesheet also caps them at about 45% of the
// map, and uses these two sizes to do it.
L.Popup.mergeOptions({ autoPanPaddingTopLeft: [54, 62], autoPanPaddingBottomRight: [10, 34] });
const compactPopups = () => window.matchMedia('(max-width: 860px), (pointer: coarse)').matches;
function sizePopups() {
  const { x, y } = map.getSize();
  const box = map.getContainer().style;
  box.setProperty('--map-width', `${x}px`);
  box.setProperty('--popup-text-height', `${Math.max(60, Math.round(y * 0.45) - 20)}px`);
}
sizePopups();

// Only one thing covers the map at a time. A popup or the Layers panel hides the messages,
// the key and the readout until it closes.
function markMapCovered() {
  const covered = Boolean(document.querySelector('.leaflet-popup')) || !$('map-layers-panel').hidden;
  document.querySelector('.mapwrap').classList.toggle('map-covered', covered);
}
map.on('popupopen', () => {
  setMapLayersOpen(false);
  if (tour.isOpen()) tour.close({ focus: false }); // A tap on the map means the tour is over.
  markMapCovered();
});
map.on('popupclose', () => {
  markMapCovered();
  if (inspecting) showInspectStep(1);
});

// On a touch screen, a map that fills most of the screen would catch every swipe, and the
// page could not be scrolled. There, one finger scrolls the page and two move the map:
// with dragging off, Leaflet leaves one-finger swipes to the browser, and its pinch
// handler still moves the map with two. Taps, marker drags and pinch zoom are unchanged.
// A mouse, or a map with room around it, keeps one-finger dragging.
const TALL_MAP = 0.6; // Share of the screen's height.
const HINT_GAP_MS = 20000;
const HINT_MAX = 3;
const touchHint = { shown: 0, last: -Infinity, timer: 0, start: null };

function setTouchPanning() {
  const twoFingers = window.matchMedia('(pointer: coarse)').matches && map.getSize().y > window.innerHeight * TALL_MAP;
  if (twoFingers && map.dragging.enabled()) map.dragging.disable();
  if (!twoFingers && !map.dragging.enabled()) map.dragging.enable();
}
window.addEventListener('resize', setTouchPanning);

map.getContainer().addEventListener('touchstart', (e) => {
  touchHint.start = e.touches.length === 1 && !map.dragging.enabled() ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
}, { passive: true });
map.getContainer().addEventListener('touchmove', (e) => {
  const from = touchHint.start;
  if (!from || e.touches.length !== 1) return;
  if (Math.hypot(e.touches[0].clientX - from.x, e.touches[0].clientY - from.y) < 12) return;
  touchHint.start = null;
  const now = performance.now();
  // Once, then rarely, so it never nags someone who is just scrolling.
  if (touchHint.shown >= HINT_MAX || now - touchHint.last < HINT_GAP_MS) return;
  touchHint.shown += 1;
  touchHint.last = now;
  $('touch-hint').hidden = false;
  clearTimeout(touchHint.timer);
  touchHint.timer = setTimeout(() => { $('touch-hint').hidden = true; }, 1800);
}, { passive: true });

// --- Layers -----------------------------------------------------------------
const tileLayers = new Map();
const vectorLayers = new Map();
const tileStatus = new Map();

// A small local copy of the CTX mosaic sits under the live tiles. It shows the
// moment the page opens, and keeps the map usable if the NASA tile server is down.
map.createPane('underlay').style.zIndex = 150;
for (const image of [UNDERLAY.placeholder, UNDERLAY.image]) {
  L.imageOverlay(image, UNDERLAY.bounds, { pane: 'underlay', interactive: false, alt: '' }).addTo(map);
}
const baseFailure = { missing: 0, loaded: 0 };

function noteBaseTile(ok) {
  if (ok) baseFailure.loaded += 1; else baseFailure.missing += 1;
  const down = baseFailure.missing >= 4 && baseFailure.loaded === 0;
  $('map-notice').hidden = !down;
}

// Tiles can take a second or two to arrive, so show at once that the click worked.
const busyLayers = new Set();

function setBusy(id, on) {
  if (on) busyLayers.add(id); else busyLayers.delete(id);
  if (on) prefetcher.clear(); // A real request always goes ahead of background work.
  $('map-busy').dataset.layerBusy = String(busyLayers.size > 0);
  refreshLayerStatus();
}

function makeTileLayer(cfg, zIndex) {
  const layer = L.tileLayer(cfg.url, {
    attribution: cfg.attribution,
    bounds: cfg.bounds,
    maxNativeZoom: cfg.maxNativeZoom,
    maxZoom: MAX_ZOOM,
    opacity: state.opacity[cfg.id] ?? 1,
    errorTileUrl: NO_DATA_TILE,
    noWrap: true,
    updateWhenZooming: false,
    zIndex,
  });
  tileStatus.set(cfg.id, { missing: 0 });
  layer.on('loading', () => {
    tileStatus.get(cfg.id).missing = 0;
    setBusy(cfg.id, true);
  });
  layer.on('remove', () => setBusy(cfg.id, false));
  const isBase = BASE_LAYERS.includes(cfg);
  layer.on('tileerror', () => {
    tileStatus.get(cfg.id).missing += 1;
    refreshLayerStatus();
    if (isBase) noteBaseTile(false);
  });
  // A failed tile swaps to NO_DATA_TILE and then "loads", which is not a real load.
  layer.on('tileload', (e) => { if (isBase && e.tile.src !== NO_DATA_TILE) noteBaseTile(true); });
  layer.on('load', () => {
    setBusy(cfg.id, false);
    schedulePrefetch();
  });
  tileLayers.set(cfg.id, layer);
  return layer;
}

// While the map is idle, fetch what is likely to be needed next: the ring just outside
// the view, the next zoom level out, and the low-resolution layers, which are only a
// few tiles each. Not on data-saver or a slow link, and never ahead of the report grid.
const prefetcher = new TilePrefetcher();
const SMALL_LAYER_ZOOM = 9;

function gridDownloadWasSlow() {
  const entry = performance.getEntriesByType('resource').find((e) => e.name.includes('terrain_full'));
  return entry ? linkIsSlow(entry.encodedBodySize, entry.duration) : false;
}

function schedulePrefetch() {
  if (!progress.isFinal || busyLayers.size || navigator.connection?.saveData || gridDownloadWasSlow()) return;
  const whenIdle = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 200));
  whenIdle(() => {
    if (busyLayers.size) return; // A layer started loading while this was waiting its turn.
    const b = map.getBounds();
    const view = { west: b.getWest(), east: b.getEast(), south: b.getSouth(), north: b.getNorth() };
    // One zoom level out shows twice the width and height around the same center.
    const halfWidth = (view.east - view.west) / 2;
    const halfHeight = (view.north - view.south) / 2;
    const zoomedOut = {
      west: view.west - halfWidth, east: view.east + halfWidth, south: view.south - halfHeight, north: view.north + halfHeight,
    };
    const zoom = map.getZoom();
    const base = BASE_LAYERS.find((c) => c.id === state.baseId);
    prefetcher.replace([
      ...[...BASE_LAYERS, ...TILE_OVERLAYS].filter((c) => c.maxNativeZoom <= SMALL_LAYER_ZOOM).flatMap((c) => tileUrls(c, view, zoom)),
      ...tileUrls(base, view, zoom, 1),
      ...tileUrls(base, zoomedOut, zoom - 1),
    ]);
    ensureVector('hydrous').catch(() => {}); // Only a small file. A real toggle retries.
  });
}
map.on('movestart', () => prefetcher.clear());
map.on('moveend', schedulePrefetch);

BASE_LAYERS.forEach((cfg) => makeTileLayer(cfg, 1));
TILE_OVERLAYS.forEach((cfg, i) => makeTileLayer(cfg, 2 + i));

function dropOtherBases() {
  for (const cfg of BASE_LAYERS) if (cfg.id !== state.baseId) tileLayers.get(cfg.id).remove();
}

// While a new base map loads, the wait is always on show, ahead of the mode message. If it
// runs long the words say so. It cannot tell a slow server from a slow connection, so they
// only say what is true: the app is still waiting for NASA's server.
const BASE_SLOW_MS = 3000;
const BUSY_WORDS = 'Loading NASA tiles...';
const SLOW_WORDS = "Still waiting for NASA's tile server. Your map stays up until the new one arrives.";
const baseWait = { timer: 0, slow: false };

function showBaseWait(waiting) {
  clearTimeout(baseWait.timer);
  baseWait.slow = false;
  $('map-busy').textContent = BUSY_WORDS;
  $('map-busy').dataset.baseLoading = String(waiting);
  if (!waiting) return;
  baseWait.timer = setTimeout(() => {
    baseWait.slow = true;
    $('map-busy').textContent = SLOW_WORDS;
    refreshLayerStatus();
  }, BASE_SLOW_MS);
}

// The old base stays underneath until the new one has drawn, so imagery never drops out.
function showBase(id) {
  renderMapLayers(id);
  const next = tileLayers.get(id);
  state.baseId = id;
  for (const cfg of BASE_LAYERS) tileLayers.get(cfg.id).setZIndex(cfg.id === id ? 1 : 0);
  next.addTo(map);
  if (next.isLoading()) {
    showBaseWait(true);
    next.once('load', () => {
      if (state.baseId !== id) return;
      dropOtherBases();
      showBaseWait(false);
    });
  } else {
    dropOtherBases();
    showBaseWait(false);
  }
  writeHash();
}

function setOverlay(id, on) {
  if (on) state.overlays.add(id); else state.overlays.delete(id);
  const layer = tileLayers.get(id) ?? vectorLayers.get(id);
  if (layer) {
    if (on) layer.addTo(map); else layer.remove();
  } else if (on && id !== 'slope') {
    ensureVector(id).catch((err) => showLoadError(`Could not load that layer: ${err.message}`));
  }
  if (id === 'slope') paintSlopeMap();
  if (id === 'stops') updateReport(); // Markers are rebuilt on show, so re-mark the near ones.
  const fromMap = $('map-layers-panel').contains(document.activeElement);
  renderLayerRows();
  renderInspect();
  // The lists were just rebuilt, so put keyboard focus back where it was.
  document.querySelector(`input[name="${fromMap ? 'map-' : ''}overlay-${id}"]`)?.focus({ preventScroll: true });
  writeHash();
}

// A short list of the same layers on the map itself, so a phone need not scroll away.
// It uses the same switches as the cards in More tools, and the two lists stay in step.
const LAYERS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="m3 13 9 5 9-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
const MapLayers = L.Control.extend({
  options: { position: 'topright' },
  onAdd() {
    const box = L.DomUtil.create('div', 'map-layers');
    box.innerHTML = `<button type="button" class="map-layers-btn" id="btn-map-layers" aria-expanded="false" aria-controls="map-layers-panel" title="Layers">${LAYERS_ICON}<span>Layers</span></button>
      <div class="map-layers-panel" id="map-layers-panel" role="group" aria-label="Map layers" hidden></div>`;
    L.DomEvent.disableClickPropagation(box);
    L.DomEvent.disableScrollPropagation(box);
    L.DomEvent.on(box, 'keydown', L.DomEvent.stopPropagation); // Arrow keys move the radios, not the map.
    return box;
  },
});
new MapLayers().addTo(map);

function renderMapLayers(baseId = state.baseId) {
  const panel = $('map-layers-panel');
  if (!panel || panel.hidden) return;
  const row = (type, name, cfg, checked) => `<label><input type="${type}" name="${name}" value="${cfg.id}"${checked ? ' checked' : ''}><span>${escapeHtml(cfg.label)}</span></label>`;
  panel.innerHTML = `<h3>Base map</h3>${BASE_LAYERS.map((c) => row('radio', 'map-base', c, c.id === baseId)).join('')}
    <h3>Overlays</h3>${[...COMPUTED_OVERLAYS, ...VECTOR_OVERLAYS, ...TILE_OVERLAYS].map((c) => row('checkbox', `map-overlay-${c.id}`, c, state.overlays.has(c.id))).join('')}
    <p>What each layer shows, and its key, are in More tools.</p>`;
}

function setMapLayersOpen(open, { focusButton = false } = {}) {
  const panel = $('map-layers-panel');
  const button = $('btn-map-layers');
  if (open) map.closePopup();
  panel.hidden = !open;
  button.setAttribute('aria-expanded', String(open));
  markMapCovered();
  if (open) {
    renderMapLayers();
    // Stop above the scale bar and the credits at the bottom of the map.
    const top = panel.getBoundingClientRect().top - map.getContainer().getBoundingClientRect().top;
    panel.style.maxHeight = `${Math.max(120, map.getSize().y - top - 44)}px`;
  }
  if (focusButton) button.focus();
}

$('btn-map-layers').addEventListener('click', () => setMapLayersOpen($('map-layers-panel').hidden));
$('map-layers-panel').addEventListener('change', (e) => {
  const input = e.target;
  if (input.name === 'map-base') showBase(input.value);
  else setOverlay(input.value, input.checked);
  renderLayerRows();
  refreshLayerStatus();
  // The panel covers the map, so choosing a base map closes it, to show the map and its status.
  if (input.name === 'map-base') setMapLayersOpen(false, { focusButton: true });
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || $('map-layers-panel').hidden || !$('tour').hidden) return;
  e.stopPropagation();
  setMapLayersOpen(false, { focusButton: true });
}, true);
document.addEventListener('pointerdown', (e) => {
  if (!$('map-layers-panel').hidden && !e.target.closest('.map-layers')) setMapLayersOpen(false);
});

const SWATCHES = {
  rover: '<svg class="swatch" viewBox="0 0 18 18" aria-hidden="true"><path d="M1 13c4-8 8 2 16-8" fill="none" stroke="#fff" stroke-width="2.5" stroke-dasharray="4 3"/></svg>',
  stop: '<svg class="swatch" viewBox="0 0 18 18" aria-hidden="true"><rect x="4.5" y="4.5" width="9" height="9" transform="rotate(45 9 9)" fill="#fff" stroke="#17120e" stroke-width="1.5"/></svg>',
  hydrous: '<svg class="swatch" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="6" fill="#7fb8ff" stroke="#0b1a2c" stroke-width="2"/></svg>',
  slope: `<svg class="swatch" viewBox="0 0 18 18" aria-hidden="true"><rect x="1" y="2" width="5" height="14" fill="${SLOPE_COLORS.go}"/><rect x="6.5" y="2" width="5" height="14" fill="${SLOPE_COLORS.caution}"/><rect x="12" y="2" width="5" height="14" fill="${SLOPE_COLORS.nogo}"/></svg>`,
};

function renderLegend() {
  const line = (color, dash = '') => `<svg class="swatch" viewBox="0 0 20 14" aria-hidden="true"><line x1="1" y1="7" x2="19" y2="7" stroke="${color}" stroke-width="3" ${dash}/></svg>`;
  const items = [
    ['<svg class="swatch" viewBox="0 0 20 14" aria-hidden="true"><rect x="4" y="1" width="12" height="12" rx="2" fill="#fff"/></svg>', 'Base (habitat)'],
    [`<svg class="swatch" viewBox="0 0 20 14" aria-hidden="true"><circle cx="10" cy="7" r="5.5" fill="${COLORS.route}" stroke="#fff" stroke-width="1.5"/></svg>`, 'Route point'],
    [line(COLORS.route), 'Route'],
    [line('#fff', 'stroke-dasharray="3 3"'), 'Rover track'],
    [line(COLORS.caution), `Over ${state.settings.cautionSlopeDeg}°`],
    [line(COLORS.nogo), `Over ${state.settings.maxSlopeDeg}°`],
    [line('#d7e6ff', 'stroke-dasharray="1 4"'), 'Farthest from base'],
    [`<svg class="swatch" viewBox="0 0 20 14" aria-hidden="true"><rect x="5.5" y="2.5" width="9" height="9" fill="${COLORS.route}" stroke="#fff" transform="rotate(45 10 7)"/></svg>`, 'Stop near route'],
  ];
  const { cautionSlopeDeg: caution, maxSlopeDeg: nogo } = state.settings;
  const square = (color) => `<svg class="swatch" viewBox="0 0 20 14" aria-hidden="true"><rect x="3" y="0.5" width="14" height="13" fill="${color}"/></svg>`;
  const slopeItems = [
    [square(SLOPE_COLORS.go), `Slope map: up to ${caution}°`],
    [square(SLOPE_COLORS.caution), `Slope map: ${caution}° to ${nogo}°`],
    [square(SLOPE_COLORS.nogo), `Slope map: over ${nogo}°`],
  ];
  $('legend').innerHTML = [...items, ...slopeItems].map(([icon, text]) => `<li>${icon}${text}</li>`).join('');
}

function layerRow(cfg, inputType) {
  const row = document.createElement('div');
  row.className = 'layer';
  row.dataset.layer = cfg.id;

  const label = document.createElement('label');
  label.className = 'layer-main';
  const input = document.createElement('input');
  input.type = inputType;
  input.name = inputType === 'radio' ? 'base' : `overlay-${cfg.id}`;
  input.checked = inputType === 'radio' ? cfg.id === state.baseId : state.overlays.has(cfg.id);
  input.addEventListener('change', () => {
    if (inputType === 'radio') showBase(cfg.id); else setOverlay(cfg.id, input.checked);
    refreshLayerStatus();
  });
  label.append(input);
  if (cfg.swatch) label.insertAdjacentHTML('beforeend', SWATCHES[cfg.swatch]);

  const text = document.createElement('span');
  text.className = 'layer-label';
  text.textContent = cfg.label;
  const note = document.createElement('span');
  note.className = 'layer-note';
  note.textContent = cfg.note;
  const status = document.createElement('span');
  status.className = 'layer-status';
  status.dataset.status = cfg.id;
  text.append(note, status);
  label.append(text);
  row.append(label, layerCardToggle(cfg));

  if (cfg.kind !== 'vector' && inputType === 'checkbox' && input.checked) {
    const wrap = document.createElement('label');
    wrap.className = 'opacity';
    const percent = Math.round((state.opacity[cfg.id] ?? 1) * 100);
    wrap.innerHTML = `<span>Opacity</span><input type="range" min="10" max="100" step="5" value="${percent}" aria-label="Opacity of ${cfg.label}"><output>${percent}%</output>`;
    wrap.querySelector('input').addEventListener('input', (e) => {
      const v = Number(e.target.value) / 100;
      state.opacity[cfg.id] = v;
      (tileLayers.get(cfg.id) ?? vectorLayers.get(cfg.id))?.setOpacity(v);
      wrap.querySelector('output').textContent = `${e.target.value}%`;
    });
    row.append(wrap);
  }
  return row;
}

// Which "What am I looking at?" cards are open. The rows are rebuilt on every toggle.
const openCards = new Set();

function layerCardBody(cfg) {
  const swatch = cfg.swatch ? SWATCHES[cfg.swatch] : '';
  const rows = [['Mission', cfg.mission], ['Instrument', cfg.instrument], ['Resolution', cfg.resolution], ['What it shows', cfg.shows]];
  if (cfg.why) rows.push(['Why it matters', cfg.why]);
  const body = document.createElement('dl');
  body.className = 'layer-card';
  body.innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')
    + `<div><dt>Key</dt><dd class="layer-key">${swatch}<span>${escapeHtml(cfg.key)}</span></dd></div>`
    + (cfg.source_url ? `<div><dt>Source</dt><dd><a href="${escapeHtml(cfg.source_url)}" target="_blank" rel="noopener">${escapeHtml(cfg.source_name)}</a></dd></div>` : '');
  return body;
}

function layerCardToggle(cfg) {
  const wrap = document.createElement('div');
  wrap.className = 'layer-more';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'linklike';
  button.textContent = 'What am I looking at?';
  button.setAttribute('aria-expanded', String(openCards.has(cfg.id)));
  wrap.append(button);
  if (openCards.has(cfg.id)) wrap.append(layerCardBody(cfg));
  button.addEventListener('click', () => {
    const open = !openCards.has(cfg.id);
    if (open) openCards.add(cfg.id); else openCards.delete(cfg.id);
    button.setAttribute('aria-expanded', String(open));
    wrap.querySelector('.layer-card')?.remove();
    if (open) wrap.append(layerCardBody(cfg));
  });
  return wrap;
}

function renderLayerRows() {
  $('base-list').replaceChildren(...BASE_LAYERS.map((c) => layerRow(c, 'radio')));
  $('overlay-list').replaceChildren(...[...COMPUTED_OVERLAYS, ...VECTOR_OVERLAYS, ...TILE_OVERLAYS].map((c) => layerRow(c, 'checkbox')));
  renderMapLayers();
  refreshLayerStatus();
}

// Coverage warning for layers that are switched on.
function refreshLayerStatus() {
  const view = map.getBounds();
  const active = [BASE_LAYERS.find((c) => c.id === state.baseId), ...TILE_OVERLAYS.filter((c) => state.overlays.has(c.id))];
  for (const cfg of [...BASE_LAYERS, ...TILE_OVERLAYS]) {
    const el = document.querySelector(`[data-status="${cfg.id}"]`);
    if (!el) continue;
    let text = '';
    if (active.includes(cfg)) {
      if (!L.latLngBounds(cfg.bounds).intersects(view)) text = 'No coverage in this view.';
      else if (busyLayers.has(cfg.id)) text = baseWait.slow && cfg.id === state.baseId ? SLOW_WORDS : 'Loading tiles...';
      else if (tileStatus.get(cfg.id).missing > 0) text = 'Some tiles are missing here: no coverage, or the tile server did not respond.';
    }
    el.textContent = text;
  }
  const slopeStatus = document.querySelector('[data-status="slope"]');
  if (slopeStatus) slopeStatus.textContent = state.overlays.has('slope') ? slopeMapStatus() : '';
}
map.on('moveend zoomend', refreshLayerStatus);

async function loadJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function addWaypoint(p) {
  state.waypoints.push({ lat: p.lat, lon: p.lon });
  renderWaypoints();
}

function stopPopup(stop) {
  const el = document.createElement('div');
  el.innerHTML = `<div class="popup-title">${escapeHtml(stop.name)}</div>
    <p>${escapeHtml(stop.why)}</p>
    <p>${escapeHtml(stop.mission)}, ${escapeHtml(stop.instrument)}. ${escapeHtml(stop.coord_note)}</p>
    <p><a href="${escapeHtml(stop.source_url)}" target="_blank" rel="noopener">Source: ${escapeHtml(stop.source_name)}</a></p>`;
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'linklike';
  add.textContent = 'Add to route';
  add.addEventListener('click', () => {
    addWaypoint(stop);
    map.closePopup();
  });
  el.append(add);
  return el;
}

function buildRover(rover) {
  // The rover's track runs under everything else and must never catch clicks.
  return L.geoJSON(rover, {
    interactive: false,
    style: { color: '#ffffff', weight: 2, opacity: 0.85, dashArray: '5 5' },
  });
}

// Names show once the map is zoomed in enough to keep them apart. Stops that sit close
// together in pairs put their names on opposite sides.
const STOP_LABEL_ZOOM = 13;
const LABEL_SIDES = { oeb: 'top', wbf: 'bottom', rochette: 'bottom', brac: 'top', skinner: 'top', wildcat: 'bottom', threeforks: 'left', cometgeyser: 'top', cheyava: 'top' };
const showStopLabels = () => map.getContainer().classList.toggle('stop-labels-on', map.getZoom() >= STOP_LABEL_ZOOM);
map.on('zoomend', showStopLabels);

function buildStops(stopFile) {
  stops = stopFile.stops;
  const labels = stops.map((stop) => L.marker([stop.lat, stop.lon], {
    interactive: false,
    keyboard: false,
    zIndexOffset: -200,
    icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<span class="stop-label stop-label-${LABEL_SIDES[stop.id] ?? 'top'}">${escapeHtml(stop.name)}</span>` }),
  }));
  showStopLabels();
  const markers = stops.map((stop) => {
    const marker = L.marker([stop.lat, stop.lon], {
      title: stop.name,
      alt: `Science stop: ${stop.name}`,
      icon: L.divIcon({ className: '', html: '<div class="pin-stop"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }),
      zIndexOffset: -100,
    }).bindPopup(() => stopPopup(stop));
    stopMarkers.set(stop.id, marker);
    return marker;
  });
  return L.layerGroup([...labels, ...markers]);
}

function buildHydrous(hydrous) {
  return L.geoJSON(hydrous, {
    pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
      radius: 7, color: '#0b1a2c', weight: 2, fillColor: '#7fb8ff', fillOpacity: 0.95,
    }).bindPopup(`<div class="popup-title">Hydrous mineral detection</div>
      <p>Instrument: ${escapeHtml(feature.properties.instrument)}. A point from a coarse global catalog, not a mapped outcrop.</p>
      <a href="${hydrous.source.url}" target="_blank" rel="noopener">Source: ${escapeHtml(hydrous.source.name)}</a>`),
  });
}

const VECTOR_BUILDERS = { rover: buildRover, stops: buildStops, hydrous: buildHydrous };
const vectorLoads = new Map();
const vectorData = new Map();

/** Fetch and build a vector layer once, the first time it is needed. */
function ensureVector(id) {
  if (!vectorLoads.has(id)) {
    const { file } = VECTOR_OVERLAYS.find((c) => c.id === id);
    const load = loadJson(file).then((data) => {
      vectorData.set(id, data);
      const layer = VECTOR_BUILDERS[id](data);
      vectorLayers.set(id, layer);
      if (state.overlays.has(id)) layer.addTo(map);
    }).catch((err) => {
      vectorLoads.delete(id); // Let a later toggle try again.
      throw err;
    });
    vectorLoads.set(id, load);
  }
  return vectorLoads.get(id);
}

// --- Slope map ---------------------------------------------------------------
// Drawn in a worker, only once someone turns it on, and only from the report grid.
// Colours follow the limits under Assumptions, so a recolour goes back to the worker.
map.createPane('slope').style.zIndex = 300;
map.getPane('slope').style.pointerEvents = 'none';

let slopeWorker = null;
let slopeRequest = 0;
let slopeDrawnFor = null;
let slopeError = '';
let slopeTimer = 0;
const NO_WORKER = 'This browser cannot draw the slope map. Reports and Check a point still work.';

function slopeMapStatus() {
  if (slopeError) return slopeError;
  if (progress.status === 'failed') return 'The 40 m report grid did not load, so there is no slope map.';
  if (!progress.isFinal) return 'Refining... The slope map waits for the 40 m grid.';
  return busyLayers.has('slope') ? 'Drawing from the 40 m grid...' : '';
}

function failSlopeMap(message) {
  slopeError = message;
  slopeDrawnFor = null;
  setBusy('slope', false);
}

// One worker holds the slope grid for both the map and the route search.
function slopeWorkerReady() {
  if (slopeWorker) return slopeWorker;
  const { meta, samples } = progress.terrain;
  try {
    slopeWorker = new Worker(new URL('./slope_worker.js', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
  slopeWorker.onmessage = ({ data }) => {
    if (data.reachId !== undefined) showStopChecked(data);
    else if (data.routeId !== undefined) showFoundRoute(data);
    else showSlopeImage(data);
  };
  slopeWorker.onerror = () => {
    slopeWorker = null;
    failSlopeMap(NO_WORKER);
    showSafestNote('This browser cannot run the route search.');
    showReachStatus('This browser cannot run the route search.');
  };
  slopeWorker.postMessage({ grid: { meta, samples } });
  return slopeWorker;
}

function showSlopeImage({ id, blob, error }) {
  if (id !== slopeRequest) return; // Limits changed again while this one was being drawn.
  if (error) {
    failSlopeMap(`The slope map could not be drawn: ${error}`);
    return;
  }
  const url = URL.createObjectURL(blob);
  let image = vectorLayers.get('slope');
  if (image) {
    const old = image.getElement().src;
    image.once('load', () => URL.revokeObjectURL(old));
    image.setUrl(url);
  } else {
    image = L.imageOverlay(url, slopeBounds(progress.terrain.meta), {
      pane: 'slope', opacity: state.opacity.slope, interactive: false, className: 'slope-image', alt: '',
    });
    vectorLayers.set('slope', image);
    if (state.overlays.has('slope')) image.addTo(map);
  }
  setBusy('slope', false);
}

function paintSlopeMap() {
  const { cautionSlopeDeg, maxSlopeDeg } = state.settings;
  const key = `${cautionSlopeDeg}/${maxSlopeDeg}`;
  if (!state.overlays.has('slope') || !progress.isFinal || key === slopeDrawnFor) {
    refreshLayerStatus();
    return;
  }
  slopeDrawnFor = key;
  slopeError = '';
  const worker = slopeWorkerReady();
  if (!worker) {
    failSlopeMap(NO_WORKER);
    return;
  }
  setBusy('slope', true);
  worker.postMessage({ id: ++slopeRequest, limits: { cautionSlopeDeg, maxSlopeDeg } });
}

// --- Safest route -------------------------------------------------------------
// Runs in the worker. The result becomes a normal editable route, and the standard
// report then judges it like any other. Nothing here sets a verdict.
let routeRequest = 0;
let routeGoal = null;
let routeBefore = null;

function showSafestNote(text, canRestore = false) {
  $('safest-note').hidden = !text;
  $('safest-text').textContent = text;
  $('btn-restore').hidden = !canRestore;
}

function findSafestRoute() {
  const goal = state.waypoints.at(-1);
  if (!goal || !progress.isFinal) return;
  const worker = slopeWorkerReady();
  if (!worker) {
    showSafestNote('This browser cannot run the route search.');
    return;
  }
  routeGoal = goal;
  showSafestNote('Searching the 40 m grid...');
  const { cautionSlopeDeg, maxSlopeDeg } = state.settings;
  worker.postMessage({ routeId: ++routeRequest, route: { start: state.habitat, goal }, limits: { cautionSlopeDeg, maxSlopeDeg } });
}

function showFoundRoute({ routeId, route, error }) {
  if (routeId !== routeRequest || state.waypoints.at(-1) !== routeGoal) return; // The route has moved on.
  if (error) {
    showSafestNote(`The route search failed: ${error}`);
    return;
  }
  if (route.none) {
    showSafestNote(`${noRouteText(route.none, state.settings)} Your route was not changed.`);
    return;
  }
  // The search should make this impossible. It is checked anyway, with the report itself.
  const m = measureRoute(route.points, state.habitat, progress.terrain, state.settings);
  if (m.maxSlopeDeg > state.settings.maxSlopeDeg) {
    showSafestNote('No route could be confirmed by the report. Your route was not changed.');
    return;
  }
  routeBefore = state.waypoints;
  state.waypoints = route.points.slice(1);
  renderWaypoints();
  fitRoute();
  showSafestNote(`Found a route of ${fmtKm(m.distanceM)} that stays off ground over the ${state.settings.maxSlopeDeg}° limit (assumption). It favours gentle ground. The report above checks it like any other route.`, true);
}

$('btn-safest').addEventListener('click', findSafestRoute);
$('btn-restore').addEventListener('click', () => {
  state.waypoints = routeBefore;
  renderWaypoints();
  showSafestNote('');
});

// --- Reachable science --------------------------------------------------------
// The check runs in the worker, so nothing here holds up the page. Results belong to one
// base and one set of assumptions. When either changes they go at once, not left as stale.
const REACH_WAIT_MS = 300; // Typing "25" passes through "2" on the way.
const reach = { on: false, run: 0, basis: '', results: [], timer: 0, page: null, before: null, loadedKey: '' };

const reachBasis = () => JSON.stringify([state.habitat, state.settings]);

function showReachStatus(text) {
  $('reach-status').textContent = text;
}

function clearReach() {
  reach.results = [];
  $('reach-body').hidden = true;
  for (const marker of stopMarkers.values()) marker.unbindTooltip();
}

// Both science panels load their code on first use, so the first view never pays for it.
async function startReachCheck() {
  if (!progress.isFinal || stops.length === 0) return;
  try {
    reach.page ??= await import('./reach.js');
  } catch (err) {
    showReachStatus(`The stop check could not load: ${err.message}`);
    return;
  }
  const worker = slopeWorkerReady();
  if (!worker) {
    showReachStatus('This browser cannot run the route search.');
    return;
  }
  clearTimeout(reach.timer);
  clearReach();
  reach.on = true;
  $('btn-reach-clear').hidden = false;
  reach.basis = reachBasis();
  showReachStatus(`Checking stop 1 of ${stops.length}...`);
  const list = stops.map(({ id, name, lat, lon }) => ({ id, name, lat, lon }));
  worker.postMessage({ reach: { id: ++reach.run, habitat: state.habitat, stops: list, settings: { ...state.settings } } });
}

function showStopChecked({ reachId, done, result, error }) {
  if (reachId !== reach.run) return; // The assumptions have moved on.
  if (error) {
    showReachStatus(`The stop check failed: ${error}`);
    return;
  }
  reach.results.push(result);
  if (done < stops.length) {
    showReachStatus(`Checking stop ${done + 1} of ${stops.length}...`);
    return;
  }
  showReachStatus('');
  const { TAG_SIDES, reachHtml, stopTag } = reach.page;
  $('reach-body').innerHTML = reachHtml(reach.results, state.settings);
  $('reach-body').hidden = false;
  for (const r of reach.results) {
    const { text, level } = stopTag(r);
    stopMarkers.get(r.id).bindTooltip(text, { permanent: true, direction: TAG_SIDES[r.id], className: `stop-tag stop-tag-${level}` });
  }
}

function checkReachIsCurrent() {
  if (!reach.on || reachBasis() === reach.basis) return;
  reach.basis = reachBasis();
  reach.run += 1; // Anything still arriving from the worker is out of date.
  clearReach();
  showReachStatus('The assumptions changed, so every stop is being checked again...');
  clearTimeout(reach.timer);
  reach.timer = setTimeout(startReachCheck, REACH_WAIT_MS);
}

// Loading a stop's route keeps the route it replaced, so it can be put back.
function loadReachRoute(id) {
  const result = reach.results.find((r) => r.id === id);
  if (!reach.before) reach.before = { waypoints: state.waypoints, center: map.getCenter(), zoom: map.getZoom() };
  scenario = null;
  state.waypoints = result.points.slice(1);
  reach.loadedKey = JSON.stringify(state.waypoints);
  renderWaypoints();
  fitRoute();
  $('reach-route-text').textContent = `Showing the route to ${result.name}.`;
  $('reach-route-note').hidden = false;
  if (window.matchMedia('(max-width: 860px)').matches) document.querySelector('.mapwrap').scrollIntoView({ block: 'start' });
}

function restoreRouteBeforeReach() {
  if (!reach.before) return;
  const { waypoints, center, zoom } = reach.before;
  reach.before = null;
  reach.loadedKey = '';
  $('reach-route-note').hidden = true;
  state.waypoints = waypoints;
  renderWaypoints();
  map.setView(center, zoom, { animate: false });
}

// Clear leaves the map as it was before the check. A route from the table goes back to
// the one it replaced, unless it has been edited since, which makes it the user's own.
function clearReachView() {
  reach.on = false;
  reach.run += 1; // Anything still arriving from the worker is dropped.
  reach.basis = '';
  clearTimeout(reach.timer);
  clearReach();
  showReachStatus('');
  $('btn-reach-clear').hidden = true;
  if (reach.before && JSON.stringify(state.waypoints) === reach.loadedKey) restoreRouteBeforeReach();
  reach.before = null;
  $('reach-route-note').hidden = true;
  $('btn-reach').focus({ preventScroll: true });
}

$('btn-reach-undo').addEventListener('click', () => {
  restoreRouteBeforeReach();
  $('btn-reach').focus({ preventScroll: true });
});
$('btn-reach-clear').addEventListener('click', clearReachView);
$('reach-title').closest('section').addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !reach.on) return;
  e.stopPropagation();
  clearReachView();
});

// --- Could a human walk where Perseverance drove? -------------------------------
const ROVER_WEIGHTS = { go: 3, caution: 5, nogo: 7 }; // Line width tells them apart without colour.
const roverGroup = L.layerGroup();
const rover = { on: false, file: null, steps: null, limits: '', page: null, view: null };

function renderRoverPath() {
  const limits = `${state.settings.cautionSlopeDeg}/${state.settings.maxSlopeDeg}`;
  if (limits === rover.limits) return;
  rover.limits = limits;
  roverGroup.clearLayers();
  const result = rover.page.roverClasses(rover.steps, state.settings);
  const text = rover.page.roverLines(result, rover.file, state.settings);
  for (const { level, latlngs } of result.lines) {
    L.polyline(latlngs, { color: SLOPE_COLORS[level], weight: ROVER_WEIGHTS[level], opacity: 1, interactive: false }).addTo(roverGroup);
  }
  L.marker(result.steepest.to, {
    interactive: false,
    keyboard: false,
    icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<div class="pin-turn">Steepest ${result.steepest.deg.toFixed(1)}°</div>` }),
  }).addTo(roverGroup);
  $('rover-classes').replaceChildren(...text.classes.map(({ level, text: words }) => {
    const li = document.createElement('li');
    li.dataset.level = level;
    li.textContent = words;
    return li;
  }));
  $('rover-steepest').textContent = text.steepest;
  $('rover-total').textContent = text.total;
  $('rover-scale').textContent = text.fine;
  $('rover-key').textContent = text.key;
}

async function toggleRoverPath() {
  if (!progress.isFinal) return;
  const button = $('btn-rover');
  if (rover.on) {
    clearRoverView();
    return;
  }
  if (!rover.file) {
    button.disabled = true;
    try {
      const res = await fetch(ASSETS['rover_slopes.json']);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      rover.file = await res.json();
      rover.page = await import('./roverpath.js');
      rover.steps = rover.page.decodeRoverPath(rover.file);
    } catch (err) {
      showLoadError(`Could not load the rover path: ${err.message}`);
      return;
    } finally {
      button.disabled = false;
    }
  }
  rover.on = true;
  button.setAttribute('aria-pressed', 'true');
  rover.limits = '';
  rover.view = { center: map.getCenter(), zoom: map.getZoom() };
  renderRoverPath();
  roverGroup.addTo(map);
  $('rover-key').hidden = false;
  $('rover-body').hidden = false;
  map.fitBounds(L.latLngBounds(rover.steps.flatMap((s) => [s.from, s.to])), { padding: [24, 24] });
  if (window.matchMedia('(max-width: 860px)').matches) document.querySelector('.mapwrap').scrollIntoView({ block: 'start' });
}

// Clear takes the colours off and puts the map back where it was before.
function clearRoverView() {
  rover.on = false;
  roverGroup.remove();
  $('rover-key').hidden = true;
  $('rover-body').hidden = true;
  $('btn-rover').setAttribute('aria-pressed', 'false');
  if (rover.view) map.setView(rover.view.center, rover.view.zoom, { animate: false });
  rover.view = null;
  $('btn-rover').focus({ preventScroll: true });
}

$('btn-rover-clear').addEventListener('click', clearRoverView);
$('rover-title').closest('section').addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !rover.on) return;
  e.stopPropagation();
  clearRoverView();
});

function renderScienceButtons() {
  const wait = progress.status === 'failed' ? 'No report grid' : progress.isFinal ? '' : REFINING_WORD;
  for (const [id, label] of [['btn-reach', 'Check the nine stops'], ['btn-rover', 'Colour the rover path by slope']]) {
    $(id).disabled = Boolean(wait);
    $(id).textContent = wait || label;
  }
}

$('btn-reach').addEventListener('click', startReachCheck);
$('btn-rover').addEventListener('click', toggleRoverPath);
$('reach-body').addEventListener('click', (e) => {
  const id = e.target.dataset?.reachStop;
  if (id) loadReachRoute(id);
});

// --- Habitat and route -------------------------------------------------------
const HABITAT_ICON = L.divIcon({
  className: '',
  iconSize: [34, 34],
  iconAnchor: [17, 17],
  html: '<div class="pin pin-habitat"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12 12 4l9 8v8H3z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><path d="M9 20v-6h6v6" fill="none" stroke="currentColor" stroke-width="2.4"/></svg></div>',
});

const casing = L.polyline([], { color: '#000', weight: 7, opacity: 0.55, interactive: false }).addTo(map);
const routeLine = L.polyline([], { color: COLORS.route, weight: 3.5, opacity: 1, interactive: false }).addTo(map);
const steepGroup = L.layerGroup().addTo(map);
const abortLine = L.polyline([], { color: '#d7e6ff', weight: 2, dashArray: '1 7', lineCap: 'round', interactive: false }).addTo(map);
const cursorMarker = L.marker([0, 0], {
  interactive: false,
  keyboard: false,
  zIndexOffset: 1000,
  icon: L.divIcon({ className: '', html: '<div class="pin-sample"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }),
});
const turnMarker = L.marker([0, 0], {
  interactive: false,
  keyboard: false,
  zIndexOffset: 900,
  icon: L.divIcon({ className: '', iconSize: [0, 0], html: '<div class="pin-turn">Turn back by here</div>' }),
});
const walkMarker = L.marker([0, 0], {
  interactive: false,
  keyboard: false,
  zIndexOffset: 1100,
  icon: L.divIcon({ className: '', html: '<div class="pin-walker"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }),
});

let habitatMarker = null;
let waypointMarkers = [];
let steepLines = [];
const chart = new ProfileChart($('profile-chart'), (sample) => {
  if (sample) cursorMarker.setLatLng([sample.lat, sample.lon]).addTo(map);
  else cursorMarker.remove();
});

const routePoints = () => (state.habitat ? [state.habitat, ...state.waypoints] : []);

function updateRouteLine() {
  const latlngs = routePoints().map((p) => [p.lat, p.lon]);
  casing.setLatLngs(latlngs);
  routeLine.setLatLngs(latlngs);
}

// --- Report rendering --------------------------------------------------------
const VERDICT_ICONS = {
  go: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="m6.5 12.5 3.8 3.8 7.2-8" fill="none" stroke="#12100e" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  caution: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.5 23.5 22h-23z" fill="currentColor"/><path d="M12 9v6.5M12 18.4v.1" stroke="#12100e" stroke-width="2.8" stroke-linecap="round"/></svg>',
  nogo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.2 1h9.6L23 7.2v9.6L16.8 23H7.2L1 16.8V7.2z" fill="currentColor"/><path d="m7.5 7.5 9 9m0-9-9 9" stroke="#12100e" stroke-width="2.8" stroke-linecap="round"/></svg>',
  refining: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="4 5"/></svg>',
};

const fmtKm = (m) => `${(m / 1000).toFixed(2)} km`;
const fmtElevation = (z) => (z === null ? 'no data' : `${Math.round(z)} m`);

function setStat(id, main, detail = '') {
  $(id).innerHTML = detail ? `${main} <small>${detail}</small>` : main;
}

function clearReport() {
  const box = $('verdict');
  box.dataset.state = 'empty';
  $('verdict-icon').innerHTML = '';
  $('verdict-word').textContent = 'No route yet';
  $('verdict-reasons').innerHTML = `<li>Press Try the demo walk, or ${tapWord().toLowerCase()} the map to draw your own. Your walk starts at the base, the house icon.</li>`;
  $('verdict-more').hidden = true;
  $('route-sentence').hidden = true;
  ['s-distance', 's-slope', 's-time', 's-back', 's-eva', 's-margin', 's-abort', 's-climb'].forEach((id) => { $(id).textContent = '-'; });
  lastReport = null;
  delete $('summary').dataset.route;
  closeExplain();
  scenario = null; // The route it described is gone.
  renderScenario();
  showSafestNote('');
  $('time-note').hidden = true;
  $('profile').hidden = true;
  $('legs-body').innerHTML = '<p class="fine">Draw a route to see each leg.</p>';
  $('stops-body').innerHTML = '<p class="fine">Draw a route to list nearby stops.</p>';
  $('stops-count').textContent = '';
  steepGroup.clearLayers();
  abortLine.setLatLngs([]);
  cursorMarker.remove();
  markNearStops([]);
  showTurnBack(null);
  renderScienceAlong(null);
  walkPlayer.update(null);
}

function markNearStops(near) {
  const ids = new Set(near.map((s) => s.id));
  for (const [id, marker] of stopMarkers) marker.getElement()?.firstElementChild?.classList.toggle('is-near', ids.has(id));
}

function renderStops(near) {
  $('stops-count').textContent = near.length ? String(near.length) : '';
  markNearStops(near);
  const body = $('stops-body');
  if (near.length === 0) {
    body.innerHTML = `<p class="fine">No science stops within ${state.settings.stopRadiusKm} km of this route.</p>`;
    return;
  }
  body.replaceChildren(...near.map((stop) => {
    const el = document.createElement('article');
    el.className = 'stop';
    el.innerHTML = `<div class="stop-head"><span class="stop-name">${escapeHtml(stop.name)}</span><span class="stop-dist">${fmtKm(stop.distanceM)} off route</span></div>
      <p>${escapeHtml(stop.why)}</p>
      <p class="stop-meta">${escapeHtml(stop.category)}. ${escapeHtml(stop.mission)}, ${escapeHtml(stop.instrument)}.</p>
      <div class="stop-actions"><button type="button" class="linklike" data-act="add">Add to route</button>
      <a href="${escapeHtml(stop.source_url)}" target="_blank" rel="noopener">Source</a></div>`;
    el.querySelector('[data-act="add"]').addEventListener('click', () => addWaypoint(stop));
    return el;
  }));
}

function renderLegs(points, samples, pendingText) {
  const slopeCell = (deg) => {
    if (pendingText) return pendingText;
    return deg === null ? 'no data' : `${deg.toFixed(1)}°`;
  };
  const rows = legTable(samples, points).map((l) => `<tr>
    <td>${l.leg}</td><td>${fmtKm(l.lengthM)}</td><td>${fmtElevation(l.startZ)}</td><td>${fmtElevation(l.endZ)}</td>
    <td>${slopeCell(l.maxSlopeDeg)}</td></tr>`).join('');
  $('legs-body').innerHTML = `<table class="legs"><thead><tr><th scope="col">Leg</th><th scope="col">Length</th><th scope="col">Start</th><th scope="col">End</th><th scope="col">Max slope</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function drawSteepSections(samples, sections) {
  steepGroup.clearLayers();
  steepLines = sections.map((section) => {
    const latlngs = samples.filter((s) => s.d >= section.fromM && s.d <= section.toM).map((s) => [s.lat, s.lon]);
    return L.polyline(latlngs, { color: COLORS[section.severity], weight: 5, opacity: 1, interactive: false }).addTo(steepGroup);
  });
}

// The stops the report already lists as near the route, in the order the walk reaches
// them, with the sourced reason each matters. Only once the report grid has loaded.
function renderScienceAlong(near, m, settings) {
  $('science-card').hidden = !near;
  $('science-line').hidden = !near;
  if (!near) return;
  const radius = `${settings.stopRadiusKm} km`;
  const count = near.length === 1 ? '1 science stop' : `${near.length || 'No'} science stops`;
  $('science-line').textContent = `${count} within ${radius} of this walk.`;
  const ordered = alongRoute(near);
  $('science-list').replaceChildren(...ordered.map((stop) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="science-name">${escapeHtml(stop.name)}</span> <span class="science-off">${fmtKm(stop.distanceM)} from the route</span>
      <p>${escapeHtml(stop.why)} <a href="${escapeHtml(stop.source_url)}" target="_blank" rel="noopener">Source</a></p>`;
    return li;
  }));
  $('science-list').hidden = near.length === 0;
  $('science-none').hidden = near.length > 0;
  if (near.length === 0) {
    const nearest = stopsNearRoute(stops, m.samples, Infinity)[0];
    $('science-none').textContent = nearest
      ? `No science stops within ${radius} of this walk. The nearest is ${nearest.name}, ${fmtKm(nearest.distanceM)} from the route.`
      : `No science stops within ${radius} of this walk.`;
  }
}

function showTurnBack(point, m, settings) {
  $('turnback').hidden = !point;
  if (point) $('turnback').textContent = turnBackText(point, m, settings);
  if (point?.kind === 'turn') turnMarker.setLatLng([point.lat, point.lon]).addTo(map);
  else turnMarker.remove();
}

// --- Play the walk -----------------------------------------------------------
let litSection = -1;

function lightSection(section) {
  if (section === litSection) return;
  litSection = section;
  steepLines.forEach((line, i) => line.setStyle({ weight: i === section ? 10 : 5 }));
  chart.markSection(section);
}

const walkPlayer = setupWalk({
  onStart() {
    map.closePopup();
    setMapLayersOpen(false);
    map.invalidateSize(false); // A phone's map changes size while the walk plays.
    const route = L.latLngBounds(routePoints().map((p) => [p.lat, p.lon]));
    if (!map.getBounds().contains(route)) fitRoute();
    // On a phone the player sits over the page, with the map and profile above it.
    if (window.matchMedia('(max-width: 860px)').matches) document.querySelector('.mapwrap').scrollIntoView({ block: 'start' });
  },
  onFrame(frame) {
    walkMarker.setLatLng([frame.lat, frame.lon]).addTo(map);
    if (chart.index !== frame.index) chart.place(frame.index);
    lightSection(frame.section);
  },
  onEnd() {
    map.invalidateSize(false);
    walkMarker.remove();
    chart.clear();
    lightSection(-1);
  },
});

function renderReport() {
  checkReachIsCurrent();
  if (rover.on) renderRoverPath();
  const hasRoute = state.waypoints.length > 0;
  $('btn-undo').disabled = !hasRoute;
  $('btn-clear').disabled = !hasRoute;
  $('btn-safest').disabled = !hasRoute || !progress.isFinal;
  const { terrain, status } = progress;
  if (!terrain) return; // Leaves the loading or error message in place.
  if (!hasRoute) {
    clearReport();
    return;
  }

  const { settings } = state;
  const points = routePoints();
  const m = measureRoute(points, state.habitat, terrain, settings);
  const verdict = decideVerdict(m, settings);
  const shown = verdictForDisplay(verdict, status, terrain.meta.cell_size_m);
  const sections = status === 'final' ? steepSections(m.samples, settings) : [];
  // Only the report grid can place this. A preview shows nothing.
  const turnBack = status === 'final' ? turnBackPoint(m, settings) : null;
  const near = stopsNearRoute(stops, m.samples, settings.stopRadiusKm);
  lastReport = { m, verdict, sections, near, settings, status, legs: points.length - 1, previewCellM: terrain.meta.cell_size_m };
  walkPlayer.update(lastReport);
  $('summary').dataset.route = 'true';

  // Until the report grid arrives, anything that depends on elevation is a preview.
  // Slope is withheld outright, because the coarse grid understates it.
  const isFinal = status === 'final';
  const pendingText = status === 'failed' ? 'no report grid' : 'refining...';
  const pending = isFinal ? '' : pendingText;

  $('verdict').dataset.state = shown.state;
  $('verdict-icon').innerHTML = VERDICT_ICONS[shown.state] ?? '';
  $('verdict-word').textContent = shown.word;
  $('verdict-reasons').replaceChildren(...shown.reasons.map((r) => {
    const li = document.createElement('li');
    li.textContent = r.line ?? r.text;
    if (r.level !== 'ok') li.className = `sev-${r.level}`;
    return li;
  }));
  // One line under the verdict. Why? always lists every reason.
  const extra = shown.reasons.filter((r) => r.level !== 'ok').length - 1;
  $('verdict-more').hidden = extra < 1;
  $('verdict-more').textContent = `Plus ${extra} more. Press Why?`;

  showToolsHint(status === 'final');
  const sentence = routeSentence(m, verdict, settings, status);
  $('route-sentence').hidden = !sentence;
  $('route-sentence').textContent = sentence;
  showTurnBack(turnBack, m, settings);
  renderScienceAlong(status === 'final' ? near : null, m, settings);

  $('stats').classList.toggle('is-preview', !isFinal);
  setStat('s-distance', fmtKm(m.distanceM));
  if (isFinal) {
    setStat('s-slope', m.leavesCoverage && m.maxSlopeDeg === 0 ? 'no data' : `${m.maxSlopeDeg.toFixed(1)}°`, m.maxSlopeDeg > 0 ? `at ${fmtKm(m.maxSlopeAtM)}` : '');
  } else {
    setStat('s-slope', pendingText);
  }
  setStat('s-time', formatDuration(m.outH), pending);
  setStat('s-back', formatDuration(m.backH), pending);
  setStat('s-eva', formatDuration(m.evaUsedH), pending || `of ${settings.evaHours} h`);
  setStat('s-margin', isFinal ? `${m.marginPct.toFixed(0)}%` : pendingText, isFinal ? `aim for ${settings.minMarginPct}%` : '');
  setStat('s-abort', fmtKm(m.abort.maxM), `at ${fmtKm(m.abort.atM)}`);
  setStat('s-climb', `+${Math.round(m.ascentM)} / -${Math.round(m.descentM)} m`, pending);

  $('time-note').hidden = false;
  $('time-note').innerHTML = `<span class="tag-assumption">ASSUMPTION</span> Walking speed (${settings.baseSpeedKmh} km/h on flat ground), the ${settings.evaHours} h time limit and the slope limits are placeholders, not NASA figures. Change them in More tools. The model has no fatigue, suit mass or Mars-gravity effect on walking speed.`;

  drawSteepSections(m.samples, sections);
  abortLine.setLatLngs([[m.abort.lat, m.abort.lon], [state.habitat.lat, state.habitat.lon]]);

  $('profile').hidden = false;
  $('key-caution').textContent = `Over ${settings.cautionSlopeDeg}°`;
  $('key-nogo').textContent = `Over ${settings.maxSlopeDeg}°`;
  $('profile-source').innerHTML = `Source: <a href="${terrain.source.url}" target="_blank" rel="noopener">USGS CTX DEM</a>, ${Math.round(terrain.meta.cell_size_m)} m grid${isFinal ? '' : `, preview, ${pendingText}`}`;
  chart.update({ samples: m.samples, steep: sections, waypoints: waypointDistances(points), turnBackM: turnBack?.kind === 'turn' ? turnBack.atM : null });

  renderLegs(points, m.samples, pending);
  renderStops(near);
  renderExplain();
  renderScenario();
}

// --- Scenarios ---------------------------------------------------------------
let scenario = null;
let scenarioStep = 0;

function renderScenario() {
  const card = $('scenario-card');
  card.hidden = !scenario;
  for (const b of $('scenario-list').children) b.setAttribute('aria-pressed', String(b.dataset.scenario === scenario?.id));
  if (!scenario || !lastReport) return;
  const measure = (points) => measureRoute(points, state.habitat, progress.terrain, state.settings);
  card.innerHTML = scenarioHtml(scenarioView(scenario, lastReport, { stops, points: routePoints(), measure }), scenarioStep);
}

function loadScenario(id) {
  scenario = SCENARIOS.find((s) => s.id === id);
  scenarioStep = 0;
  const [home, ...rest] = scenarioRoute(scenario, stops);
  setHabitat(home);
  state.waypoints = rest;
  renderWaypoints();
  fitRoute();
}

function setupScenarios() {
  $('scenario-list').replaceChildren(...SCENARIOS.map((s) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn';
    button.dataset.scenario = s.id;
    button.innerHTML = `<span class="scenario-name">${escapeHtml(s.title)}</span><span class="scenario-blurb">${escapeHtml(s.blurb)}</span>`;
    button.disabled = true; // Like the demo, these need the stops and a grid.
    button.addEventListener('click', () => loadScenario(s.id));
    return button;
  }));
  $('scenario-card').addEventListener('click', (e) => {
    const move = Number(e.target.dataset?.scenarioStep);
    if (!move) return;
    scenarioStep += move;
    renderScenario();
    // The buttons were just rebuilt, so put keyboard focus back on one.
    const card = $('scenario-card');
    (card.querySelector(`[data-scenario-step="${move}"]:not(:disabled)`) ?? card.querySelector('[data-scenario-step]:not(:disabled)'))?.focus();
  });
}

// --- Explain -----------------------------------------------------------------
let lastReport = null;
let explaining = null;
let explainOpener = null;

function renderExplain() {
  const open = Boolean(explaining && lastReport);
  for (const b of document.querySelectorAll('[data-explain]')) {
    b.setAttribute('aria-expanded', String(open && b.dataset.explain === explaining));
  }
  $('explain').hidden = !open;
  if (open) $('explain-body').innerHTML = explainHtml(explainItem(explaining, lastReport));
}

function closeExplain() {
  explaining = null;
  renderExplain();
}

for (const button of document.querySelectorAll('[data-explain]')) {
  button.addEventListener('click', () => {
    const same = explaining === button.dataset.explain;
    explaining = same ? null : button.dataset.explain;
    explainOpener = button;
    renderExplain();
    if (same) return;
    $('explain').focus({ preventScroll: true });
    $('explain').scrollIntoView({ block: 'nearest' });
  });
}

$('btn-explain-close').addEventListener('click', () => {
  closeExplain();
  explainOpener?.focus();
});

// --- Inspect -----------------------------------------------------------------
// A separate mode, because a plain click on the map always adds a waypoint.
let inspecting = false;
let inspected = null;
const inspectPopup = L.popup({ maxWidth: 300, minWidth: 200, className: 'inspect-popup' });
const inspectPin = L.circleMarker([0, 0], { radius: 6, color: '#fff', weight: 2, fill: false, interactive: false });

inspectPopup.on('remove', () => {
  inspected = null;
  inspectPin.remove();
  renderModeHint();
});

// One message says what a tap or click will do. In Check a point it first says how to use
// it, then replaces that with how to leave. On a phone that then clears, because the mode
// switch still shows which mode is on and the map needs the room.
const usesTouch = () => window.matchMedia('(pointer: coarse)').matches;
const tapWord = () => (usesTouch() ? 'Tap' : 'Click');
const INSPECT_STEP_MS = 5000;
let inspectStep = 0;
let inspectTimer = 0;

function showInspectStep(n) {
  clearTimeout(inspectTimer);
  inspectStep = n;
  renderModeHint();
  if (n === 0) inspectTimer = setTimeout(() => showInspectStep(1), INSPECT_STEP_MS);
  else if (n === 1 && compactPopups()) inspectTimer = setTimeout(() => showInspectStep(2), INSPECT_STEP_MS);
}

function renderModeHint() {
  const leave = usesTouch() ? 'Tap Draw a route to go back.' : 'Press Esc to go back to drawing.';
  let note = 'Check a point reads elevation and slope at any spot.';
  if (inspecting) note = [`${tapWord()} the map to read elevation and slope at that spot.`, `Nothing is added to your route. ${leave}`, ''][inspectStep];
  else if (state.waypoints.length === 0) note = `${tapWord()} the map to add a point. Check a point reads elevation and slope at any spot.`;
  if ($('mode-note').textContent !== note) $('mode-note').textContent = note;
  $('map-top').dataset.drawing = String(!inspecting && state.waypoints.length > 0);
}

function coordinatesOf(geojson) {
  const points = [];
  const walk = (c) => {
    if (typeof c[0] === 'number') points.push({ lat: c[1], lon: c[0] });
    else c.forEach(walk);
  };
  for (const f of geojson.features ?? [geojson]) walk(f.geometry.coordinates);
  return points;
}

const inBounds = (bounds, point) => L.latLngBounds(bounds).contains([point.lat, point.lon]);

// Tile layers are pictures, so the app cannot read a value from them. It says what the
// layer shows and whether it covers this point. Vector layers have real positions.
function activeLayerLines(point) {
  const active = [BASE_LAYERS.find((c) => c.id === state.baseId), ...TILE_OVERLAYS.filter((c) => state.overlays.has(c.id))];
  const lines = active.map((cfg) => ({
    label: cfg.instrument,
    text: inBounds(cfg.bounds, point) ? cfg.shows : 'no coverage at this point.',
  }));
  if (state.overlays.has('slope')) {
    const degrees = progress.isFinal ? slopeAt(progress.terrain, point.lat, point.lon) : null;
    const words = { go: 'green', caution: 'yellow', nogo: 'red' };
    lines.unshift({
      label: 'Slope map',
      text: progress.isFinal
        ? (degrees === null ? 'no colour here: no elevation data.' : `${words[slopeClass(degrees, state.settings)]} at this point.`)
        : REFINING_WORD,
    });
  }
  if (state.overlays.has('rover') && vectorData.has('rover')) {
    const near = nearest(point, coordinatesOf(vectorData.get('rover')));
    lines.push({ label: 'Rover track', text: `nearest point ${fmtKm(near.distanceM)} away.` });
  }
  if (state.overlays.has('hydrous') && vectorData.has('hydrous')) {
    const near = nearest(point, coordinatesOf(vectorData.get('hydrous')));
    lines.push({ label: 'Mineral detections', text: `nearest catalog point ${fmtKm(near.distanceM)} away.` });
  }
  return lines;
}

function renderInspect() {
  if (!inspected) return;
  inspectPopup.setContent(inspectHtml(inspectPoint(inspected, {
    terrain: progress.terrain,
    status: progress.status,
    settings: state.settings,
    habitat: state.habitat,
    stops,
    layers: activeLayerLines(inspected),
  })));
}

function showInspect(point) {
  map.closePopup(inspectPopup);
  inspected = point;
  inspectPin.setLatLng([point.lat, point.lon]).addTo(map);
  inspectPopup.setLatLng([point.lat, point.lon]);
  // A short map, as on a phone, must still show the whole card and its close button.
  inspectPopup.options.maxHeight = compactPopups() ? null : Math.max(160, map.getSize().y - 90);
  renderInspect();
  inspectPopup.openOn(map);
  renderModeHint();
}

function setInspecting(on) {
  inspecting = on;
  document.body.classList.toggle('is-inspecting', on);
  $('mode-draw').setAttribute('aria-pressed', String(!on));
  $('mode-inspect').setAttribute('aria-pressed', String(on));
  $('keyboard-hint').textContent = `Arrow keys move the map. Enter ${on ? 'checks the point' : 'adds a point'} at the crosshair.`;
  if (!on) map.closePopup(inspectPopup);
  if (on) showInspectStep(0);
  else clearTimeout(inspectTimer);
  renderModeHint();
}

$('mode-draw').addEventListener('click', () => setInspecting(false));
$('mode-inspect').addEventListener('click', () => setInspecting(true));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && inspecting && !$('about').open) setInspecting(false);
});

// Dragging fires far faster than the screen redraws. One report per frame is enough.
let reportQueued = false;
function updateReport() {
  if (reportQueued) return;
  reportQueued = true;
  requestAnimationFrame(() => {
    reportQueued = false;
    renderReport();
    renderInspect();
    renderPresetState();
    renderModeHint();
    scheduleHashWrite();
  });
}

// Browsers limit how often history can be rewritten (Safari: 100 per 30 s), so a
// drag must not write on every frame. Wait until the route stops changing.
let hashTimer = 0;
function scheduleHashWrite() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(writeHash, 250);
}

// --- Shareable links ---------------------------------------------------------
let startHash = null; // The plan as first loaded. Null until start-up has finished.
let linkPreset = null; // The preset named by the link this page was opened from.

const planHash = (preset) => encodeState({
  habitat: state.habitat, waypoints: state.waypoints, baseId: state.baseId, overlays: state.overlays, preset,
});

// The full plan for sharing. Copy link gives this, so a preset always travels with a link.
const shareHash = () => planHash(presetOf(state.settings)?.id);

// The address bar keeps the route but not a preset chosen on this page. A browser brings an
// address back on a reload, a restored tab and in its suggestions, so a preset kept there
// would return on a visit that never asked for it. A preset that came in on a link stays,
// so reloading a shared link still shows what was shared.
const currentHash = () => planHash(presetOf(state.settings)?.id === linkPreset ? linkPreset : null);

function writeHash() {
  if (startHash === null) return;
  const next = currentHash();
  const current = window.location.hash.slice(1);
  // A fresh, untouched visit keeps a clean URL.
  if (next === current || (!current && next === startHash)) return;
  window.history.replaceState(null, '', `#${next}`);
}

function applySharedPlan() {
  const plan = decodeState(window.location.hash, {
    baseIds: BASE_LAYERS.map((c) => c.id),
    overlayIds: [...TILE_OVERLAYS, ...VECTOR_OVERLAYS, ...COMPUTED_OVERLAYS].map((c) => c.id),
    presetIds: PRESETS.map((p) => p.id),
  });
  if (!plan) return false;
  // A link with no preset means Standard, so every older link reads as it always did.
  const wanted = plan.preset ?? 'standard';
  linkPreset = plan.preset;
  if (presetOf(state.settings)?.id !== wanted) {
    state.settings = presetSettings(wanted);
    previousSettings = null;
    renderSettings();
    settingsChanged();
  }
  if (plan.baseId) showBase(plan.baseId);
  if (plan.overlays) {
    for (const cfg of [...TILE_OVERLAYS, ...VECTOR_OVERLAYS, ...COMPUTED_OVERLAYS]) {
      const on = plan.overlays.has(cfg.id);
      if (on !== state.overlays.has(cfg.id)) setOverlay(cfg.id, on);
    }
  }
  if (plan.habitat) setHabitat(plan.habitat);
  state.waypoints = plan.waypoints;
  renderWaypoints();
  renderLayerRows();
  fitRoute();
  return true;
}

function fitRoute() {
  const points = routePoints();
  if (points.length < 2) return;
  // Wait for the profile to open, because it changes the map's height.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    map.invalidateSize();
    // More room at the top, so the mode switch never sits on the route.
    map.fitBounds(points.map((p) => [p.lat, p.lon]), { paddingTopLeft: [50, 76], paddingBottomRight: [50, 50], maxZoom: 14, animate: false });
  }));
}

function loadDemo() {
  const byId = (id) => stops.find((s) => s.id === id);
  const home = byId(DEMO.habitat);
  setHabitat({ lat: home.lat, lon: home.lon });
  state.waypoints = [...DEMO.stops.map(byId).map((s) => ({ lat: s.lat, lon: s.lon })), { ...DEMO.end }];
  renderWaypoints();
  fitRoute();
}

// A full report on every drag frame stutters on a long route. While dragging, only the
// line and the distance change, and the report dims so its verdict never reads as
// current. On release the normal report runs, so the result is exactly the same.
function startDrag() {
  walkPlayer.update(null);
  showTurnBack(null);
  renderScienceAlong(null);
  document.body.classList.add('is-dragging');
  steepGroup.clearLayers();
  abortLine.setLatLngs([]);
}

function updateDuringDrag() {
  checkReachIsCurrent();
  updateRouteLine();
  setStat('s-distance', fmtKm(pathLengthM(routePoints())));
}

function endDrag() {
  document.body.classList.remove('is-dragging');
  updateReport();
}

function waypointIcon(n) {
  return L.divIcon({ className: '', iconSize: [24, 24], iconAnchor: [12, 12], html: `<div class="pin pin-waypoint">${n}</div>` });
}

function renderWaypoints() {
  waypointMarkers.forEach((m) => m.remove());
  waypointMarkers = state.waypoints.map((p, i) => {
    const marker = L.marker([p.lat, p.lon], {
      draggable: true,
      icon: waypointIcon(i + 1),
      title: `Waypoint ${i + 1}, drag to move`,
      alt: `Waypoint ${i + 1}`,
    }).addTo(map);
    marker.on('dragstart', startDrag);
    marker.on('drag', (e) => {
      state.waypoints[i] = { lat: e.latlng.lat, lon: e.latlng.lng };
      updateDuringDrag();
    });
    marker.on('dragend', endDrag);
    return marker;
  });
  updateRouteLine();
  updateReport();
}

function setHabitat(p) {
  state.habitat = p;
  if (!habitatMarker) {
    habitatMarker = L.marker([p.lat, p.lon], {
      draggable: true,
      icon: HABITAT_ICON,
      title: 'Habitat, drag to move',
      alt: 'Habitat',
      zIndexOffset: 500,
    }).addTo(map);
    habitatMarker.on('dragstart', startDrag);
    habitatMarker.on('drag', (e) => {
      state.habitat = { lat: e.latlng.lat, lon: e.latlng.lng };
      updateDuringDrag();
    });
    habitatMarker.on('dragend', endDrag);
  } else {
    habitatMarker.setLatLng([p.lat, p.lon]);
  }
  updateRouteLine();
  updateReport();
}

map.on('click', (e) => {
  const point = { lat: e.latlng.lat, lon: e.latlng.lng };
  if (inspecting) showInspect(point); else addWaypoint(point);
});

$('btn-undo').addEventListener('click', () => {
  state.waypoints.pop();
  renderWaypoints();
});

$('btn-clear').addEventListener('click', () => {
  state.waypoints = [];
  renderWaypoints();
});

$('btn-demo').addEventListener('click', loadDemo);
const tour = setupTour({
  opener: $('btn-tour'),
  hasRoute: () => state.waypoints.length > 0,
  loadDemo,
  onOpen() {
    map.closePopup();
    setMapLayersOpen(false);
    document.body.classList.add('tour-open');
  },
  onClose() {
    document.body.classList.remove('tour-open');
  },
});

$('btn-share').addEventListener('click', async () => {
  const button = $('btn-share');
  try {
    await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}#${shareHash()}`);
    button.textContent = 'Copied';
  } catch {
    // Clipboard access can be refused. The address bar then holds the full link.
    window.history.replaceState(null, '', `#${shareHash()}`);
    button.textContent = 'Copy from address bar';
  }
  setTimeout(() => { button.textContent = 'Copy link'; }, 2000);
});

// A one-time pointer to More tools, once there is a verdict to explore further. It goes
// for good when dismissed or when More tools is opened.
const TOOLS_HINT_KEY = 'marswalk-tools-hint-hidden';
let toolsHintGone = false;
try { toolsHintGone = Boolean(localStorage.getItem(TOOLS_HINT_KEY)); } catch { /* Shown again next visit. */ }

function showToolsHint(hasVerdict) {
  $('tools-hint').hidden = toolsHintGone || !hasVerdict || $('more-tools').open;
}

function dismissToolsHint() {
  toolsHintGone = true;
  $('tools-hint').hidden = true;
  try { localStorage.setItem(TOOLS_HINT_KEY, 'true'); } catch { /* As above. */ }
}

$('btn-tools-hint-hide').addEventListener('click', () => {
  dismissToolsHint();
  document.querySelector('.btn-why').focus({ preventScroll: true });
});
$('btn-tools-hint-go').addEventListener('click', () => {
  dismissToolsHint();
  $('more-tools').open = true;
  const summary = document.querySelector('#more-tools > summary');
  summary.scrollIntoView({ block: 'start' });
  summary.focus({ preventScroll: true });
});
$('more-tools').addEventListener('toggle', () => { if ($('more-tools').open) dismissToolsHint(); });

// Storage can be refused, as in a private window. The banner still hides for this visit.
$('btn-start-hide').addEventListener('click', () => {
  document.documentElement.dataset.startHidden = 'true';
  try {
    localStorage.setItem('marswalk-start-hidden', 'true');
  } catch {
    // Nothing to do. It comes back on the next visit, which is harmless.
  }
  $('btn-demo').focus({ preventScroll: true });
});

$('btn-about').addEventListener('click', () => $('about').showModal());
$('btn-about-close').addEventListener('click', () => $('about').close());
// A click on the backdrop lands on the dialog element itself.
$('about').addEventListener('click', (e) => { if (e.target === $('about')) $('about').close(); });

// Keyboard route building: arrow keys pan (from Leaflet), Enter drops a waypoint.
map.getContainer().addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.target !== map.getContainer()) return;
  e.preventDefault();
  const c = map.getCenter();
  const point = { lat: c.lat, lon: c.lng };
  if (inspecting) showInspect(point); else addWaypoint(point);
});

window.addEventListener('hashchange', () => {
  // replaceState does not fire this, so it only runs for a pasted or edited link.
  if (startHash !== null) applySharedPlan();
});

// --- Assumptions -------------------------------------------------------------
const SETTING_FIELDS = [
  { key: 'baseSpeedKmh', label: 'Base walking speed', hint: 'km/h on flat ground', min: 0.5, max: 10, step: 0.1 },
  { key: 'evaHours', label: 'EVA duration available', hint: 'hours, up to 24. ASSUMPTION: a placeholder, not a NASA spec', min: 0.5, max: 24, step: 0.5 },
  { key: 'scienceMinutes', label: 'Science time', hint: 'minutes during the EVA', min: 0, max: 600, step: 5 },
  { key: 'maxSlopeDeg', label: 'No-Go slope limit', hint: 'degrees', min: 1, max: 60, step: 1 },
  { key: 'cautionSlopeDeg', label: 'Caution slope limit', hint: 'degrees', min: 1, max: 60, step: 1 },
  { key: 'minMarginPct', label: 'Budget margin', hint: 'percent kept in reserve', min: 0, max: 90, step: 5 },
  { key: 'stopRadiusKm', label: 'Stop search distance', hint: 'km from the route', min: 0.1, max: 50, step: 0.1 },
  { key: 'sampleStepM', label: 'Sampling interval', hint: 'metres along the route', min: 20, max: 500, step: 10 },
];

// --- Presets -----------------------------------------------------------------
let previousSettings = null; // What the last preset replaced, for the comparison.

function applyPreset(id) {
  if (presetOf(state.settings)?.id === id) return;
  previousSettings = { ...state.settings };
  state.settings = presetSettings(id);
  renderSettings();
  settingsChanged();
}

function renderPresetState() {
  const note = presetNote(state.settings);
  $('preset-note').hidden = !note;
  $('preset-note').textContent = note;
  const active = presetOf(state.settings)?.id;
  for (const b of document.querySelectorAll('[data-preset]')) b.setAttribute('aria-pressed', String(b.dataset.preset === active));

  const box = $('preset-compare');
  box.hidden = !(previousSettings && lastReport);
  if (box.hidden) return;
  const points = routePoints();
  const measure = (settings) => measureRoute(points, state.habitat, progress.terrain, settings);
  box.innerHTML = compareHtml(progress.isFinal ? compareVerdicts(measure, previousSettings, state.settings) : null, progress.status === 'failed' ? 'no report grid' : REFINING_WORD);
}

function setupPresets() {
  $('preset-list').innerHTML = PRESETS.map((p) => `<button type="button" class="btn" data-preset="${p.id}" aria-pressed="false">${p.label}</button>`).join('');
  $('preset-list').addEventListener('click', (e) => {
    if (e.target.dataset.preset) applyPreset(e.target.dataset.preset);
  });
}

function settingsChanged() {
  renderLegend();
  updateReport();
  clearTimeout(slopeTimer); // Typing "25" passes through "2" on the way.
  slopeTimer = setTimeout(paintSlopeMap, 200);
}

function renderSettings() {
  const body = $('settings-body');
  body.innerHTML = `<p class="fine fine-first"><span class="tag-assumption">ASSUMPTION</span> Presets: ${escapeHtml(NOT_NASA)} Every value here is a planning placeholder chosen for this tool, not a NASA requirement. The walking model is ${escapeHtml(WALKING_MODEL.name)}: <a href="${WALKING_MODEL.source_url}" target="_blank" rel="noopener">Tobler 1993</a>.</p>`;
  for (const f of SETTING_FIELDS) {
    const row = document.createElement('label');
    row.className = 'setting';
    row.innerHTML = `<span>${f.label}<small>${f.hint}</small></span>
      <input type="number" min="${f.min}" max="${f.max}" step="${f.step}" value="${state.settings[f.key]}">`;
    row.querySelector('input').addEventListener('input', (e) => {
      const v = e.target.valueAsNumber;
      const ok = Number.isFinite(v) && v >= f.min && v <= f.max;
      e.target.setAttribute('aria-invalid', String(!ok));
      if (!ok) return; // Keep the last good value until this one is valid.
      state.settings[f.key] = v;
      settingsChanged();
    });
    body.append(row);
  }
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'btn';
  reset.style.marginTop = '8px';
  reset.textContent = 'Reset to defaults';
  reset.addEventListener('click', () => applyPreset('standard'));
  body.append(reset);
  renderPresetState();
}

// --- Conditions --------------------------------------------------------------
function renderConditions() {
  const rows = CONDITIONS.map((c) => {
    const value = `${c.approx ? 'about ' : ''}${c.value}${c.unit ? ` ${c.unit}` : ''}`;
    return `<div class="condition">
      <div class="condition-row"><span class="condition-name">${escapeHtml(c.label)}</span><span class="condition-value">${escapeHtml(value)}</span></div>
      <p><span class="where">Measured at ${escapeHtml(c.location.replace(' Crater', ''))}</span>${escapeHtml(c.instrument)}, ${escapeHtml(c.mission)}. ${escapeHtml(c.date_or_sol)}</p>
      <p><a href="${escapeHtml(c.source_url)}" target="_blank" rel="noopener">${escapeHtml(c.source_name)}</a></p>
    </div>`;
  }).join('');
  $('conditions-body').innerHTML = `<p class="banner"><strong>Temperature and wind measured sols 43-44, Apr 2021.</strong> ${escapeHtml(CONDITIONS_NOTE)}</p>
    <div class="feed-note" id="feed-note" hidden></div>${rows}`;
  if (latest.text) showLatest();
}

// Curiosity's outreach weather feed, only when someone opens this panel. A stalled
// request gives up after 3 s and tries once more. A good reading is kept for 6 hours, so
// the 120 KB download is not repeated. It never reaches the report.
const FEED_TIMEOUT_MS = 3000;
const FEED_KEEP_MS = 6 * 3600 * 1000;
const FEED_STORE = 'marswalk-latest-weather-v1';
const latest = { tried: false, text: '' };

async function fetchFeed() {
  for (let attempt = 0; attempt < 2; attempt++) {
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), FEED_TIMEOUT_MS);
    try {
      const res = await fetch(LATEST_FEED.url, { signal: stop.signal });
      if (res.ok) return await res.json();
    } catch {
      // A timeout or a refused request. The second attempt is the last.
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

function showLatest() {
  const box = $('feed-note');
  if (!box) return;
  box.hidden = !latest.text;
  box.innerHTML = latest.text;
}

async function loadLatest() {
  if (!$('feed-note')) renderConditions();
  if (latest.tried) return;
  latest.tried = true;
  let reading = null;
  try {
    const saved = JSON.parse(localStorage.getItem(FEED_STORE) ?? 'null');
    if (saved && Date.now() - saved.at < FEED_KEEP_MS) reading = latestReading(saved.feed);
  } catch { /* Storage can be refused. Fetch instead. */ }
  if (!reading) {
    $('feed-note').hidden = false;
    $('feed-note').textContent = `Checking ${LATEST_FEED.name}...`;
    const feed = await fetchFeed();
    reading = feed ? latestReading(feed) : null;
    if (reading) {
      try { localStorage.setItem(FEED_STORE, JSON.stringify({ at: Date.now(), feed: { soles: [feed.soles.reduce((a, b) => (Number(b.sol) > Number(a.sol) ? b : a))] } })); } catch { /* As above. */ }
    } else if (!feed) {
      latest.text = `<p>${escapeHtml(LATEST_FEED.name)} could not be reached, so only the published measurements below are shown.</p>`;
      showLatest();
      return;
    }
  }
  // An invalid reading shows nothing at all.
  latest.text = reading ? `<p><strong>${escapeHtml(latestLine(reading))}</strong></p><p>${escapeHtml(FEED_LABEL)} <a href="${LATEST_FEED.page}" target="_blank" rel="noopener">Source</a></p>` : '';
  showLatest();
}

// --- Cursor readout ----------------------------------------------------------
map.on('mousemove', (e) => {
  const { lat, lng } = e.latlng;
  const elevation = progress.terrain?.elevationAt(lat, lng) ?? null;
  const box = $('readout');
  box.hidden = false;
  box.textContent = `${lat.toFixed(4)} N, ${lng.toFixed(4)} E` + (elevation === null ? '  no elevation data' : `  ${Math.round(elevation)} m`);
});
map.on('mouseout', () => { $('readout').hidden = true; });

// --- Start -------------------------------------------------------------------
function showLoadError(message) {
  const box = $('load-error');
  box.textContent = message;
  box.hidden = false;
}

// Runs once the page is usable, so a visitor who leaves early still gets a fast return,
// and again when the report grid lands, so that is saved too. It only lists files the
// browser already has, so it costs almost nothing. The site works without it, so a
// failure here is ignored on purpose.
function startRepeatVisitCache() {
  if (!('serviceWorker' in navigator) || window.location.hostname === 'localhost') return;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then(() => navigator.serviceWorker.ready)
    .then((reg) => reg.active?.postMessage({ precache: performance.getEntriesByType('resource').map((r) => r.name) }))
    .catch(() => {});
}

let coverageDrawn = false;

function onGridChange() {
  const { terrain } = progress;
  if (terrain && !coverageDrawn) {
    coverageDrawn = true;
    const b = terrain.meta.bounds;
    L.rectangle([[b.south, b.west], [b.north, b.east]], {
      color: COLORS.route, weight: 1.5, dashArray: '6 6', fill: false, interactive: false, opacity: 0.8,
    }).addTo(map);
  }
  renderScienceButtons();
  updateReport();
  paintSlopeMap();
}

async function start() {
  showBase(state.baseId);
  TILE_OVERLAYS.filter((c) => state.overlays.has(c.id)).forEach((c) => tileLayers.get(c.id).addTo(map));
  renderLegend();
  renderLayerRows();
  setupScenarios();
  setupPresets();
  renderPresetState();
  renderModeHint();
  $('conditions-body').closest('details').addEventListener('toggle', (e) => { if (e.target.open) loadLatest(); });
  // Both panels start closed, so they wait until the first view has finished.
  (window.requestIdleCallback ?? setTimeout)(() => {
    renderSettings();
    renderConditions();
  });

  // The map is already usable. Everything below fills in as it arrives.
  if (state.overlays.has('rover')) {
    ensureVector('rover').catch((err) => showLoadError(`Could not load the rover track: ${err.message}`));
  }
  const stopsReady = ensureVector('stops').then(() => {
    // Default habitat: the rover's landing site, a known spot with full data.
    const landing = stops.find((s) => s.id === 'oeb');
    setHabitat({ lat: landing.lat, lon: landing.lon });
    const shared = applySharedPlan();
    startHash = currentHash();
    return shared;
  });

  grids.coarse.then((t) => {
    progress.offerCoarse(t);
    onGridChange();
  }, () => {}); // The preview is optional. The report grid is what counts.

  grids.full.then((t) => {
    progress.offerFull(t);
    delete document.body.dataset.refining;
    onGridChange();
    startRepeatVisitCache();
    schedulePrefetch();
  }, (err) => {
    console.error(err);
    progress.fullFailed();
    showLoadError(`Could not load the 40 m report grid: ${err.message}`);
    onGridChange();
  });

  try {
    const [shared] = await Promise.all([stopsReady, Promise.any([grids.coarse, grids.full])]);
    if (shared) fitRoute(); // The first report opens the profile, which shrinks the map.
    $('btn-demo').disabled = false; // The demo needs the stops and at least one grid.
    $('btn-tour').disabled = false; // Step 1 can load the demo.
    for (const b of $('scenario-list').children) b.disabled = false;
    startRepeatVisitCache();
  } catch (err) {
    console.error(err);
    showLoadError(`Could not load map data: ${err.errors?.[0]?.message ?? err.message}`);
    $('verdict-word').textContent = 'Terrain data unavailable';
    $('verdict-reasons').innerHTML = '<li>Reload the page to try again. No safety report can be made without elevation data.</li>';
  }
}

start();
