import { getMapSpec } from '../game/map-catalog.ts';
import { DOWNTOWN_STREETS, explorationGroundHeight, getExplorationLayout } from '../game/exploration-layout.ts';
import type { ExplorationMapId } from '../game/exploration-layout.ts';

const TERRAIN_PALETTES = {
  desert: ['#a78750', '#b09255', '#bca160', '#c8ae6e', '#d3bc83', '#dfcc9d', '#e8d9b6'],
  mountains: ['#324b3b', '#4a6248', '#697959', '#858a6f', '#97988b', '#b9c2bc', '#e0e8e5'],
};

/** A handful of cached SVG paths replace hundreds of terrain rectangles per telemetry update. */
function terrainPaths(id: 'desert' | 'mountains') {
  const bounds = getMapSpec(id).bounds;
  const cells = 32;
  const width = (bounds.maxX - bounds.minX) / cells;
  const depth = (bounds.maxZ - bounds.minZ) / cells;
  const palette = TERRAIN_PALETTES[id];
  const levels = palette.map(color => ({ color, path: '' }));
  for (let row = 0; row < cells; row++) for (let column = 0; column < cells; column++) {
    const x = bounds.minX + column * width, z = bounds.minZ + row * depth;
    const height = explorationGroundHeight(id, x + width / 2, z + depth / 2);
    const scale = id === 'desert' ? 180 : 650;
    const index = Math.max(0, Math.min(palette.length - 1, Math.floor(height / scale * palette.length)));
    levels[index].path += `M${x},${z}h${width + 0.5}v${depth + 0.5}h${-width - 0.5}Z`;
  }
  return levels.filter(level => level.path);
}

export const EXPLORATION_TERRAIN_PATHS = {
  desert: terrainPaths('desert'), downtown: [], mountains: terrainPaths('mountains'),
};

export function explorationFootprints(id: ExplorationMapId) {
  const layout = getExplorationLayout(id);
  return [...layout.buildings, ...layout.rocks].map((solid, index) => ({
    ...solid, key: `${id}-${index}`, color: id === 'downtown' ? '#becacb' : solid.color,
  }));
}

/** The same 32 m streets and crosswalk positions used by the 3D city. */
export const DOWNTOWN_CROSSWALKS = DOWNTOWN_STREETS.flatMap(x => DOWNTOWN_STREETS.flatMap(z =>
  [-1, 1].flatMap(side => Array.from({ length: 13 }, (_, index) => {
    const stripe = -10.8 + index * 1.8;
    return [
      { x: x + stripe, z: z + side * 23, width: 0.9, depth: 6 },
      { x: x + side * 23, z: z + stripe, width: 6, depth: 0.9 },
    ];
  }).flat()),
));
