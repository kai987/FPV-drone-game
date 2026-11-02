import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const ALPINE_DATA_FILE = 'data/alpine-terrain.json';
export const ALPINE_GENERATED_FILES = [
  'src/game/alpine-massifs.ts',
  'rust/flight-core/src/alpine_data.rs',
];

function object(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...keys].sort().join(','))
    throw new Error(`${label} must contain exactly: ${keys.join(', ')}`);
}
function list(value, minimum, label) {
  if (!Array.isArray(value) || value.length < minimum) throw new Error(`${label} needs at least ${minimum} entries`);
}
function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be finite`);
}
function positive(value, label) {
  finite(value, label);
  if (value <= 0) throw new Error(`${label} must be positive`);
}
function tuple(value, label) {
  if (!Array.isArray(value) || value.length !== 5) throw new Error(`${label} must be a five-number tuple`);
  value.forEach((number, index) => finite(number, `${label}[${index}]`));
  value.slice(2).forEach((number, index) => positive(number, `${label}[${index + 2}]`));
}

/** Reject malformed widths, radii and zero-length crests before either language compiles them. */
export function validateAlpineData(data) {
  object(data, ['schemaVersion', 'peaks', 'ridges', 'massifs'], 'Alpine data');
  if (data.schemaVersion !== 1) throw new Error('Unsupported alpine schemaVersion');
  list(data.peaks, 1, 'peaks');
  data.peaks.forEach((peak, index) => {
    object(peak, ['x', 'z', 'height', 'radiusX', 'radiusZ'], `peaks[${index}]`);
    finite(peak.x, `peaks[${index}].x`); finite(peak.z, `peaks[${index}].z`);
    for (const key of ['height', 'radiusX', 'radiusZ']) positive(peak[key], `peaks[${index}].${key}`);
  });
  list(data.ridges, 1, 'ridges');
  data.ridges.forEach((ridge, index) => {
    object(ridge, ['ax', 'az', 'bx', 'bz', 'width', 'height'], `ridges[${index}]`);
    for (const key of ['ax', 'az', 'bx', 'bz']) finite(ridge[key], `ridges[${index}].${key}`);
    for (const key of ['width', 'height']) positive(ridge[key], `ridges[${index}].${key}`);
    if (ridge.ax === ridge.bx && ridge.az === ridge.bz) throw new Error(`ridges[${index}] has zero length`);
  });
  list(data.massifs, 1, 'massifs');
  data.massifs.forEach((massif, index) => {
    object(massif, ['crests', 'cirques'], `massifs[${index}]`);
    list(massif.crests, 1, `massifs[${index}].crests`);
    list(massif.cirques, 0, `massifs[${index}].cirques`);
    massif.crests.forEach((crest, chain) => {
      const label = `massifs[${index}].crests[${chain}]`;
      list(crest, 2, label);
      crest.forEach((node, position) => {
        tuple(node, `${label}[${position}]`);
        if (position && node[0] === crest[position - 1][0] && node[1] === crest[position - 1][1])
          throw new Error(`${label} contains a zero-length segment`);
      });
    });
    massif.cirques.forEach((cirque, position) => tuple(cirque, `massifs[${index}].cirques[${position}]`));
  });
  return data;
}

function typescript(data) {
  const peaks = data.peaks.map(p => `  { x: ${p.x}, z: ${p.z}, height: ${p.height}, radiusX: ${p.radiusX}, radiusZ: ${p.radiusZ} },`).join('\n');
  const ridges = data.ridges.map(r => `  { ax: ${r.ax}, az: ${r.az}, bx: ${r.bx}, bz: ${r.bz}, width: ${r.width}, height: ${r.height} },`).join('\n');
  const massifs = data.massifs.map(m => `  { crests: [\n${m.crests.map(c => `    [${c.map(n => `[${n.join(', ')}]`).join(', ')}],`).join('\n')}\n  ], cirques: [${m.cirques.map(c => `[${c.join(', ')}]`).join(', ')}] },`).join('\n');
  return `// @generated from ${ALPINE_DATA_FILE}; do not edit by hand.
// Regenerate with: node scripts/generate-alpine-data.mjs
export type AlpineCrest = readonly [x: number, z: number, height: number, leftShoulder: number, rightShoulder: number];
export type AlpineCirque = readonly [x: number, z: number, radiusX: number, radiusZ: number, depth: number];
export interface AlpineMassif { readonly crests: readonly (readonly AlpineCrest[])[]; readonly cirques: readonly AlpineCirque[]; }
export interface AlpinePeak { readonly x: number; readonly z: number; readonly height: number; readonly radiusX: number; readonly radiusZ: number; }
export interface AlpineRidge { readonly ax: number; readonly az: number; readonly bx: number; readonly bz: number; readonly width: number; readonly height: number; }

