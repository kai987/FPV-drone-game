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
) {
  const resources = new Map<Id, Resource>();
  const ready = new Set<Id>();
  let disposed = false;
  let preparation: Promise<void> | null = null;
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
    get readyIds(): readonly Id[] { return [...ready]; },
    forEach(visit: (resource: Resource) => void) { live(); resources.forEach(visit); },
    preload(onProgress: (progress: MapLoadProgress<Id>) => void = () => {}) {
      live();
      preparation ??= (async () => {
        for (const id of ids) {
          live();
          onProgress({ ready: [...ready], current: id, total: ids.length });
          await prepare(getOrCreate(id), id);
          live();
          ready.add(id);
          onProgress({ ready: [...ready], current: null, total: ids.length });
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
