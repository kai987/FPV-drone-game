import assert from 'node:assert/strict';
import test from 'node:test';
import { abortableResource, createAssetCache } from '../src/game/asset-cache.ts';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

test('preloading and scene consumption share one request and the exact decoded resource', async () => {
  const download = deferred<object>();
  let loads = 0;
  const cache = createAssetCache(async (url: string) => {
    assert.equal(url, 'panorama.webp'); loads++;
    return download.promise;
  });
  const preload = cache.load('panorama.webp');
  const consumed = cache.load('panorama.webp');
  assert.equal(preload, consumed);
  await Promise.resolve(); assert.equal(loads, 1);
  const decodedImage = { width: 7096, height: 3548 };
  download.resolve(decodedImage);
  assert.equal(await preload, decodedImage);
  assert.equal(await cache.load('panorama.webp'), decodedImage);
  assert.equal(loads, 1);
});

test('a cancelled StrictMode mount cannot cancel resources needed by the next mount', async () => {
  const download = deferred<object>();
  let loads = 0;
  const cache = createAssetCache(async () => { loads++; return download.promise; });
  const first = new AbortController(), second = new AbortController();
  const cancelled = abortableResource(cache.load('pine-tree.webp'), first.signal);
  const live = abortableResource(cache.load('pine-tree.webp'), second.signal);
  first.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
  const image = { rgba: 'decoded tree' }; download.resolve(image);
  assert.equal(await live, image); assert.equal(loads, 1);
  await assert.rejects(abortableResource(cache.load('pine-tree.webp'), first.signal), { name: 'AbortError' });
});

test('a failed download is evicted, so a later consumer can retry successfully', async () => {
  let loads = 0;
  const image = {};
  const cache = createAssetCache(async () => {
    if (++loads === 1) throw new Error('HTTP 503');
    return image;
  });
  const first = cache.load('grass-texture.webp');
  assert.equal(cache.load('grass-texture.webp'), first);
  await assert.rejects(first, /HTTP 503/);
  assert.equal(await cache.load('grass-texture.webp'), image);
  assert.equal(loads, 2);
});

test('a shared rejection reaches each live consumer while a cancelled consumer stays cancelled', async () => {
  let reject!: (error: Error) => void;
  const download = new Promise<object>((_, fail) => { reject = fail; });
  const cache = createAssetCache(async () => download);
  const controller = new AbortController();
  const cancelled = abortableResource(cache.load('rock'), controller.signal);
  const live = abortableResource(cache.load('rock'), new AbortController().signal);
  controller.abort();
  const cancelledCheck = assert.rejects(cancelled, { name: 'AbortError' });
  const liveCheck = assert.rejects(live, /decode failed/);
  reject(new Error('decode failed'));
  await Promise.all([cancelledCheck, liveCheck]);
});
