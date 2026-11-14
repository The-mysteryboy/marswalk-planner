// Shared test helper: loads the real grids the same way the browser does.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { terrainFromBytes } from '../js/terrain.js';

export const dataPath = (name) => fileURLToPath(new URL(`../data/${name}`, import.meta.url));

export const readIndex = () => JSON.parse(readFileSync(dataPath('terrain.json'), 'utf8'));

/** The report grid's metadata. */
export const readMeta = () => readIndex().full;

export function readGridBytes(meta = readMeta()) {
  const buf = readFileSync(dataPath(meta.encoding.file));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
}

export function loadRealTerrain(which = 'full') {
  const meta = readIndex()[which];
  return terrainFromBytes(meta, readGridBytes(meta));
}
