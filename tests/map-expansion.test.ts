import assert from 'node:assert/strict';
import test from 'node:test';
import { getMapSpec } from '../src/game/map-catalog.ts';
import { getMapLayout, HARBOR_BREAKWATERS, HARBOR_PIERS, HARBOR_SHORE_X } from '../src/game/map-layout.ts';
import type { UrbanBox } from '../src/game/map-layout.ts';

function corners(box: UrbanBox): [number, number][] {
  const yaw = box.yaw ?? 0, c = Math.cos(yaw), s = Math.sin(yaw);
  return [-1, 1].flatMap(side => [-1, 1].map(end => {
    const x = side * box.width / 2, z = end * box.depth / 2;
    return [box.x + x * c + z * s, box.z - x * s + z * c] as [number, number];
  }));
}

function intersects(a: UrbanBox, b: UrbanBox): boolean {
  return Math.abs(a.x - b.x) < (a.width + b.width) / 2
    && Math.abs(a.z - b.z) < (a.depth + b.depth) / 2;
}

for (const mapId of ['factory', 'harbor'] as const) {
  test(`${mapId} keeps all rendered collision geometry inside the expanded flying envelope`, () => {
    const bounds = getMapSpec(mapId).bounds;
    const layout = getMapLayout(mapId);
    for (const box of layout.boxes) {
      assert.ok(box.width > 0 && box.depth > 0 && box.height > 0);
      for (const [x, z] of corners(box)) {
        assert.ok(x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ,
          `solid at ${box.x}/${box.z} extends outside the flying envelope`);
      }
      assert.ok(box.base + box.height < bounds.maxAltitude);
    }
    assert.ok(layout.containers.length < 3000, 'cargo stays within the expanded-map rendering budget');
    assert.ok(layout.containers.every(box => box.width === 2.44 && box.depth === 12.2 && box.height === 2.6),
      'ISO cargo retains its real dimensions throughout the larger map');
    assert.ok(layout.warehouses.every(building => building.width <= 200 && building.depth <= 240),
      'map size comes from more districts rather than oversized warehouse models');
  });
}

test('factory expansion adds occupied industrial districts in every distant quadrant', () => {
  const layout = getMapLayout('factory');
  assert.ok(layout.warehouses.length >= 40);
  for (const [west, north] of [[true, true], [false, true], [true, false], [false, false]]) {
    const district = layout.warehouses.filter(building => (west ? building.x < -1800 : building.x > 1800)
      && (north ? building.z < -2000 : building.z > 1500));
    assert.ok(district.length >= 2, 'the outer map contains multiple full-size buildings per district');
    assert.ok(layout.trucks.some(truck => district.some(building => Math.hypot(truck.x - building.x, truck.z - building.z) < 250)));
    assert.ok(layout.containers.some(container => district.some(building => Math.hypot(container.x - building.x, container.z - building.z) < 250)));
  }
  assert.ok(layout.tanks.some(tank => tank.z < -3000) && layout.tanks.some(tank => tank.z > 2000));
  assert.ok(layout.chimneys.some(chimney => chimney.z < -3000) && layout.chimneys.some(chimney => chimney.z > 2000));
  assert.ok(layout.pipes.some(pipe => pipe.from[2] < -3000) && layout.pipes.some(pipe => pipe.from[2] > 2000));
});

test('harbor districts extend the shore and keep ground cargo on supported land', () => {
  const layout = getMapLayout('harbor');
  assert.ok(layout.warehouses.length >= 18);
  assert.ok(layout.warehouses.some(building => building.x < -2500 && building.z < -3000));
  assert.ok(layout.warehouses.some(building => building.x < -2500 && building.z > 2000));
  assert.ok(HARBOR_PIERS.length >= 9);
  assert.ok(HARBOR_PIERS.some(pier => pier.z < -3500) && HARBOR_PIERS.some(pier => pier.z > 2200));
  for (const support of [...HARBOR_PIERS, ...HARBOR_BREAKWATERS]) {
    assert.equal(support.x - support.width / 2, HARBOR_SHORE_X, 'every concrete waterfront structure joins the shore exactly');
    assert.equal(layout.boxes.filter(box => box === support).length, 1, 'shared concrete geometry is not duplicated');
  }
  for (const container of layout.containers.filter(cargo => cargo.base === 2)) for (const [x, z] of corners(container)) {
    assert.ok(x <= HARBOR_SHORE_X || HARBOR_PIERS.some(pier => Math.abs(x - pier.x) <= pier.width / 2
      && Math.abs(z - pier.z) <= pier.depth / 2), `ground cargo at ${container.x}/${container.z} floats over water`);
  }
});

test('every cargo ship has a clear berth, solid hull, supported cargo and moorings on its pier', () => {
  const layout = getMapLayout('harbor');
  assert.ok(layout.ships.length >= 4);
  assert.equal(layout.ship, layout.ships[0], 'existing references still identify the original training ship');
  assert.equal(new Set(layout.ships.map(ship => ship.id)).size, layout.ships.length);
  for (const ship of layout.ships) {
    const hull = { x: ship.x, z: ship.z, width: ship.width, depth: ship.length, base: -8, height: ship.deckY + 8 };
    assert.ok([...HARBOR_PIERS, ...HARBOR_BREAKWATERS].every(pier => !intersects(hull, pier)), `${ship.name} passes through a dock`);
    assert.ok(layout.ships.filter(other => other !== ship).every(other => !intersects(hull,
      { x: other.x, z: other.z, width: other.width, depth: other.length, base: -8, height: 1 })), `${ship.name} overlaps another vessel`);
    assert.ok(layout.boxes.some(box => box.x === ship.x && box.z === ship.z && box.base === -8
      && box.width === ship.width && Math.abs(box.base + box.height - ship.deckY) < 1e-8), `${ship.name} has no matching deck collider`);
    const cargo = layout.containers.filter(container => container.base >= ship.deckY
      && Math.abs(container.x - ship.x) < ship.width / 2 && Math.abs(container.z - ship.z) < ship.length / 2);
    assert.ok(cargo.length >= 50, `${ship.name} carries modeled cargo`);
    for (const container of cargo) for (const [x, z] of corners(container)) {
      assert.ok(Math.abs(x - ship.x) <= ship.width / 2 && Math.abs(z - ship.z) <= (ship.length - 34) / 2);
    }
    for (const z of [ship.mooringZ - ship.mooringSpan / 2 + 5, ship.mooringZ + ship.mooringSpan / 2 - 5]) {
      assert.ok(HARBOR_PIERS.some(pier => Math.abs(ship.mooringX - pier.x) < pier.width / 2
        && Math.abs(z - pier.z) < pier.depth / 2), `${ship.name} mooring attaches over open water`);
    }
    assert.ok(layout.landmarks.some(mark => mark.kind === 'ship' && mark.x === ship.x && mark.z === ship.z
      && mark.label.includes(ship.name)));
  }
});
