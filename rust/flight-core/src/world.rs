//! Numeric map queries. Scene-authored geometry is uploaded once; all runtime
//! surface selection, water contours and obstacle broad/narrow phases are native.

use crate::flight::Vec3;
use std::collections::HashMap;

#[derive(Clone, Copy, Debug)]
pub struct RiverSample {
    pub x: f64,
    pub z: f64,
    pub half_width: f64,
}
#[derive(Clone, Copy, Debug)]
pub struct Lake {
    pub x: f64,
    pub z: f64,
    pub radius_x: f64,
    pub radius_z: f64,
    pub rotation: f64,
    pub phase: f64,
}
#[derive(Clone, Copy, Debug)]
pub struct Cabin {
    pub x: f64,
    pub z: f64,
    pub yaw: f64,
    pub width: f64,
    pub depth: f64,
    pub wall_height: f64,
    pub roof_height: f64,
    pub base_y: f64,
}
#[derive(Clone, Copy, Debug)]
pub struct Bridge {
    pub x: f64,
    pub z: f64,
    pub yaw: f64,
    pub length: f64,
    pub width: f64,
    pub span: f64,
    pub ramp_length: f64,
    pub deck_y: f64,
    pub landing_a_y: f64,
    pub landing_b_y: f64,
}
#[derive(Clone, Copy, Debug)]
pub struct Pasture {
    pub x: f64,
    pub z: f64,
    pub radius: f64,
}
#[derive(Clone, Copy, Debug)]
pub struct Obstacle {
    pub x: f64,
    pub z: f64,
    pub radius: f64,
    pub height: f64,
    pub base: f64,
    pub roof: bool,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MapKind {
    Valley,
    Factory,
    Harbor,
}
/// A solid scene-authored cuboid. Dimensions and base are world-space metres;
/// yaw follows Three.js's positive rotation around Y.
#[derive(Clone, Copy, Debug)]
pub struct UrbanBox {
    pub x: f64,
    pub z: f64,
    pub width: f64,
    pub depth: f64,
    pub base: f64,
    pub height: f64,
    pub yaw: f64,
}

impl UrbanBox {
    fn local_position(self, x: f64, z: f64) -> (f64, f64) {
        let dx = x - self.x;
        let dz = z - self.z;
        (
            dx * self.yaw.cos() - dz * self.yaw.sin(),
            dx * self.yaw.sin() + dz * self.yaw.cos(),
        )
    }
    fn contains(self, x: f64, z: f64) -> bool {
        let (x, z) = self.local_position(x, z);
        x.abs() <= self.width / 2.0 && z.abs() <= self.depth / 2.0
    }
    fn distance(self, x: f64, z: f64) -> f64 {
        let (x, z) = self.local_position(x, z);
        (x.abs() - self.width / 2.0)
            .max(0.0)
            .hypot((z.abs() - self.depth / 2.0).max(0.0))
    }
    fn top(self) -> f64 {
        self.base + self.height
    }
}

pub const HARBOR_SHORE_X: f64 = 140.0;
/// East edge, minimum Z, maximum Z. These land piers touch the west shoreline.
pub const HARBOR_PIERS: [(f64, f64, f64); 3] = [
    (380.0, -155.0, -85.0),
    (430.0, -465.0, -395.0),
    (350.0, -785.0, -715.0),
];

/// A shoreline-connected, axis-aligned land rectangle supplied by the scene.
#[derive(Clone, Copy, Debug)]
struct HarborLand {
    east: f64,
    min_z: f64,
    max_z: f64,
    top: f64,
}

pub const MAX_HARBOR_LAND_REGIONS: usize = 1024;

fn segment_distance(x: f64, z: f64, ax: f64, az: f64, bx: f64, bz: f64) -> f64 {
    let dx = bx - ax;
    let dz = bz - az;
    let t = (((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)).clamp(0.0, 1.0);
    (x - ax - t * dx).hypot(z - az - t * dz)
}

/// Signed distance to the actual shore/pier union boundary. Buried pier west
/// edges never count as coastline, including at the connection to the shore.
fn harbor_water_distance(x: f64, z: f64, shore_x: f64, lands: &[HarborLand]) -> f64 {
    let dry = x <= shore_x
        || lands
            .iter()
            .any(|land| x <= land.east && z >= land.min_z && z <= land.max_z);
    let shoreline_z = lands
        .iter()
        .find(|land| z > land.min_z && z < land.max_z)
        .map_or(z, |land| {
            if z - land.min_z < land.max_z - z {
                land.min_z
            } else {
                land.max_z
            }
        });
    let mut distance = (x - shore_x).hypot(z - shoreline_z);
    for land in lands {
        let HarborLand {
            east, min_z, max_z, ..
        } = *land;
        for (ax, az, bx, bz) in [
            (shore_x, min_z, east, min_z),
            (east, min_z, east, max_z),
            (east, max_z, shore_x, max_z),
        ] {
            distance = distance.min(segment_distance(x, z, ax, az, bx, bz));
        }
    }
    if dry { distance } else { -distance }
}
#[derive(Clone, Copy, Debug)]
struct Segment {
    ax: f64,
    az: f64,
    bx: f64,
    bz: f64,
    length_squared: f64,
    width_a: f64,
    width_b: f64,
}
#[derive(Debug)]
struct RiverNode {
    min_x: f64,
    max_x: f64,
    min_z: f64,
    max_z: f64,
    max_width: f64,
    segments: Vec<Segment>,
    children: Option<(Box<RiverNode>, Box<RiverNode>)>,
}

impl RiverNode {
    fn build(mut segments: Vec<Segment>) -> Self {
        let mut node = Self {
            min_x: f64::INFINITY,
            max_x: f64::NEG_INFINITY,
            min_z: f64::INFINITY,
            max_z: f64::NEG_INFINITY,
            max_width: 0.0,
            segments: Vec::new(),
            children: None,
        };
        for s in &segments {
            node.min_x = node.min_x.min(s.ax).min(s.bx);
            node.max_x = node.max_x.max(s.ax).max(s.bx);
            node.min_z = node.min_z.min(s.az).min(s.bz);
            node.max_z = node.max_z.max(s.az).max(s.bz);
            node.max_width = node.max_width.max(s.width_a).max(s.width_b);
        }
        if segments.len() <= 8 {
            node.segments = segments;
        } else {
            let sort_x = node.max_x - node.min_x > node.max_z - node.min_z;
            segments.sort_by(|a, b| {
                let av = if sort_x { a.ax + a.bx } else { a.az + a.bz };
                let bv = if sort_x { b.ax + b.bx } else { b.az + b.bz };
                av.total_cmp(&bv)
            });
            let right = segments.split_off(segments.len() / 2);
            node.children = Some((
                Box::new(Self::build(segments)),
                Box::new(Self::build(right)),
            ));
        }
        node
    }
    fn lower_bound(&self, x: f64, z: f64) -> f64 {
        (self.min_x - x)
            .max(0.0)
            .max(x - self.max_x)
            .hypot((self.min_z - z).max(0.0).max(z - self.max_z))
            - self.max_width
    }
    fn search(&self, x: f64, z: f64, best: &mut f64) {
        if self.lower_bound(x, z) >= *best {
            return;
        }
        for s in &self.segments {
            let t = (((x - s.ax) * (s.bx - s.ax) + (z - s.az) * (s.bz - s.az)) / s.length_squared)
                .clamp(0.0, 1.0);
            let distance = (x - s.ax - t * (s.bx - s.ax)).hypot(z - s.az - t * (s.bz - s.az))
                - (s.width_a + t * (s.width_b - s.width_a));
            *best = best.min(distance);
        }
        if let Some((left, right)) = &self.children {
            if left.lower_bound(x, z) < right.lower_bound(x, z) {
                left.search(x, z, best);
                right.search(x, z, best);
            } else {
                right.search(x, z, best);
                left.search(x, z, best);
            }
        }
    }
}

fn smoothstep(start: f64, end: f64, value: f64) -> f64 {
    let t = ((value - start) / (end - start)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
fn gaussian(x: f64, z: f64, cx: f64, cz: f64, rx: f64, rz: f64) -> f64 {
    (-(((x - cx) / rx).powi(2) + ((z - cz) / rz).powi(2))).exp()
}

#[derive(Debug)]
pub struct World {
    pub water_level: f64,
    pub lakes: Vec<Lake>,
    pub cabins: Vec<Cabin>,
    pub bridges: Vec<Bridge>,
    pub pastures: Vec<Pasture>,
    pub map_kind: MapKind,
    river: RiverNode,
    obstacles: Vec<Obstacle>,
    obstacle_tops: Vec<f64>,
    grid: HashMap<(i32, i32), Vec<usize>>,
    boxes: Vec<UrbanBox>,
    box_grid: HashMap<(i32, i32), Vec<usize>>,
    harbor_shore_x: f64,
    harbor_lands: Vec<HarborLand>,
}

impl World {
    pub fn new(
        water_level: f64,
        samples: Vec<RiverSample>,
        lakes: Vec<Lake>,
        cabins: Vec<Cabin>,
        bridges: Vec<Bridge>,
        pastures: Vec<Pasture>,
    ) -> Self {
        let segments = samples
            .windows(2)
            .map(|p| Segment {
                ax: p[0].x,
                az: p[0].z,
                bx: p[1].x,
                bz: p[1].z,
                length_squared: (p[1].x - p[0].x).powi(2) + (p[1].z - p[0].z).powi(2),
                width_a: p[0].half_width,
                width_b: p[1].half_width,
            })
            .filter(|s| s.length_squared > 0.0)
            .collect();
        Self {
            water_level,
            lakes,
            cabins,
            bridges,
            pastures,
            map_kind: MapKind::Valley,
            river: RiverNode::build(segments),
            obstacles: Vec::new(),
            obstacle_tops: Vec::new(),
            grid: HashMap::new(),
            boxes: Vec::new(),
            box_grid: HashMap::new(),
            harbor_shore_x: HARBOR_SHORE_X,
            // Legacy native callers retain the original harbor; production uploads its scene layout.
            harbor_lands: HARBOR_PIERS
                .iter()
                .map(|&(east, min_z, max_z)| HarborLand {
                    east,
                    min_z,
                    max_z,
                    top: 2.0,
                })
                .collect(),
        }
    }
    pub fn set_map_kind(&mut self, kind: u32) -> bool {
        self.map_kind = match kind {
            0 => MapKind::Valley,
            1 => MapKind::Factory,
            2 => MapKind::Harbor,
            _ => return false,
        };
        true
    }

    /// Header shore_x,count; rows east,min_z,max_z,top. Validation is atomic:
    /// invalid geometry never replaces a live world's previous coastline.
    /// Regions must connect to the shoreline and have strictly disjoint Z intervals.
    pub fn configure_harbor(&mut self, packet: &[f64]) -> bool {
        if packet.len() < 2
            || !packet.iter().all(|value| value.is_finite())
            || packet[0].abs() > 100_000.0
            || packet[1] < 0.0
            || packet[1].fract() != 0.0
            || packet[1] > MAX_HARBOR_LAND_REGIONS as f64
        {
            return false;
        }
        let shore_x = packet[0];
        let count = packet[1] as usize;
        if packet.len() != 2 + count * 4 {
            return false;
        }
        let mut lands = Vec::with_capacity(count);
        for values in packet[2..].chunks_exact(4) {
            let [east, min_z, max_z, top] = [values[0], values[1], values[2], values[3]];
            if east <= shore_x
                || east - shore_x > 10_000.0
                || east.abs() > 100_000.0
                || min_z >= max_z
                || max_z - min_z > 10_000.0
                || min_z.abs() > 100_000.0
                || max_z.abs() > 100_000.0
                || !(2.0..=1000.0).contains(&top)
            {
                return false;
            }
            lands.push(HarborLand {
                east,
                min_z,
                max_z,
                top,
            });
        }
        lands.sort_by(|a, b| a.min_z.total_cmp(&b.min_z));
        if lands.windows(2).any(|pair| pair[0].max_z >= pair[1].min_z) {
            return false;
        }
        self.harbor_shore_x = shore_x;
        self.harbor_lands = lands;
        true
    }
    /// Header: water level, river/lake/cabin/bridge/pasture counts, then rows of
    /// 3/6/8/10/3 f64 values in that order. Counts and geometry must be finite.
    pub fn from_packet(packet: &[f64]) -> Option<Self> {
        if packet.len() < 6 || !packet.iter().all(|v| v.is_finite()) {
            return None;
        }
        let mut counts = [0usize; 5];
        for (i, count) in counts.iter_mut().enumerate() {
            let v = packet[i + 1];
            if v < 0.0 || v.fract() != 0.0 || v > 100_000.0 {
                return None;
            }
            *count = v as usize;
        }
        let expected = 6 + counts
            .iter()
            .zip([3, 6, 8, 10, 3])
            .map(|(n, stride)| n * stride)
            .sum::<usize>();
        if packet.len() != expected || counts[0] < 2 {
            return None;
        }
        let mut offset = 6;
        let mut rows = |count: usize, stride: usize| {
            let start = offset;
            offset += count * stride;
            packet[start..offset].chunks_exact(stride)
        };
        let samples = rows(counts[0], 3)
            .map(|v| RiverSample {
                x: v[0],
                z: v[1],
                half_width: v[2],
            })
            .collect::<Vec<_>>();
        let lakes = rows(counts[1], 6)
            .map(|v| Lake {
                x: v[0],
                z: v[1],
                radius_x: v[2],
                radius_z: v[3],
                rotation: v[4],
                phase: v[5],
            })
            .collect::<Vec<_>>();
        let cabins = rows(counts[2], 8)
            .map(|v| Cabin {
                x: v[0],
                z: v[1],
                yaw: v[2],
                width: v[3],
                depth: v[4],
                wall_height: v[5],
                roof_height: v[6],
                base_y: v[7],
            })
            .collect::<Vec<_>>();
        let bridges = rows(counts[3], 10)
            .map(|v| Bridge {
                x: v[0],
                z: v[1],
                yaw: v[2],
                length: v[3],
                width: v[4],
                span: v[5],
                ramp_length: v[6],
                deck_y: v[7],
                landing_a_y: v[8],
                landing_b_y: v[9],
            })
            .collect::<Vec<_>>();
        let pastures = rows(counts[4], 3)
            .map(|v| Pasture {
                x: v[0],
                z: v[1],
                radius: v[2],
            })
            .collect::<Vec<_>>();
        if samples.iter().any(|s| s.half_width < 0.0)
            || lakes.iter().any(|l| l.radius_x <= 0.0 || l.radius_z <= 0.0)
            || cabins.iter().any(|c| c.width <= 0.0 || c.depth <= 0.0)
            || bridges
                .iter()
                .any(|b| b.length <= 0.0 || b.width <= 0.0 || b.ramp_length <= 0.0)
        {
            return None;
        }
        Some(Self::new(
            packet[0], samples, lakes, cabins, bridges, pastures,
        ))
    }
    fn lake_distance(&self, lake: Lake, x: f64, z: f64) -> f64 {
        let dx = x - lake.x;
        let dz = z - lake.z;
        let cosine = lake.rotation.cos();
        let sine = lake.rotation.sin();
        let u = (dx * cosine + dz * sine) / lake.radius_x;
        let v = (-dx * sine + dz * cosine) / lake.radius_z;
        let angle = v.atan2(u);
        let normalized_radius = u.hypot(v);
        let angular_blend = smoothstep(0.15, 0.65, normalized_radius);
        let lake_shape = 1.0
            + 0.075 * (angle * 3.0 + lake.phase).sin()
            + 0.045 * (angle * 5.0 - lake.phase * 0.3).cos()
            + 0.025 * (angle * 8.0 + 0.4).sin();
        let shape = 1.0 + (lake_shape - 1.0) * angular_blend;
        let min_radius = lake.radius_x.min(lake.radius_z);
        let radial_scale = min_radius
            + ((lake.radius_x * angle.cos()).hypot(lake.radius_z * angle.sin()) - min_radius)
                * angular_blend;
        (normalized_radius - shape) * radial_scale
    }
    pub fn water_distance(&self, x: f64, z: f64) -> f64 {
        match self.map_kind {
            MapKind::Factory => return f64::INFINITY,
            MapKind::Harbor => {
                return harbor_water_distance(x, z, self.harbor_shore_x, &self.harbor_lands);
            }
            MapKind::Valley => {}
        }
        let mut best = f64::INFINITY;
        self.river.search(x, z, &mut best);
        for lake in &self.lakes {
            best = best.min(self.lake_distance(*lake, x, z));
        }
        best
    }
    pub fn is_water(&self, x: f64, z: f64) -> bool {
        self.water_distance(x, z) < 0.0
    }
    pub fn ground_height(&self, x: f64, z: f64) -> f64 {
        match self.map_kind {
            MapKind::Factory => return 2.0,
            MapKind::Harbor => {
                let distance = self.water_distance(x, z);
                return if distance >= 0.0 {
                    self.harbor_lands
                        .iter()
                        .find(|land| {
                            x >= self.harbor_shore_x
                                && x <= land.east
                                && z >= land.min_z
                                && z <= land.max_z
                        })
                        .map_or(2.0, |land| land.top)
                } else {
                    self.water_level - 16.0 * smoothstep(0.0, 110.0, -distance)
                };
            }
            MapKind::Valley => {}
        }
        let warped_x = x + (z * 0.0028).sin() * 90.0;
        let warped_z = z + (x * 0.0031).sin() * 70.0;
        let rolling = 22.0
            + (x * 0.0031 + (z * 0.0024).sin()).sin() * 10.0
            + (z * 0.0046 - x * 0.0018).sin() * 6.0
            + ((x + z) * 0.009).sin() * 2.0;
        let ridges = gaussian(warped_x, warped_z, -1250.0, -1530.0, 620.0, 700.0) * 210.0
            + gaussian(warped_x, warped_z, 1250.0, -850.0, 580.0, 900.0) * 245.0
            + gaussian(warped_x, warped_z, -1050.0, 550.0, 650.0, 550.0) * 170.0
            + gaussian(warped_x, warped_z, 700.0, -2350.0, 650.0, 500.0) * 190.0;
        let low_valley =
            1.1 + (x * 0.012).sin() * (z * 0.01).cos() * 0.65 + ((x + z) * 0.015).sin() * 0.45;
        let valley_distance = ((x - 10.0) / 310.0).hypot((z + 210.0) / 420.0);
        let valley_blend = smoothstep(0.7, 1.55, valley_distance);
        let dry_terrain = low_valley + (rolling + ridges - low_valley) * valley_blend;
        let distance = self.water_distance(x, z);
        if distance < 0.0 {
            let inland = -distance;
            let depth = (0.9 * smoothstep(0.0, 8.0, inland)
                + 0.035 * inland * smoothstep(0.0, 40.0, inland))
            .min(18.0);
            return self.water_level - depth;
        }
        self.water_level
            + ((self.water_level + 0.02).max(dry_terrain) - self.water_level)
                * smoothstep(0.0, 80.0, distance)
    }
    fn terrain_surface_height(&self, x: f64, z: f64) -> f64 {
        let ground = self.ground_height(x, z);
        if ground < self.water_level && self.is_water(x, z) {
            self.water_level
        } else {
            ground
        }
    }
    pub fn surface_height(&self, x: f64, z: f64) -> f64 {
        self.box_surface_height(x, z, f64::INFINITY).map_or_else(
            || self.terrain_surface_height(x, z),
            |height| height.max(self.terrain_surface_height(x, z)),
        )
    }
    pub fn rural_surface_height(&self, x: f64, z: f64) -> Option<f64> {
        if self.map_kind != MapKind::Valley {
            return None;
        }
        let mut height = None;
        for b in &self.bridges {
            let dx = x - b.x;
            let dz = z - b.z;
            let local_x = dx * b.yaw.cos() - dz * b.yaw.sin();
            let local_z = dx * b.yaw.sin() + dz * b.yaw.cos();
            if local_x.abs() <= b.length / 2.0 && local_z.abs() <= b.width / 2.0 {
                let excess = (local_x.abs() - b.span / 2.0).max(0.0);
                let landing = if local_x < 0.0 {
                    b.landing_a_y
                } else {
                    b.landing_b_y
                };
                height = Some(b.deck_y + (landing - b.deck_y) * (excess / b.ramp_length).min(1.0));
                break;
            }
        }
        for c in &self.cabins {
            let dx = x - c.x;
            let dz = z - c.z;
            let local_x = dx * c.yaw.cos() - dz * c.yaw.sin();
            let local_z = dx * c.yaw.sin() + dz * c.yaw.cos();
            if local_x.abs() <= c.width / 2.0 + 0.42 && local_z.abs() <= c.depth / 2.0 + 0.45 {
                let roof = c.base_y + c.wall_height + c.roof_height
                    - local_x.abs() * c.roof_height / (c.width / 2.0)
                    + 0.08;
                height = Some(height.map_or(roof, |h: f64| h.max(roof)));
            }
        }
        height
    }
    pub fn flight_surface_height(&self, x: f64, z: f64, from_y: f64) -> f64 {
        let terrain = self.terrain_surface_height(x, z);
        let rural = match self.rural_surface_height(x, z) {
            Some(structure) if from_y >= structure - 0.05 => terrain.max(structure),
            _ => terrain,
        };
        self.box_surface_height(x, z, from_y)
            .map_or(rural, |height| rural.max(height))
    }
    pub fn clearance(&self, x: f64, z: f64, padding: f64) -> bool {
        if self
            .boxes
            .iter()
            .any(|b| b.distance(x, z) <= padding.max(0.0))
        {
            return false;
        }
        if self.map_kind != MapKind::Valley {
            return true;
        }
        for c in &self.cabins {
            let dx = x - c.x;
            let dz = z - c.z;
            let lx = dx * c.yaw.cos() - dz * c.yaw.sin();
            let lz = dx * c.yaw.sin() + dz * c.yaw.cos();
            if lx.abs() < c.width / 2.0 + 4.0 + padding && lz.abs() < c.depth / 2.0 + 4.0 + padding
            {
                return false;
            }
        }
        for p in &self.pastures {
            if (x - p.x).hypot(z - p.z) < p.radius + 3.0 + padding {
                return false;
            }
        }
        for b in &self.bridges {
            let dx = x - b.x;
            let dz = z - b.z;
            let lx = dx * b.yaw.cos() - dz * b.yaw.sin();
            let lz = dx * b.yaw.sin() + dz * b.yaw.cos();
            if lx.abs() < b.length / 2.0 + 4.0 + padding && lz.abs() < b.width / 2.0 + 3.0 + padding
            {
                return false;
            }
        }
        true
    }
    /// Replacing scene boxes rebuilds a small static spatial index. Runtime
    /// collision and roof queries allocate nothing, even for stacked cargo.
    pub fn set_boxes(&mut self, boxes: Vec<UrbanBox>) {
        self.box_grid.clear();
        for (index, b) in boxes.iter().enumerate() {
            let cosine = b.yaw.cos().abs();
            let sine = b.yaw.sin().abs();
            let extent_x = b.width / 2.0 * cosine + b.depth / 2.0 * sine + 0.55;
            let extent_z = b.width / 2.0 * sine + b.depth / 2.0 * cosine + 0.55;
            for x in
                ((b.x - extent_x) / 64.0).floor() as i32..=((b.x + extent_x) / 64.0).floor() as i32
            {
                for z in ((b.z - extent_z) / 64.0).floor() as i32
                    ..=((b.z + extent_z) / 64.0).floor() as i32
                {
                    self.box_grid.entry((x, z)).or_default().push(index);
                }
            }
        }
        self.boxes = boxes;
    }
    fn nearby_boxes(&self, x: f64, z: f64) -> &[usize] {
        self.box_grid
            .get(&((x / 64.0).floor() as i32, (z / 64.0).floor() as i32))
            .map_or(&[], Vec::as_slice)
    }
    fn box_surface_height(&self, x: f64, z: f64, from_y: f64) -> Option<f64> {
        let mut height: Option<f64> = None;
        for &index in self.nearby_boxes(x, z) {
            let b = self.boxes[index];
            let top = b.top();
            if b.contains(x, z) && from_y >= top - 0.05 {
                height = Some(height.map_or(top, |height| height.max(top)));
            }
        }
        height
    }
    pub fn set_obstacles(&mut self, obstacles: Vec<Obstacle>) {
        self.obstacle_tops = obstacles
            .iter()
            .map(|o| self.ground_height(o.x, o.z) + o.height)
            .collect();
        self.grid.clear();
        for (index, o) in obstacles.iter().enumerate() {
            let radius = o.radius + 0.55;
            for x in ((o.x - radius) / 64.0).floor() as i32..=((o.x + radius) / 64.0).floor() as i32
            {
                for z in
                    ((o.z - radius) / 64.0).floor() as i32..=((o.z + radius) / 64.0).floor() as i32
                {
                    self.grid.entry((x, z)).or_default().push(index);
                }
            }
        }
        self.obstacles = obstacles;
    }
    pub fn intersects_obstacle(&self, position: Vec3) -> bool {
        if self
            .nearby_boxes(position.x, position.z)
            .iter()
            .any(|&index| {
                let b = self.boxes[index];
                b.distance(position.x, position.z) < 0.55
                    && position.y < b.top() + 0.45
                    && position.y > b.base - 0.45
            })
        {
            return true;
        }
        let Some(nearby) = self.grid.get(&(
            ((position.x / 64.0).floor() as i32),
            ((position.z / 64.0).floor() as i32),
        )) else {
            return false;
        };
        nearby.iter().any(|&index| {
            let o = self.obstacles[index];
            if (position.x - o.x).hypot(position.z - o.z) >= o.radius + 0.55 {
                return false;
            }
            let top = if o.roof {
                self.rural_surface_height(position.x, position.z)
            } else {
                Some(self.obstacle_tops[index])
            };
            top.is_some_and(|top| position.y < top + 0.45 && position.y > o.base - 0.45)
        })
    }
}
