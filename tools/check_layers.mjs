#!/usr/bin/env node
// Phase 1 verification: for each candidate Trek layer, read its WMTS
// GetCapabilities, check the tile grid against Leaflet's L.CRS.EPSG4326, then
// request a REAL tile over Jezero from both hosts.
// Usage: node tools/check_layers.mjs [--out tools/layer_check_results.json]
// Needs no API key: that is one of the things it tests.
import { writeFileSync } from 'node:fs';
import { argv } from 'node:process';

const TREK = 'https://trek.nasa.gov/tiles/Mars/EQ';
const API = 'https://api.nasa.gov/mars-wmts/catalog';
const JEZERO = { lat: 18.4446, lon: 77.4509 }; // M20 first waypoint (M20_waypoints.json)
const UA = 'MarswalkPlanner-check/1.0';
const TIMEOUT_MS = 30000;
const TARGET_ZOOM = 11; // one tile spans 180/2^z degrees, so z11 is about 0.088 deg (~5 km) on Mars

const CANDIDATES = [
  ['Mars_MGS_MOLA_ClrShade_merge_global_463m', 'Mars Global Surveyor', 'MOLA'],
  ['Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw', 'MGS + Mars Express', 'MOLA + HRSC'],
  ['THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018', 'Mars Odyssey', 'THEMIS IR Day'],
  ['THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018', 'Mars Odyssey', 'THEMIS IR Night'],
  ['Mars_MO_THEMIS-IR-Day_mosaic_global_100m_v12_clon0_ly', 'Mars Odyssey', 'THEMIS IR Day (v12)'],
  ['JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0', 'Mars Reconnaissance Orbiter', 'CTX (controlled)'],
  ['Jezero_CTX_BlockAdj_dd', 'Mars Reconnaissance Orbiter', 'CTX (preliminary, wide)'],
  ['JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd', 'Mars Reconnaissance Orbiter', 'HiRISE (controlled)'],
  ['NES_JEZ_MID_Visible_Mosaic_HiRISE_CTX_HRSC_GCS_MARS_07-10-2018', 'Mars Reconnaissance Orbiter', 'HiRISE/CTX/HRSC'],
  ['Hydrous_Mineral_Detections_CRISM_clon0', 'MRO + Mars Express', 'CRISM + OMEGA'],
  ['Mars_Viking_MDIM21_ClrMosaic_global_232m', 'Viking', 'MDIM 2.1'],
  ['TES_Thermal_Inertia', 'Mars Global Surveyor', 'TES'],
  ['mola_roughness', 'Mars Global Surveyor', 'MOLA roughness'],
  ['Perseverance_Traverse_Path', 'Mars 2020', 'Traverse path'],
];

const tag = (xml, name) => {
  // [^] matches any character including newlines, with no escaping to get wrong.
  const m = xml.match(new RegExp(`<${name}[^>]*>([^]*?)</${name}>`));
  return m ? m[1].trim() : null;
};

async function get(url) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = Buffer.from(await res.arrayBuffer());
    return { status: res.status, type: res.headers.get('content-type') || '', size: body.length, body, ms: Date.now() - t0,
             acao: res.headers.get('access-control-allow-origin') };
  } catch (e) {
    return { status: 0, type: '', size: 0, body: Buffer.alloc(0), ms: Date.now() - t0, error: e.name };
  }
}

function parseCaps(xml) {
  // The Trek files keep a commented-out TileMatrix block; drop comments first.
  const clean = xml.replace(/<!--[\s\S]*?-->/g, '');
  const layer = clean.match(/<Layer>([\s\S]*?)<\/Layer>/)?.[1] ?? '';
  const style = layer.match(/<Style[\s\S]*?<ows:Identifier>(.*?)<\/ows:Identifier>/)?.[1];
  const tms = layer.match(/<TileMatrixSet>(.*?)<\/TileMatrixSet>/)?.[1];
  const format = tag(layer, 'Format');
  const template = layer.match(/ResourceURL[^>]*template="([^"]+)"/)?.[1];
  const ext = template?.match(/\.(\w+)$/)?.[1];
  const wgs = layer.match(/<ows:WGS84BoundingBox[\s\S]*?<ows:LowerCorner>(.*?)<\/ows:LowerCorner>\s*<ows:UpperCorner>(.*?)<\/ows:UpperCorner>/);
  const bbox = wgs ? [...wgs[1].trim().split(/\s+/), ...wgs[2].trim().split(/\s+/)].map(Number) : null;
  const matrices = [...clean.matchAll(/<TileMatrix>([\s\S]*?)<\/TileMatrix>/g)].map(m => {
    const b = m[1];
    return {
      id: b.match(/<ows:Identifier>(.*?)<\/ows:Identifier>/)?.[1],
      topLeft: tag(b, 'TopLeftCorner'),
      w: Number(tag(b, 'TileWidth')), h: Number(tag(b, 'TileHeight')),
      cols: Number(tag(b, 'MatrixWidth')), rows: Number(tag(b, 'MatrixHeight')),
    };
  });
  return { style, tms, format, ext, template, bbox, matrices };
}

