// Fetches tiles the viewer is likely to need next, while the map is idle. NASA's tile
// server takes a second or two per tile, so a tile that is already in the browser's
// cache is the only way a pan or zoom can show imagery straight away.

/**
 * URLs of a layer's tiles covering a view, widened by `ring` tiles on every side.
 * @param {{url: string, bounds: number[][], maxNativeZoom: number}} layer a config from layers.js
 * @param {{west: number, south: number, east: number, north: number}} view in degrees
 */
export function tileUrls(layer, view, zoom, ring = 0) {
  const z = Math.min(Math.round(zoom), layer.maxNativeZoom);
  const span = 180 / 2 ** z;
  const [[south, west], [north, east]] = layer.bounds;
  if (view.east < west || view.west > east || view.north < south || view.south > north) return [];
  const col = (lon) => Math.floor((lon + 180) / span);
  const row = (lat) => Math.floor((90 - lat) / span);
  const urls = [];
  for (let y = Math.max(row(view.north) - ring, row(north)); y <= Math.min(row(view.south) + ring, row(south)); y++) {
    for (let x = Math.max(col(view.west) - ring, col(west)); x <= Math.min(col(view.east) + ring, col(east)); x++) {
      urls.push(layer.url.replace('{z}', z).replace('{y}', y).replace('{x}', x));
    }
  }
  return urls;
}

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = resolve;
    img.onerror = resolve; // A missing tile just means no data there.
    img.src = url;
  });
}

const SLOW_BYTES_PER_MS = 250; // 250 KB/s, or 2 Mbps.

/**
 * True if a timed download shows a genuinely slow link. navigator.connection is not
 * used for this: in a fresh browser it can report 3g on a fast line, before it has
 * measured anything. A file that came from a cache transfers no bytes and proves nothing.
 */
export function linkIsSlow(bytes, downloadMs) {
  return bytes > 0 && downloadMs > 0 && bytes / downloadMs < SLOW_BYTES_PER_MS;
}

/** A small queue, so prefetching never takes every connection from real tile requests. */
export class TilePrefetcher {
  constructor(load = loadImage, limit = 4) {
    this.load = load;
    this.limit = limit;
    this.queue = [];
    this.running = 0;
    this.seen = new Set();
  }

  /** Replace whatever is still waiting. Each URL is only ever fetched once. */
  replace(urls) {
    this.queue = [...new Set(urls)].filter((url) => !this.seen.has(url));
    this.pump();
  }

  /**
   * Drop what is waiting. Downloads under way are left to finish on purpose: NASA's
   * server uses HTTP/1.1, so cancelling one closes its connection, and the handshake
   * for a new one cost far more in testing than letting it finish.
   */
  clear() {
    this.queue = [];
  }

  pump() {
    while (this.running < this.limit && this.queue.length) {
      const url = this.queue.shift();
      this.seen.add(url);
      this.running += 1;
      this.load(url).finally(() => {
        this.running -= 1;
        this.pump();
      });
    }
  }
}
