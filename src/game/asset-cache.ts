/** Cache the decoded resource, not merely its URL: preloads and consumers share one load. */
export function createAssetCache<Key, Resource>(load: (key: Key) => Promise<Resource>) {
  const pending = new Map<Key, Promise<Resource>>();
  return {
    load(key: Key) {
      let resource = pending.get(key);
      if (!resource) {
        resource = Promise.resolve().then(() => load(key)).catch(error => {
          if (pending.get(key) === resource) pending.delete(key);
          throw error;
        });
        // A preload can fail before its scene is constructed or after a mount is cancelled.
        void resource.catch(() => {});
        pending.set(key, resource);
      }
      return resource;
    },
  };
}

/** Cancelling one consumer must not cancel an image/module shared with another mount. */
export function abortableResource<Resource>(resource: Promise<Resource>, signal: AbortSignal): Promise<Resource> {
  if (signal.aborted) return Promise.reject(new DOMException('Loading cancelled', 'AbortError'));
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(new DOMException('Loading cancelled', 'AbortError')); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    resource.then(value => { cleanup(); if (!signal.aborted) resolve(value); }, error => { cleanup(); reject(error); });
  });
}
