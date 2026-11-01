import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { ALPINE_MASSIFS, MOUNTAIN_PEAKS, MOUNTAIN_RIDGES } from '../src/game/alpine-massifs.ts';
import { ALPINE_DATA_FILE, ALPINE_GENERATED_FILES, generateAlpineSources, syncAlpineData } from '../scripts/generate-alpine-data.mjs';

const canonical = JSON.parse(await readFile(new URL('../data/alpine-terrain.json', import.meta.url), 'utf8'));

test('generated alpine placement retains every canonical coordinate in the runtime reference', async () => {
  assert.deepEqual(MOUNTAIN_PEAKS, canonical.peaks);
  assert.deepEqual(MOUNTAIN_RIDGES, canonical.ridges);
  assert.deepEqual(ALPINE_MASSIFS, canonical.massifs);
  const result = await syncAlpineData({ check: true });
  assert.deepEqual(result.updated, []);
  assert.deepEqual(result.checked, ALPINE_GENERATED_FILES);
});

test('alpine generation is deterministic and independent of JSON object key order', () => {
  const reordered = { massifs: canonical.massifs, ridges: canonical.ridges, peaks: canonical.peaks, schemaVersion: canonical.schemaVersion };
  assert.deepEqual(generateAlpineSources(reordered), generateAlpineSources(canonical));
});

test('alpine check detects missing, edited and outdated outputs without repairing them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aeroflow-alpine-data-'));
  try {
    await mkdir(dirname(join(root, ALPINE_DATA_FILE)), { recursive: true });
    await writeFile(join(root, ALPINE_DATA_FILE), JSON.stringify(canonical));
    await assert.rejects(syncAlpineData({ root, check: true }), /Stale alpine data/);
    await assert.rejects(readFile(join(root, ALPINE_GENERATED_FILES[0])), { code: 'ENOENT' });
    assert.equal((await syncAlpineData({ root })).updated.length, 2);
    const name = ALPINE_GENERATED_FILES[0];
    const original = await readFile(join(root, name), 'utf8');
    const edited = `${original}// manual change\n`;
    await writeFile(join(root, name), edited);
    await assert.rejects(syncAlpineData({ root, check: true }), /Stale alpine data: src\/game\/alpine-massifs.ts/);
    assert.equal(await readFile(join(root, name), 'utf8'), edited, 'check must preserve the edited output');
    const repaired = await syncAlpineData({ root });
    assert.deepEqual(repaired.updated, [name]);
    const rustBefore = await readFile(join(root, ALPINE_GENERATED_FILES[1]), 'utf8');
    const revised = structuredClone(canonical);
    revised.massifs[0].crests[0][0][2] += 1;
    await writeFile(join(root, ALPINE_DATA_FILE), JSON.stringify(revised));
    await assert.rejects(syncAlpineData({ root, check: true }), /Stale alpine data/);
    assert.equal(await readFile(join(root, ALPINE_GENERATED_FILES[1]), 'utf8'), rustBefore);
    assert.equal((await syncAlpineData({ root })).updated.length, 2);
    await syncAlpineData({ root, check: true });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('invalid terrain placement fails before it can emit divisions by zero or non-finite fields', () => {
  const invalid = [
    (data: typeof canonical) => { data.massifs[0].crests[0][1] = [...data.massifs[0].crests[0][0]]; },
    (data: typeof canonical) => { data.massifs[0].crests[0][0][3] = 0; },
    (data: typeof canonical) => { data.massifs[0].cirques[0][4] = -1; },
    (data: typeof canonical) => { data.peaks[0].height = Infinity; },
    (data: typeof canonical) => { data.ridges[0].width = NaN; },
    (data: typeof canonical) => { data.ridges[0].bx = data.ridges[0].ax; data.ridges[0].bz = data.ridges[0].az; },
    (data: typeof canonical) => { data.massifs[0].crests[0][0].pop(); },
    (data: typeof canonical) => { data.peaks[0].raduisX = 10; },
  ];
  for (const corrupt of invalid) {
    const data = structuredClone(canonical); corrupt(data);
    assert.throws(() => generateAlpineSources(data), /must|zero-length|zero length/);
  }
});
