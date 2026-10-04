export interface MapLoadProgress<Id extends string> {
  ready: readonly Id[];
  current: Id | null;
  total: number;
}

/** Owns each map once. A map becomes selectable only after its preparation finishes. */
export function createMapCache<Id extends string, Resource extends { dispose(): void }>(
  ids: readonly Id[],
  create: (id: Id) => Resource,
  prepare: (resource: Resource, id: Id) => Promise<void>,
  options?: {
    /** Resource download can finish independently; renderer preparation remains strictly serial. */
    waitUntilReady: (resource: Resource, id: Id) => Promise<void>;
    beforeCreate?: () => Promise<void>;
  },
) {
  const resources = new Map<Id, Resource>();
  const ready = new Set<Id>();
  let disposed = false;
  let preparation: Promise<void> | null = null;
  const readyIds = () => ids.filter(id => ready.has(id));
  const live = () => { if (disposed) throw new Error('Map cache has been disposed'); };
  const getOrCreate = (id: Id) => {
    live();
    if (!ids.includes(id)) throw new Error(`Unknown map: ${id}`);
    let resource = resources.get(id);
    if (!resource) { resource = create(id); resources.set(id, resource); }
    return resource;
  };
  return {
    getOrCreate,
    getReady(id: Id) {
      live();
      if (!ready.has(id)) throw new Error(`Map is not prepared: ${id}`);
      return getOrCreate(id);
    },
    get readyIds(): readonly Id[] { return readyIds(); },
    forEach(visit: (resource: Resource) => void) { live(); resources.forEach(visit); },
    preload(onProgress: (progress: MapLoadProgress<Id>) => void = () => {}) {
      live();
      preparation ??= (async () => {
        if (options) {
          const pending: Promise<void>[] = [];
          let gpuTail = Promise.resolve();
          let failure: unknown;
          let failed = false;
          for (const id of ids) {
            await options.beforeCreate?.();
            live();
            if (failed) throw failure;
            onProgress({ ready: readyIds(), current: id, total: ids.length });
            const resource = getOrCreate(id);
            const work = (async () => {
              await options.waitUntilReady(resource, id);
              live();
              const queued = gpuTail.then(async () => {
                live();
                onProgress({ ready: readyIds(), current: id, total: ids.length });
                await prepare(resource, id);
                live();
                ready.add(id);
                onProgress({ ready: readyIds(), current: null, total: ids.length });
              });
              gpuTail = queued;
              return queued;
            })();
            // Observe failures immediately, including while another CPU scene is being created.
            void work.catch(error => { failure = error; failed = true; });
            pending.push(work);
          }
          await Promise.all(pending);
          return;
        }
        for (const id of ids) {
          live();
          onProgress({ ready: readyIds(), current: id, total: ids.length });
          await prepare(getOrCreate(id), id);
          live();
          ready.add(id);
          onProgress({ ready: readyIds(), current: null, total: ids.length });
        }
      })();
      return preparation;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const resource of resources.values()) resource.dispose();
      resources.clear(); ready.clear();
    },
  };
}