export const MOUNTAIN_PEAKS: readonly AlpinePeak[] = Object.freeze([
${peaks}
]);
export const MOUNTAIN_RIDGES: readonly AlpineRidge[] = Object.freeze([
${ridges}
]);
export const ALPINE_MASSIFS: readonly AlpineMassif[] = [
${massifs}
];
`;
}

function rustNumber(number) {
  const value = String(number);
  return /[.eE]/.test(value) ? value : `${value}.0`;
}
const rustTuple = values => `(${values.map(rustNumber).join(', ')})`;
function rust(data) {
  const massifs = data.massifs.map(massif => {
    const nodes = massif.crests.flat();
    // Retain the native broad-phase envelope: the widest possible shoulder
    // (1.12x) plus the existing 20 m bend allowance. The independent TS reference
    // keeps its own culling calculation; neither changes the terrain mathematics.
    const padding = Math.max(...nodes.flatMap(node => [node[3], node[4]])) * 1.12 + 20;
    // Normalize only the broad-phase culling bounds to nanometres. This keeps
    // the original authored Rust literals instead of JS decimal-arithmetic tails;
    // every actual crest coordinate, width and height is emitted unrounded.
    const bounds = [Math.min(...nodes.map(n => n[0])) - padding, Math.max(...nodes.map(n => n[0])) + padding,
      Math.min(...nodes.map(n => n[1])) - padding, Math.max(...nodes.map(n => n[1])) + padding].map(value => Number(value.toFixed(9)));
    return `    AlpineMassif {\n        bounds: ${rustTuple(bounds)},\n        crests: &[\n${massif.crests.map(crest => `            &[\n${crest.map(node => `                ${rustTuple(node)},`).join('\n')}\n            ],`).join('\n')}\n        ],\n        cirques: &[\n${massif.cirques.map(cirque => `            ${rustTuple(cirque)},`).join('\n')}\n        ],\n    },`;
  }).join('\n');
  const ridges = data.ridges.map(r => `    ${rustTuple([r.ax, r.az, r.bx, r.bz, r.width, r.height])},`).join('\n');
  return `// @generated from ${ALPINE_DATA_FILE}; do not edit by hand.
// Regenerate with: node scripts/generate-alpine-data.mjs
// Runtime terrain mathematics stays independently implemented in world.rs.
pub(crate) struct AlpineMassif {
    pub(crate) bounds: (f64, f64, f64, f64),
    pub(crate) crests: &'static [&'static [(f64, f64, f64, f64, f64)]],
    pub(crate) cirques: &'static [(f64, f64, f64, f64, f64)],
}
#[rustfmt::skip]
pub(crate) const ALPINE_MASSIFS: [AlpineMassif; ${data.massifs.length}] = [
${massifs}
];
#[rustfmt::skip]
pub(crate) const MOUNTAIN_RIDGES: [(f64, f64, f64, f64, f64, f64); ${data.ridges.length}] = [
${ridges}
];
`;
}

/** Only authored placement is shared; independent terrain algorithms and parity tests remain. */
export function generateAlpineSources(input) {
  const data = validateAlpineData(input);
  return new Map([[ALPINE_GENERATED_FILES[0], typescript(data)], [ALPINE_GENERATED_FILES[1], rust(data)]]);
}

export async function syncAlpineData({ root = projectRoot, check = false } = {}) {
  const data = JSON.parse(await readFile(join(root, ALPINE_DATA_FILE), 'utf8'));
  const outputs = generateAlpineSources(data);
  const stale = [];
  for (const [name, expected] of outputs) {
    let actual;
    try { actual = await readFile(join(root, name), 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (actual !== expected) stale.push(name);
  }
  if (check && stale.length) throw new Error(`Stale alpine data: ${stale.join(', ')}. Run node scripts/generate-alpine-data.mjs`);
  if (!check) for (const name of stale) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), outputs.get(name));
  }
  return { updated: check ? [] : stale, checked: [...outputs.keys()] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--check') || args.length > 1) {
    console.error('Usage: node scripts/generate-alpine-data.mjs [--check]'); process.exitCode = 1;
  } else {
    try {
      const result = await syncAlpineData({ check: args.includes('--check') });
      console.log(args.includes('--check') ? 'Alpine generated data is current' : `Alpine data: ${result.updated.length} generated files updated`);
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