// Leaflet L.CRS.EPSG4326: zoom z = 2^(z+1) cols x 2^z rows of 256px tiles from (-180, 90).
function gridCheck(m) {
  return m.every((t, i) => Number(t.id) === i && t.w === 256 && t.h === 256 &&
    t.cols === 2 ** (i + 1) && t.rows === 2 ** i && /^-180(\.0+)?\s+90(\.0+)?$/.test(t.topLeft));
}

// A tile that is one flat color (or nearly) is "no data", not imagery. Cheap
// check: count distinct bytes in the compressed body's middle region.
const distinctBytes = buf => new Set(buf.subarray(0, Math.min(buf.length, 4096))).size;

const rc = (z, { lat, lon }) => ({
  col: Math.floor((lon + 180) / (180 / 2 ** z)),
  row: Math.floor((90 - lat) / (180 / 2 ** z)),
});

const results = [];
for (const [label, mission, instrument] of CANDIDATES) {
  const r = { label, mission, instrument };
  const caps = await get(`${TREK}/${label}/1.0.0/WMTSCapabilities.xml`);
  r.capsStatus = caps.status;
  if (caps.status === 200) {
    const p = parseCaps(caps.body.toString('utf8'));
    Object.assign(r, { style: p.style, tms: p.tms, format: p.format, ext: p.ext, bbox: p.bbox,
      tileSize: p.matrices[0]?.w, maxZoom: p.matrices.at(-1)?.id, leafletGridOk: gridCheck(p.matrices) });
    r.covers = !!p.bbox && p.bbox[0] <= JEZERO.lon && JEZERO.lon <= p.bbox[2] && p.bbox[1] <= JEZERO.lat && JEZERO.lat <= p.bbox[3];
    const z = Math.min(TARGET_ZOOM, Number(r.maxZoom));
    const { row, col } = rc(z, JEZERO);
    r.testZ = z;
    const path = `${label}/1.0.0/${p.style}/${p.tms}/${z}/${row}/${col}.${p.ext}`;
    r.tileUrlTrek = `${TREK}/${path}`;
    const t = await get(r.tileUrlTrek);
    Object.assign(r, { trek: t.status, trekType: t.type, trekSize: t.size, trekMs: t.ms, cors: t.acao ?? null, trekErr: t.error });
    r.distinct = distinctBytes(t.body);
    const a = await get(`${API}/${path}`);
    Object.assign(r, { api: a.status, apiSize: a.size, apiMs: a.ms, apiErr: a.error });
  }
  results.push(r);
  console.log([label.slice(0, 46).padEnd(46),
    `caps=${r.capsStatus}`, `z<=${r.maxZoom ?? '-'}`, `.${r.ext ?? '-'}`, `grid=${r.leafletGridOk ? 'OK' : 'NO'}`,
    `cover=${r.covers ? 'Y' : 'N'}`, `trek=${r.trek}${r.trekErr ? `(${r.trekErr})` : ''}/${r.trekSize ?? 0}b/${r.trekMs ?? 0}ms`,
    `api=${r.api}${r.apiErr ? `(${r.apiErr})` : ''}/${r.apiMs ?? 0}ms`, `cors=${r.cors ?? '-'}`, `bytes=${r.distinct ?? '-'}`].join(' '));
}

const outIdx = argv.indexOf('--out');
if (outIdx > -1) {
  writeFileSync(argv[outIdx + 1], JSON.stringify({ checkedAt: new Date().toISOString(), jezero: JEZERO, results }, null, 2));
  console.log(`wrote ${argv[outIdx + 1]}`);
}
