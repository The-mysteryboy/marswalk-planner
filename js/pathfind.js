// Finds the gentlest route between two points. Pure functions, no DOM, so the worker and
// the tests run this same code. A* search over the cells of the slope grid.
//
// Cells over the No-Go limit are walls. Every line of the result stays on cells at or
// under that limit, so by the rule in slope.js no step of it can be steeper than the
// limit, in any direction and at any sample spacing. The caller still runs the standard
// report on the result, and that report alone decides what the route is called.
import { slopeBounds } from './slope.js';

// How much a slope costs is a preference for choosing between safe routes, and an
// ASSUMPTION. It is shown to no one as a score. At the caution limit a metre costs
// twice a flat metre, and at twice that limit, five times.
const weight = (deg, cautionDeg) => 1 + (deg / cautionDeg) ** 2;

const SQRT2 = Math.SQRT2;
const MOVES = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2]];

/** Converts between {lat, lon} and fractional cell positions on the slope grid. */
export function cellFrame(meta) {
  const [[south, west], [north, east]] = slopeBounds(meta);
  const w = meta.width - 1;
  const h = meta.height - 1;
  const dx = (east - west) / w;
  const dy = (north - south) / h;
  return {
    w,
    h,
    col: (lon) => (lon - west) / dx,
    row: (lat) => (north - lat) / dy,
    point: (row, col) => ({ lat: north - row * dy, lon: west + col * dx }),
    // Cells are nearly square, and x is shrunk here by the cosine of the latitude.
    aspect: (dx * Math.cos(((north + south) / 2) * (Math.PI / 180))) / dy,
  };
}

/** Index of every cell a straight line between two fractional positions passes through. */
export function cellsBetween(a, b, w) {
  const cuts = [0, 1];
  for (const [from, to] of [[a.col, b.col], [a.row, b.row]]) {
    if (to === from) continue;
    for (let v = Math.ceil(Math.min(from, to)); v <= Math.floor(Math.max(from, to)); v++) cuts.push((v - from) / (to - from));
  }
  cuts.sort((x, y) => x - y);
  const cells = new Set();
  for (let i = 1; i < cuts.length; i++) {
    if (cuts[i] === cuts[i - 1]) continue;
    const t = (cuts[i - 1] + cuts[i]) / 2;
    cells.add(Math.floor(a.row + (b.row - a.row) * t) * w + Math.floor(a.col + (b.col - a.col) * t));
  }
  return [...cells];
}

// A binary heap keyed by cost, holding cell indices.
class Heap {
  cells = [];
  costs = [];

  push(cell, cost) {
    const { cells, costs } = this;
    let i = cells.length;
    cells.push(cell);
    costs.push(cost);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (costs[up] <= cost) break;
      cells[i] = cells[up];
      costs[i] = costs[up];
      i = up;
    }
    cells[i] = cell;
    costs[i] = cost;
  }

  pop() {
    const { cells, costs } = this;
    const top = cells[0];
    const lastCell = cells.pop();
    const lastCost = costs.pop();
    const n = cells.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= n) break;
        if (child + 1 < n && costs[child + 1] < costs[child]) child += 1;
        if (costs[child] >= lastCost) break;
        cells[i] = cells[child];
        costs[i] = costs[child];
        i = child;
      }
      cells[i] = lastCell;
      costs[i] = lastCost;
    }
    return top;
  }

  get size() {
    return this.cells.length;
  }
}

/** A* from one cell to another. Returns the cells in order, or null if walled off. */
function search(slopes, frame, startCell, goalCell, isOpen, cautionDeg) {
  const { w, h, aspect } = frame;
  const best = new Float64Array(slopes.length).fill(Infinity);
  const from = new Int32Array(slopes.length).fill(-1);
  const heap = new Heap();
  const goalCol = goalCell % w;
  const goalRow = Math.floor(goalCell / w);
  // Straight-line cells to the goal. Every metre costs at least 1, so this never overestimates.
  const guess = (cell) => Math.hypot(((cell % w) - goalCol) * aspect, Math.floor(cell / w) - goalRow);

  best[startCell] = 0;
  heap.push(startCell, guess(startCell));
  while (heap.size) {
    const cell = heap.pop();
    if (cell === goalCell) {
      const path = [cell];
      while (path.at(-1) !== startCell) path.push(from[path.at(-1)]);
      return path.reverse();
    }
    const row = Math.floor(cell / w);
    const col = cell % w;
    for (const [dc, dr, length] of MOVES) {
      const c = col + dc;
      const r = row + dr;
      if (c < 0 || r < 0 || c >= w || r >= h) continue;
      const next = r * w + c;
      if (!isOpen(next)) continue;
      // A diagonal must not squeeze between two walls.
      if (dc && dr && !(isOpen(row * w + c) && isOpen(r * w + col))) continue;
      const run = dc && dr ? Math.hypot(aspect, 1) : dc ? aspect : length;
      const cost = best[cell] + (run * (weight(slopes[cell], cautionDeg) + weight(slopes[next], cautionDeg))) / 2;
      if (cost < best[next]) {
        best[next] = cost;
        from[next] = cell;
        heap.push(next, cost + guess(next));
      }
    }
  }
  return null;
}

