// Prints the tables from tools/measure_load.mjs.
//   node tools/measure_report.mjs <results.json> [--detail]
import { readFileSync } from 'node:fs';
const r = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const detail = process.argv.includes('--detail');
const median = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
const sec = (ms) => (ms == null ? '-' : `${(ms / 1000).toFixed(2)} s`);
const kb = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(2)} MB` : `${Math.round(b / 1024)} KB`);
const paint = (m) => { const v = [m.underlay, m.firstTile].filter((x) => x != null); return v.length ? Math.min(...v) : null; };
const mapReady = (m) => { const p = paint(m); return p == null || m.mapObject == null ? null : Math.max(p, m.mapObject); };

console.log('| Profile | FCP (page text) | Map visible + draggable | Demo usable | Full terrain | First NASA tile | Longest main-thread block |');
console.log('|---|---|---|---|---|---|---|');
for (const p of Object.values(r)) {
  const c = p.cold.map((v) => v.m);
  const longest = median(c.map((m) => Math.max(0, ...m.long.map((l) => l[1]))));
  console.log(`| ${p.label}, first visit | ${sec(median(c.map((m) => m.fcp)))} | ${sec(median(c.map(mapReady)))} | ${sec(median(c.map((m) => m.demo)))} | ${sec(median(c.map((m) => m.fullTerrain)))} | ${sec(median(c.map((m) => m.firstTile)))} | ${longest} ms |`);
  const rp = p.repeat.map((v) => v.m);
  if (rp.length) console.log(`| ${p.label}, repeat (<10 min) | ${sec(median(rp.map((m) => m.fcp)))} | ${sec(median(rp.map(mapReady)))} | ${sec(median(rp.map((m) => m.demo)))} | ${sec(median(rp.map((m) => m.fullTerrain)))} | ${sec(median(rp.map((m) => m.firstTile)))} | - |`);
  const ag = (p.aged ?? []).map((v) => v.m);
  if (ag.length) console.log(`| ${p.label}, return after 11 min | ${sec(median(ag.map((m) => m.fcp)))} | ${sec(median(ag.map(mapReady)))} | ${sec(median(ag.map((m) => m.demo)))} | ${sec(median(ag.map((m) => m.fullTerrain)))} | ${sec(median(ag.map((m) => m.firstTile)))} | - |`);
  console.log(`|   runs: demo ${c.map((m) => sec(m.demo)).join(', ')} | | | | | | |`);
}
if (detail) {
  for (const p of Object.values(r)) {
    const runs = p.cold.slice().sort((a, b) => (a.m.demo ?? 1e9) - (b.m.demo ?? 1e9));
    const mid = runs[runs.length >> 1];
    console.log(`\n### ${p.label}: what loads, in order (median run)`);
    console.log('| # | Resource | Starts | Finishes | Took | Transfer | Encoding |');
    console.log('|---|---|---|---|---|---|---|');
    const tiles = new Map();
    const rows = [];
    const foreign = mid.rows.filter((x) => x.name.startsWith('NOT-SITE'));
    for (const x of mid.rows) {
      if (x.name.startsWith('NOT-SITE')) continue;
      if (x.name.startsWith('tile:')) {
        const t = tiles.get(x.name) ?? { ...x, count: 0, bytes: 0, end: 0, start: x.start };
        t.count += 1; t.bytes += x.bytes; t.end = Math.max(t.end, x.end ?? 0); tiles.set(x.name, t);
        if (t.count === 1) rows.push(t);
      } else rows.push(x);
    }
    rows.forEach((x, i) => console.log(`| ${i + 1} | ${x.name}${x.count ? ` (${x.count} tiles)` : ''} | ${sec(x.start)} | ${sec(x.end)} | ${sec((x.end ?? 0) - x.start)} | ${kb(x.bytes)} | ${x.enc || 'none'}${x.status && x.status !== 200 ? ` [${x.status}]` : ''}${x.failed ? ` FAILED ${x.failed}` : ''} |`));
    const total = mid.rows.filter((x) => !x.name.startsWith('NOT-SITE')).reduce((s, x) => s + x.bytes, 0);
    console.log(`Total for the site: ${kb(total)}. Not from the site: ${foreign.length} requests from ${[...new Set(foreign.map((x) => x.name.slice(9)))].join(', ') || 'none'}. Long tasks: ${JSON.stringify(mid.m.long)}`);
  }
}
