import assert from 'node:assert/strict';
import test from 'node:test';
import { createMapCache } from '../src/game/map-cache.ts';

const ids = ['valley', 'factory', 'harbor'] as const;
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};

test('all maps finish preparation before selection, and repeated switches reuse the same resources', async () => {
  const allocations: string[] = [], warmed: string[] = [], disposed: string[] = [];
  const stages = ids.map(() => deferred());
  const cache = createMapCache(ids, id => {
    allocations.push(id);
    return { id, dispose: () => { disposed.push(id); } };
  }, async (resource, id) => {
    assert.equal(resource.id, id);
    await stages[ids.indexOf(id)].promise;
    warmed.push(id);
  });
  const initial = cache.getOrCreate('valley');
  const progress: string[] = [];
  const preparing = cache.preload(value => progress.push(`${value.current}:${value.ready.join(',')}`));
  assert.equal(cache.preload(), preparing, 'concurrent preloads share their in-flight work');
  assert.throws(() => cache.getReady('valley'), /not prepared/);
  stages[0].resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(cache.getReady('valley'), initial);
  assert.throws(() => cache.getReady('factory'), /not prepared/);
  stages[1].resolve(); stages[2].resolve(); await preparing;
  for (let cycle = 0; cycle < 20; cycle++) for (const id of ids) {
    assert.equal(cache.getReady(id), cache.getOrCreate(id));
  }
  assert.deepEqual(allocations, ids); assert.deepEqual(warmed, ids); assert.deepEqual(cache.readyIds, ids);
  assert.ok(progress.includes('factory:valley')); assert.equal(progress.at(-1), 'null:valley,factory,harbor');
  cache.dispose(); cache.dispose(); assert.deepEqual(disposed, ids);
  assert.throws(() => cache.getReady('valley'), /disposed/);
});

test('a failed map never becomes ready and cleanup releases every map allocated so far', async () => {
  const allocated: string[] = [], disposed: string[] = [];
  const cache = createMapCache(ids, id => {
    allocated.push(id);
    return { dispose: () => { disposed.push(id); } };
  }, async (_, id) => { if (id === 'factory') throw new Error('texture download failed'); });
  await assert.rejects(cache.preload(), /texture download failed/);
  assert.deepEqual(cache.readyIds, ['valley']);
  assert.throws(() => cache.getReady('factory'), /not prepared/);
  assert.deepEqual(allocated, ['valley', 'factory']);
  cache.dispose(); assert.deepEqual(disposed, allocated);
});

test('late loading completion after disposal cannot revive a map or allocate the remaining maps', async () => {
  const stage = deferred();
  const allocated: string[] = [], disposed: string[] = [];
  const cache = createMapCache(ids, id => {
    allocated.push(id);
    return { dispose: () => { disposed.push(id); } };
  }, () => stage.promise);
  const preparing = cache.preload();
  cache.dispose(); stage.resolve();
  await assert.rejects(preparing, /disposed/);
  assert.deepEqual(allocated, ['valley']); assert.deepEqual(disposed, ['valley']);
  assert.deepEqual(cache.readyIds, []);
  assert.throws(() => cache.getOrCreate('harbor'), /disposed/);
});
