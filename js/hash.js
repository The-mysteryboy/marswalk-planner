// Share a plan through the URL hash. Pure functions, so they are easy to test.
// Format: #h=lat,lon&w=lat,lon;lat,lon&b=ctx&o=rover,stops&p=ambitious
// p only appears for a preset other than Standard, so a link with no p means Standard.

const MAX_WAYPOINTS = 200;
const fixed = (v) => Number(v.toFixed(5)); // Five decimals is under a metre on Mars.
const point = (p) => `${fixed(p.lat)},${fixed(p.lon)}`;

export function encodeState({ habitat, waypoints, baseId, overlays, preset }) {
  const parts = [];
  if (habitat) parts.push(`h=${point(habitat)}`);
  if (waypoints.length) parts.push(`w=${waypoints.map(point).join(';')}`);
  parts.push(`b=${baseId}`);
  parts.push(`o=${[...overlays].join(',')}`);
  if (preset && preset !== 'standard') parts.push(`p=${preset}`);
  return parts.join('&');
}

function parsePoint(text) {
  const bits = text.split(',');
  if (bits.length !== 2 || bits.some((b) => b.trim() === '')) return null;
  const [lat, lon] = bits.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/**
 * Read a hash. A link can be edited or truncated by anyone, so anything invalid
 * is dropped rather than trusted. Unknown layer ids are ignored.
 * @returns {null | {habitat, waypoints, baseId, overlays, preset}} null when the hash is empty
 */
export function decodeState(hash, { baseIds, overlayIds, presetIds = [] }) {
  const text = hash.replace(/^#/, '');
  if (!text) return null;
  const fields = Object.fromEntries(text.split('&').map((kv) => {
    const at = kv.indexOf('=');
    return at === -1 ? [kv, ''] : [kv.slice(0, at), kv.slice(at + 1)];
  }));
  const waypoints = (fields.w ?? '').split(';').map(parsePoint).filter(Boolean).slice(0, MAX_WAYPOINTS);
  return {
    habitat: fields.h ? parsePoint(fields.h) : null,
    waypoints,
    baseId: baseIds.includes(fields.b) ? fields.b : null,
    overlays: 'o' in fields ? new Set(fields.o.split(',').filter((id) => overlayIds.includes(id))) : null,
    preset: presetIds.includes(fields.p) ? fields.p : null,
  };
}
