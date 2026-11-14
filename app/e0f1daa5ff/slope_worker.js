// Slope work away from the page, so the 2.3 million cells never hold up the map.
// The grid arrives once. After that, messages ask for a colouring, a route, or a check
// of every science stop.
import { findRoute } from './pathfind.js';
import { checkStop } from './reach.js';
import { paintSlopes, slopeGrid } from './slope.js';
import { Terrain } from './terrain.js';

let meta = null;
let slopes = null;
let pixels = null;
let canvas = null;
let terrain = null;
let latestCheck = 0;

// A stop at a time, with a break between them, so a newer check can replace this one.
async function checkStops({ id, habitat, stops, settings }) {
  latestCheck = id;
  for (const [done, stop] of stops.entries()) {
    await new Promise((resolve) => { setTimeout(resolve); });
    if (id !== latestCheck) return;
    self.postMessage({ reachId: id, done: done + 1, result: checkStop(stop, habitat, terrain, slopes, settings) });
  }
}

async function paint(limits) {
  pixels = paintSlopes(slopes, limits, pixels ?? undefined);
  canvas.getContext('2d').putImageData(new ImageData(pixels, canvas.width, canvas.height), 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

self.onmessage = async ({ data }) => {
  try {
    if (data.grid) {
      meta = data.grid.meta;
      slopes = slopeGrid(meta, data.grid.samples);
      terrain = new Terrain(meta, data.grid.samples);
      canvas = new OffscreenCanvas(meta.width - 1, meta.height - 1);
    }
    if (data.reach) {
      await checkStops(data.reach);
    } else if (data.limits && data.route) {
      self.postMessage({ routeId: data.routeId, route: findRoute(slopes, meta, data.route.start, data.route.goal, data.limits) });
    } else if (data.limits) {
      self.postMessage({ id: data.id, blob: await paint(data.limits) });
    }
  } catch (err) {
    self.postMessage({ id: data.id, routeId: data.routeId, reachId: data.reach?.id, error: err.message });
  }
};
