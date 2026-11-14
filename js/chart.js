// Elevation profile: one series against distance, drawn as plain SVG.
// Crosshair and tooltip on hover or arrow keys. Steep stretches are shaded.

const MARGIN = { top: 8, right: 12, bottom: 20, left: 54 };
const GRID_LINES = 4;

function niceStep(range, targetTicks) {
  const rough = range / targetTicks;
  const power = 10 ** Math.floor(Math.log10(rough));
  const unit = rough / power;
  const nice = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10;
  return nice * power;
}

export class ProfileChart {
  constructor(host, onHover) {
    this.host = host;
    this.onHover = onHover;
    this.data = null;
    this.index = null;
    this.marked = -1;
    new ResizeObserver(() => this.draw()).observe(host);
  }

  update(data) {
    this.data = data;
    this.index = null;
    this.draw();
  }

  draw() {
    const data = this.data;
    const { width, height } = this.host.getBoundingClientRect();
    if (!data || width === 0) return;

    const known = data.samples.filter((s) => s.z !== null);
    if (known.length === 0) {
      this.host.innerHTML = '<p class="fine">This route has no elevation data.</p>';
      return;
    }

    const total = Math.max(data.samples.at(-1).d, 1);
    const zs = known.map((s) => s.z);
    const low = Math.min(...zs);
    const high = Math.max(...zs);
    // A flat route still needs a visible vertical range.
    const span = Math.max(high - low, 10);
    const zStep = niceStep(span, GRID_LINES);
    const zMin = Math.floor(low / zStep) * zStep;
    const zMax = Math.ceil((low + span) / zStep) * zStep;

    const plotW = width - MARGIN.left - MARGIN.right;
    const plotH = height - MARGIN.top - MARGIN.bottom;
    const x = (d) => MARGIN.left + (d / total) * plotW;
    const y = (z) => MARGIN.top + ((zMax - z) / (zMax - zMin)) * plotH;
    this.scale = { x, y, total, plotW };

    const parts = [];
    for (let z = zMin; z <= zMax + 1e-6; z += zStep) {
      parts.push(`<line x1="${MARGIN.left}" x2="${width - MARGIN.right}" y1="${y(z)}" y2="${y(z)}" stroke="var(--line)" stroke-width="1"/>`);
      parts.push(`<text x="${MARGIN.left - 6}" y="${y(z) + 4}" text-anchor="end">${Math.round(z)} m</text>`);
    }
    const xStep = niceStep(total / 1000, Math.max(3, Math.floor(plotW / 90)));
    for (let k = 0; k * 1000 <= total + 1; k += xStep) {
      parts.push(`<text x="${x(k * 1000)}" y="${height - 5}" text-anchor="middle">${Number(k.toFixed(2))} km</text>`);
    }

    for (const section of data.steep) {
      const left = x(section.fromM);
      const w = Math.max(2, x(section.toM) - left);
      const color = section.severity === 'nogo' ? 'var(--nogo)' : 'var(--caution)';
      parts.push(`<rect class="steep-band" x="${left}" y="${MARGIN.top}" width="${w}" height="${plotH}" fill="${color}" fill-opacity="0.3"/>`);
    }

    for (const wp of data.waypoints) {
      parts.push(`<line x1="${x(wp)}" x2="${x(wp)}" y1="${MARGIN.top}" y2="${MARGIN.top + plotH}" stroke="var(--faint)" stroke-width="1" stroke-dasharray="2 4"/>`);
    }

    if (data.turnBackM !== null) {
      const px = x(data.turnBackM);
      const left = px > width / 2;
      parts.push(`<line class="turn-line" x1="${px}" x2="${px}" y1="${MARGIN.top}" y2="${MARGIN.top + plotH}" stroke="var(--text)" stroke-width="2"/>`);
      parts.push(`<text class="turn-label" x="${px + (left ? -5 : 5)}" y="${MARGIN.top + 11}" text-anchor="${left ? 'end' : 'start'}">Turn back by here</text>`);
    }

    // Break the line where elevation is missing rather than bridging the gap.
    const runs = [];
    let run = [];
    for (const s of data.samples) {
      if (s.z === null) {
        if (run.length) runs.push(run);
        run = [];
      } else {
        run.push(s);
      }
    }
    if (run.length) runs.push(run);

    const base = MARGIN.top + plotH;
    for (const r of runs) {
      const line = r.map((s) => `${x(s.d).toFixed(1)},${y(s.z).toFixed(1)}`).join(' L');
      parts.push(`<path d="M${x(r[0].d).toFixed(1)},${base} L${line} L${x(r.at(-1).d).toFixed(1)},${base} Z" fill="var(--accent)" fill-opacity="0.16"/>`);
      parts.push(`<path d="M${line}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>`);
    }

    parts.push(`<line class="cross" x1="0" x2="0" y1="${MARGIN.top}" y2="${base}" stroke="var(--text)" stroke-width="1" visibility="hidden"/>`);
    parts.push('<circle class="cross-dot" r="4" fill="var(--text)" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>');

    const summary = `Elevation profile over ${(total / 1000).toFixed(2)} km, from ${Math.round(low)} to ${Math.round(high)} metres. Use left and right arrow keys to inspect points.`;
    this.host.innerHTML = `<svg width="${width}" height="${height}" role="img" tabindex="0" aria-label="${summary}">${parts.join('')}</svg><div class="profile-tip" hidden></div>`;

    this.svg = this.host.querySelector('svg');
    this.tip = this.host.querySelector('.profile-tip');
    this.svg.addEventListener('pointermove', (e) => this.hoverAtPixel(e));
    this.svg.addEventListener('pointerdown', (e) => this.hoverAtPixel(e));
    this.svg.addEventListener('pointerleave', () => this.clear());
    this.svg.addEventListener('blur', () => this.clear());
    this.svg.addEventListener('keydown', (e) => this.onKey(e));
    this.markSection(this.marked);
    if (this.index !== null) this.place(this.index);
  }

