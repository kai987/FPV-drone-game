import { abortableResource, createAssetCache } from './asset-cache.ts';

export type PanoramaResolution = 3548 | 7096;
export type WorldAsset = 'alpine-panorama-hd.webp' | 'alpine-panorama-mobile.webp'
  | 'pine-tree.webp' | 'grass-texture.webp' | 'weathered-rock.webp';

export function worldAssetNames(resolution: PanoramaResolution): WorldAsset[] {
  return [resolution === 7096 ? 'alpine-panorama-hd.webp' : 'alpine-panorama-mobile.webp',
    'pine-tree.webp', 'grass-texture.webp', 'weathered-rock.webp'];
}

const images = createAssetCache<WorldAsset, HTMLImageElement>(asset => new Promise((resolve, reject) => {
  const image = new Image();
  image.decoding = 'async';
  image.onload = () => {
    image.onload = image.onerror = null;
    // This is the exact decoded Image later assigned to Texture.image, avoiding a second decoder.
    void image.decode().then(() => resolve(image), () => reject(new Error(`地图纹理加载失败：${asset}`)));
  };
  image.onerror = () => {
    image.onload = image.onerror = null;
    reject(new Error(`地图纹理加载失败：${asset}`));
  };
  image.src = `${import.meta.env.BASE_URL}assets/${asset}`;
}));

export function preloadWorldAssets(resolution: PanoramaResolution) {
  const abort = new AbortController();
  const resources = new Map(worldAssetNames(resolution).map(asset => {
    const resource = abortableResource(images.load(asset), abort.signal);
    void resource.catch(() => {});
    return [asset, resource] as const;
  }));
  const ready = Promise.all(resources.values()).then(() => {});
  void ready.catch(() => {});
  return {
    ready,
    image(asset: WorldAsset) {
      const image = resources.get(asset);
      if (!image) throw new Error(`Unselected world texture: ${asset}`);
      return image;
    },
    dispose() { abort.abort(); },
  };
}

export type WorldAssets = ReturnType<typeof preloadWorldAssets>;
