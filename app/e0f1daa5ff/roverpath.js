// Could a human walk where Perseverance drove? The rover's recorded path, classed by the
// report's slope rule. Slope only: no time or EVA rule applies here. The slopes were
// worked out from the 40 m report grid by tools/build_rover_slopes.mjs, so no preview can
// reach them, and the classes follow whichever limits are active.
import { slopeClass } from './slope.js';

export const CLASSES = Object.freeze(['go', 'caution', 'nogo']);

/** The stored file as a list of steps along the path. */
export function decodeRoverPath(file) {
  let lat = 0;
  let lon = 0;
  const points = file.lat.map((dLat, i) => {
    lat += dLat;
    lon += file.lon[i];
    return [lat / file.scale, lon / file.scale];
  });
  return file.slope.map((slope, i) => {
    const last = i === file.slope.length - 1 && file.lastRunM > 0;
    return { from: points[i], to: points[i + 1], deg: slope / file.slopeScale, runM: last ? file.lastRunM : file.stepM, atM: Math.min((i + 1) * file.stepM, file.totalM) };
  });
}

/** Distance in each class, the steepest step, and lines to draw, under these limits. */
export function roverClasses(steps, settings) {
  const metres = { go: 0, caution: 0, nogo: 0 };
  const lines = [];
  let steepest = steps[0];
  let totalM = 0;
  for (const step of steps) {
    const level = slopeClass(step.deg, settings);
    metres[level] += step.runM;
    totalM += step.runM;
    if (step.deg > steepest.deg) steepest = step;
    const open = lines.at(-1);
    if (open?.level === level) open.latlngs.push(step.to);
    else lines.push({ level, latlngs: [step.from, step.to] });
  }
  const percent = Object.fromEntries(CLASSES.map((c) => [c, (metres[c] / totalM) * 100]));
  return { metres, percent, totalM, steepest, lines };
}

const km = (m) => (m / 1000).toFixed(2);

/** The three class names, with the limits in force. Exactly at a limit is the lower class. */
export function classNames(settings) {
  const { cautionSlopeDeg: low, maxSlopeDeg: high } = settings;
  return { go: `Up to ${low}°`, caution: `Over ${low}° to ${high}°`, nogo: `Over ${high}°` };
}

/** The results as the page prints them. */
export function roverLines(result, file, settings) {
  const names = classNames(settings);
  return {
    classes: CLASSES.map((c) => ({ level: c, text: `${names[c]}: ${result.percent[c].toFixed(1)}%, ${km(result.metres[c])} km` })),
    steepest: `Steepest step: ${result.steepest.deg.toFixed(1)}° at ${km(result.steepest.atM)} km along the path.`,
    total: `Distance analysed: ${km(result.totalM)} km along NASA's recorded line, sols ${file.sols[0]} to ${file.sols[1]}. The rover's own odometry says ${file.odometerKm} km.`,
    key: `Rover path: green up to ${settings.cautionSlopeDeg}°, yellow to ${settings.maxSlopeDeg}°, red over ${settings.maxSlopeDeg}°`,
    fine: `Measured in steps of ${file.stepM} m, as the report does. The line's points are about 1 m apart, and measured point to point it reads ${file.everyPoint.maxDeg.toFixed(1)}° at its steepest.`,
  };
}
