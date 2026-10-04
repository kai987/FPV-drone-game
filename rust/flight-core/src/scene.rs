//! Batched CPU scene data; Three.js retains geometry ownership and GPU shaders.
use crate::world::World;
use std::f64::consts::TAU;

#[derive(Clone, Copy)]
pub struct Point {
    pub x: f64,
    pub z: f64,
}
#[derive(Clone, Copy)]
pub struct RiverPoint {
    pub point: Point,
    pub width: f64,
}
pub struct LakeEdge {
    pub center: Point,
    pub radius_x: f64,
    pub radius_z: f64,
    pub rotation: f64,
    pub boundary: Vec<Point>,
}
pub struct SceneConfig {
    pub seed: u32,
    pub skip: usize,
    pub bounds: [f64; 4],
    pub course: Vec<Point>,
    pub targets: Vec<(Point, f64)>,
    pub river: Vec<RiverPoint>,
    pub lakes: Vec<LakeEdge>,
}
pub struct Placements {
    pub trees: Vec<f64>,
    pub rocks: Vec<f64>,
    pub banks: Vec<f64>,
    pub shrubs: Vec<f64>,
}
struct Random(u32);
impl Random {
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_mul(1664525).wrapping_add(1013904223);
        f64::from(self.0) / 4294967296.0
    }
}
fn smooth(a: f64, b: f64, v: f64) -> f64 {
    let t = ((v - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
fn segment_distance(p: Point, a: Point, b: Point) -> f64 {
    let dx = b.x - a.x;
    let dz = b.z - a.z;
    let t = (((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)).clamp(0.0, 1.0);
    (p.x - a.x - t * dx).hypot(p.z - a.z - t * dz)
}
impl SceneConfig {
    fn inside(&self, p: Point, m: f64) -> bool {
        p.x > self.bounds[0] + m
            && p.x < self.bounds[1] - m
            && p.z > self.bounds[2] + m
            && p.z < self.bounds[3] - m
    }
    fn course_distance(&self, p: Point) -> f64 {
        if p.x.abs() > 245.0 || p.z < -560.0 || p.z > 130.0 {
            return f64::INFINITY;
        }
        let mut distance =
            segment_distance(p, Point { x: 0.0, z: 75.0 }, Point { x: 0.0, z: -140.0 });
        for pair in self.course.windows(2) {
            distance = distance.min(segment_distance(p, pair[0], pair[1]));
        }
        distance
    }
    fn target_clear(&self, p: Point, padding: f64) -> bool {
        self.targets
            .iter()
            .all(|(t, r)| (p.x - t.x).hypot(p.z - t.z) > r + padding)
    }
    fn bank(&self, random: &mut Random, margin: f64) -> Point {
        if random.next() < 0.64 {
            let index = (random.next() * self.river.len() as f64).floor() as usize;
            let p = self.river[index];
            let a = self.river[index.saturating_sub(1)];
            let b = self.river[(index + 1).min(self.river.len() - 1)];
            let dx = b.point.x - a.point.x;
            let dz = b.point.z - a.point.z;
            let length = dx.hypot(dz).max(f64::MIN_POSITIVE);
            let side = if random.next() < 0.5 { -1.0 } else { 1.0 };
            Point {
                x: p.point.x - dz / length * (p.width + margin) * side,
                z: p.point.z + dx / length * (p.width + margin) * side,
            }
        } else {
            let edge = &self.lakes[(random.next() * self.lakes.len() as f64).floor() as usize];
            let p = edge.boundary[(random.next() * edge.boundary.len() as f64).floor() as usize];
            let dx = p.x - edge.center.x;
            let dz = p.z - edge.center.z;
            let length = dx.hypot(dz).max(f64::MIN_POSITIVE);
            Point {
                x: p.x + dx / length * margin,
                z: p.z + dz / length * margin,
            }
        }
    }
    pub fn generate(&self, world: &World) -> Placements {
        let mut random = Random(self.seed);
        for _ in 0..self.skip {
            random.next();
        }
        let mut clusters = vec![
            (
                Point {
                    x: -280.0,
                    z: -150.0,
                },
                185.0,
            ),
            (
                Point {
                    x: 315.0,
                    z: -335.0,
                },
                210.0,
            ),
            (
                Point {
                    x: -420.0,
                    z: 285.0,
                },
                240.0,
            ),
        ];
        for _ in 0..31 {
            clusters.push((
                Point {
                    x: self.bounds[0]
                        + 140.0
                        + random.next() * (self.bounds[1] - self.bounds[0] - 280.0),
                    z: self.bounds[2]
                        + 140.0
                        + random.next() * (self.bounds[3] - self.bounds[2] - 280.0),
                },
                130.0 + random.next() * 185.0,
            ));
        }
        let mut result = Placements {
            trees: Vec::with_capacity(5200 * 7),
            rocks: Vec::with_capacity(1150 * 12),
            banks: Vec::with_capacity(720 * 12),
            shrubs: Vec::with_capacity(420 * 5),
        };
        for _ in 0..27000 {
            if result.trees.len() >= 5200 * 7 {
                break;
            }
            let clustered = random.next() < 0.8;
            let (cluster, r) = clusters[(random.next() * clusters.len() as f64).floor() as usize];
            let angle = random.next() * TAU;
            let radius = random.next().sqrt() * r;
            let p = Point {
                x: if clustered {
                    cluster.x + angle.cos() * radius
                } else {
                    self.bounds[0] + random.next() * (self.bounds[1] - self.bounds[0])
                },
                z: if clustered {
                    cluster.z + angle.sin() * radius
                } else {
                    self.bounds[2] + random.next() * (self.bounds[3] - self.bounds[2])
                },
            };
            if !self.inside(p, 35.0)
                || self.course_distance(p) < 13.5
                || p.x.hypot(p.z - 55.0) < 24.0
                || !self.target_clear(p, 5.5)
                || !world.clearance(p.x, p.z, 9.0)
                || world.water_distance(p.x, p.z) < 8.0
            {
                continue;
            }
            let meadow = (p.x * 0.0038 + 0.4).sin() * (p.z * 0.0047 - 0.7).cos();
            if !clustered && meadow > 0.18 && random.next() < 0.83 {
                continue;
            }
            let y = world.ground_height(p.x, p.z);
            let scale = 1.0 - ((y - 200.0).max(0.0) / 1100.0).min(0.42);
            let height = (10.0 + random.next() * 25.0 + if clustered { 4.0 } else { 0.0 }) * scale;
            result.trees.extend([
                p.x,
                p.z,
                y,
                height,
                height * (0.44 + random.next() * 0.09),
                random.next() * TAU,
                random.next(),
            ]);
        }
        for _ in 0..7200 {
            if result.rocks.len() >= 1150 * 12 {
                break;
            }
            let near = random.next() < 0.18;
            let p = Point {
                x: if near {
                    (random.next() - 0.5) * 850.0
                } else {
                    self.bounds[0] + random.next() * (self.bounds[1] - self.bounds[0])
                },
                z: if near {
                    random.next() * 950.0 - 715.0
                } else {
                    self.bounds[2] + random.next() * (self.bounds[3] - self.bounds[2])
                },
            };
            if world.water_distance(p.x, p.z) < 3.0
                || self.course_distance(p) < 10.5
                || !self.target_clear(p, 3.0)
                || !world.clearance(p.x, p.z, 6.0)
            {
                continue;
            }
            let size = 0.65 + random.next() * 4.9;
            let height = size * (0.48 + random.next() * 0.65);
            result.rocks.extend([
                p.x,
                world.ground_height(p.x, p.z) + height * 0.36,
                p.z,
                random.next(),
                random.next() * 6.0,
                random.next(),
                size,
                height,
                size * (0.75 + random.next() * 0.7),
                0.84 + random.next() * 0.23,
                size * 0.85,
                height * 1.25,
            ]);
        }
        for _ in 0..6400 {
            if result.banks.len() >= 720 * 12 {
                break;
            }
            let margin = 0.5 + random.next() * 12.0;
            let p = self.bank(&mut random, margin);
            let distance = world.water_distance(p.x, p.z);
            if !self.inside(p, 10.0)
                || !(-0.5..=20.0).contains(&distance)
                || self.course_distance(p) < 10.0
                || !self.target_clear(p, 3.0)
                || !world.clearance(p.x, p.z, 3.0)
            {
                continue;
            }
            let size = 0.45 + random.next() * 2.2;
            let height = size * (0.36 + random.next() * 0.37);
            result.banks.extend([
                p.x,
                world.ground_height(p.x, p.z) + height * 0.27,
                p.z,
                random.next() * 0.5,
                random.next() * std::f64::consts::PI,
                random.next() * 0.4,
                size,
                height,
                size * (0.8 + random.next() * 0.45),
                random.next() * 0.7,
                size * 0.82,
                height * 1.15,
            ]);
        }
        for _ in 0..6200 {
            if result.shrubs.len() >= 420 * 5 {
                break;
            }
            let margin = 5.0 + random.next() * 21.0;
            let p = self.bank(&mut random, margin);
            let distance = world.water_distance(p.x, p.z);
            if !self.inside(p, 20.0)
                || !(3.0..=38.0).contains(&distance)
                || self.course_distance(p) < 12.0
                || !self.target_clear(p, 5.0)
                || !world.clearance(p.x, p.z, 4.0)
            {
                continue;
            }
            let height = 0.7 + random.next() * 1.9;
            let seed = (result.shrubs.len() / 5 + 127) as f64;
            result
                .shrubs
                .extend([p.x, world.ground_height(p.x, p.z), p.z, height, seed]);
        }
        result
    }
    pub fn current(&self, p: Point) -> [f64; 3] {
        let mut best = f64::INFINITY;
        let mut direction = [0.0, 1.0];
        for pair in self.river.windows(2) {
            let a = pair[0].point;
            let b = pair[1].point;
            let dx = b.x - a.x;
            let dz = b.z - a.z;
            let length = dx * dx + dz * dz;
            let t = (((p.x - a.x) * dx + (p.z - a.z) * dz) / length).clamp(0.0, 1.0);
            let distance = (p.x - a.x - t * dx).powi(2) + (p.z - a.z - t * dz).powi(2);
            if distance < best {
                best = distance;
                direction = [dx / length.sqrt(), dz / length.sqrt()];
            }
        }
        let mut strength = 1.0 - smooth(22.0, 80.0, best.sqrt());
        for lake in &self.lakes {
            let dx = p.x - lake.center.x;
            let dz = p.z - lake.center.z;
            let u = (dx * lake.rotation.cos() + dz * lake.rotation.sin()) / lake.radius_x;
            let v = (-dx * lake.rotation.sin() + dz * lake.rotation.cos()) / lake.radius_z;
            strength *= smooth(0.72, 1.12, u.hypot(v));
        }
        [direction[0] * strength, direction[1] * strength, strength]
    }
}

/// Palette is already in Three.js linear colour space. Vertex input uses the
/// renderer's f32 heights so derivative/tint output matches the original mesh.
pub fn terrain_color(palette: &[f64], point: &[f64], spacing: f64) -> [f64; 3] {
    let [x, z, height, left, right, up, down, distance] = <[f64; 8]>::try_from(point).unwrap();
    let slope = ((right - left) / spacing / 2.0).hypot((down - up) / spacing / 2.0);
    let shade = 0.81
        + (x * 0.0064 + 0.8).sin() * (z * 0.0051).cos() * 0.095
        + ((x - z) * 0.014).sin() * 0.024;
    let rock = ((slope - 0.27).max(0.0) * 1.7 + (height - 220.0).max(0.0) / 720.0).min(0.78);
    let mut color = [0.0; 3];
    for c in 0..3 {
        color[c] = palette[c] * shade * (1.0 - rock) + palette[c + 3] * rock;
    }
    if distance < 20.0 && height < 6.0 {
        let mix = ((20.0 - distance) / 20.0).clamp(0.0, 1.0) * 0.84;
        let tint = if distance < -2.0 { 9 } else { 6 };
        for c in 0..3 {
            color[c] = color[c] * (1.0 - mix) + palette[c + tint] * mix;
        }
    }
    color
}

pub fn ripple_texture(size: usize) -> Vec<u8> {
    let mut pixels = vec![0; size * size * 4];
    let mut random = Random(821);
    let mut waves = Vec::with_capacity(48);
    for i in 0..48 {
        let x = (8.0 + random.next() * 48.0).round();
        let z = ((random.next() - 0.5) * 20.0 + 0.5).floor();
        let length = x.hypot(z);
        waves.push((
            x,
            z,
            random.next() * TAU,
            (0.55 + random.next() * 0.45) / ((i + 6) as f64).sqrt(),
            length,
        ));
    }
    for y in 0..size {
        for x in 0..size {
            let mut values = [0.0; 3];
            for &(wx, wz, phase, weight, length) in &waves {
                let angle = (x as f64 * wx + y as f64 * wz) / size as f64 * TAU + phase;
                let slope = angle.cos() * weight;
                values[0] += slope * wx / length;
                values[1] += slope * wz / length;
                values[2] += angle.sin() * weight;
            }
            let offset = (y * size + x) * 4;
            for c in 0..3 {
                pixels[offset + c] =
                    (127.5 + (values[c] * 0.3).clamp(-1.0, 1.0) * 127.5).round() as u8;
            }
            pixels[offset + 3] = 255;
        }
    }
    pixels
}