  /** Brings out one steep section, or none with -1. */
  markSection(section) {
    this.marked = section;
    this.host.querySelectorAll('.steep-band').forEach((band, i) => band.setAttribute('fill-opacity', i === section ? '0.75' : '0.3'));
  }

  hoverAtPixel(event) {
    const rect = this.svg.getBoundingClientRect();
    const wanted = ((event.clientX - rect.left - MARGIN.left) / this.scale.plotW) * this.scale.total;
    this.show(this.nearestIndex(wanted));
  }

  nearestIndex(distance) {
    const s = this.data.samples;
    let lo = 0;
    let hi = s.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (s[mid].d < distance) lo = mid; else hi = mid;
    }
    return distance - s[lo].d < s[hi].d - distance ? lo : hi;
  }

  onKey(event) {
    const step = event.shiftKey ? 10 : 1;
    const last = this.data.samples.length - 1;
    if (event.key === 'ArrowRight') this.show(Math.min(last, (this.index ?? -step) + step));
    else if (event.key === 'ArrowLeft') this.show(Math.max(0, (this.index ?? step) - step));
    else if (event.key === 'Escape') this.clear();
    else return;
    event.preventDefault();
  }

  show(i) {
    this.place(i);
    this.onHover?.(this.data.samples[i]);
  }

  /** Moves the cursor and its label, and nothing outside the chart. */
  place(i) {
    this.index = i;
    const s = this.data.samples[i];
    const { x, y } = this.scale;
    const px = x(s.d);
    const line = this.svg.querySelector('.cross');
    const dot = this.svg.querySelector('.cross-dot');
    line.setAttribute('x1', px);
    line.setAttribute('x2', px);
    line.setAttribute('visibility', 'visible');
    if (s.z === null) {
      dot.setAttribute('visibility', 'hidden');
    } else {
      dot.setAttribute('cx', px);
      dot.setAttribute('cy', y(s.z));
      dot.setAttribute('visibility', 'visible');
    }
    const elevation = s.z === null ? 'no elevation data' : `${Math.round(s.z)} m`;
    const slope = s.slopeDeg === null ? '' : `, slope ${s.slopeDeg.toFixed(1)}°`;
    this.tip.textContent = `${(s.d / 1000).toFixed(2)} km: ${elevation}${slope}`;
    this.tip.hidden = false;
    const tipW = this.tip.offsetWidth;
    const w = this.host.clientWidth;
    this.tip.style.left = `${Math.max(MARGIN.left, Math.min(px + 10, w - tipW - 4))}px`;
  }

  clear() {
    if (!this.svg) return;
    this.index = null;
    this.svg.querySelector('.cross')?.setAttribute('visibility', 'hidden');
    this.svg.querySelector('.cross-dot')?.setAttribute('visibility', 'hidden');
    if (this.tip) this.tip.hidden = true;
    this.onHover?.(null);
  }
}