/**
 * Replace a staircase of cells with a few straight lines. A line can only replace part of
 * the path if it stays on open cells, and on ground no steeper than that part already was.
 */
function straighten(points, slopes, frame, isOpen) {
  const rise = (from, to) => {
    let worst = 0;
    for (let i = from; i < to; i++) {
      for (const cell of cellsBetween(points[i], points[i + 1], frame.w)) worst = Math.max(worst, slopes[cell]);
    }
    return worst;
  };
  const kept = [points[0]];
  let at = 0;
  while (at < points.length - 1) {
    let next = at + 1;
    // Look ahead in growing jumps, so a long path stays quick to straighten.
    for (let probe = points.length - 1; probe > at + 1; probe = at + Math.floor((probe - at) * 0.7)) {
      const cells = cellsBetween(points[at], points[probe], frame.w);
      const limit = rise(at, probe);
      if (cells.every((c) => isOpen(c) && slopes[c] <= limit)) {
        next = probe;
        break;
      }
    }
    kept.push(points[next]);
    at = next;
  }
  return kept;
}

/**
 * The gentlest route from start to goal that avoids every cell over the No-Go limit.
 * @param {Float64Array} slopes from slopeGrid
 * @param {object} meta the report grid's metadata
 * @param {{cautionSlopeDeg: number, maxSlopeDeg: number}} limits
 * @returns {{points: {lat: number, lon: number}[]} | {none: string}}
 */
export function findRoute(slopes, meta, start, goal, limits) {
  const frame = cellFrame(meta);
  const { w, h } = frame;
  const place = (p) => ({ col: frame.col(p.lon), row: frame.row(p.lat) });
  const cellOf = (p) => {
    if (p.col < 0 || p.row < 0 || p.col >= w || p.row >= h) return -1;
    return Math.floor(p.row) * w + Math.floor(p.col);
  };
  const isOpen = (cell) => slopes[cell] <= limits.maxSlopeDeg; // NaN, no data, is closed too.

  const a = place(start);
  const b = place(goal);
  const startCell = cellOf(a);
  const goalCell = cellOf(b);
  if (startCell < 0 || !(slopes[startCell] >= 0)) return { none: 'start-no-data' };
  if (goalCell < 0 || !(slopes[goalCell] >= 0)) return { none: 'goal-no-data' };
  if (!isOpen(startCell)) return { none: 'start-too-steep' };
  if (!isOpen(goalCell)) return { none: 'goal-too-steep' };

  const cells = search(slopes, frame, startCell, goalCell, isOpen, Math.max(limits.cautionSlopeDeg, 1));
  if (!cells) return { none: 'no-path' };

  // Cell centers sit half a cell in from their corners. The ends are the real points, and
  // each lies in the same cell as its neighbour on the path, so those lines stay safe.
  const inner = cells.map((c) => ({ row: Math.floor(c / w) + 0.5, col: (c % w) + 0.5 }));
  const line = straighten([a, ...inner, b], slopes, frame, isOpen);
  return {
    points: line.map((p, i) => {
      if (i === 0) return { lat: start.lat, lon: start.lon };
      if (i === line.length - 1) return { lat: goal.lat, lon: goal.lon };
      return frame.point(p.row, p.col);
    }),
  };
}

/** Why no route was returned, in plain words. */
export function noRouteText(reason, limits) {
  const limit = `the ${limits.maxSlopeDeg}° limit (assumption)`;
  return {
    'no-path': `No route stays within ${limit} between your base and your last point.`,
    'start-too-steep': `Your base is on ground steeper than ${limit}, so no safe route can leave it.`,
    'goal-too-steep': `Your last point is on ground steeper than ${limit}, so no safe route can reach it.`,
    'start-no-data': 'Your base has no elevation data, so no route can be checked.',
    'goal-no-data': 'Your last point has no elevation data, so no route can be checked.',
  }[reason];
}
