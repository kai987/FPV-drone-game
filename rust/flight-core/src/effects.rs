//! Batched CPU animation. Matrices are column-major and Euler rotations use
//! Three.js' XYZ convention. Geometry and GPU shaders remain with the renderer.
use crate::world::World;

type Matrix = [f64; 16];
type V3 = [f64; 3];
type Quaternion = [f64; 4];
const UNIT: V3 = [1.0; 3];
pub const PARTICLES: [usize; 6] = [18, 8, 12, 14, 22, 1];
pub const EFFECT_HEADER: usize = 9;
pub const PARTICLE_STRIDE: usize = 21;
pub const RING_STRIDE: usize = 20;
const PARENTS_PER_ANIMAL: usize = 32;

fn index(value: f64, maximum: usize) -> Option<usize> {
    (value >= 0.0 && value <= maximum as f64 && value.fract() == 0.0).then_some(value as usize)
}

fn lerp(a: f64, b: f64, t: f64) -> f64 {
    (1.0 - t) * a + t * b
}
fn smooth(v: f64, a: f64, b: f64) -> f64 {
    if v <= a {
        return 0.0;
    }
    if v >= b {
        return 1.0;
    }
    let t = (v - a) / (b - a);
    t * t * (3.0 - 2.0 * t)
}
fn euler([x, y, z]: V3) -> Quaternion {
    let (s1, c1) = (x * 0.5).sin_cos();
    let (s2, c2) = (y * 0.5).sin_cos();
    let (s3, c3) = (z * 0.5).sin_cos();
    [
        s1 * c2 * c3 + c1 * s2 * s3,
        c1 * s2 * c3 - s1 * c2 * s3,
        c1 * c2 * s3 + s1 * s2 * c3,
        c1 * c2 * c3 - s1 * s2 * s3,
    ]
}
fn length(v: V3) -> f64 {
    (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt()
}
fn subtract(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn unit_vectors(a: V3, mut b: V3) -> Quaternion {
    let d = length(b);
    if d != 0.0 {
        for v in &mut b {
            *v /= d;
        }
    }
    let r = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + 1.0;
    let mut q = if r < f64::EPSILON {
        if a[0].abs() > a[2].abs() {
            [-a[1], a[0], 0.0, 0.0]
        } else {
            [0.0, -a[2], a[1], 0.0]
        }
    } else {
        [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
            r,
        ]
    };
    let norm = (q.iter().map(|v| v * v).sum::<f64>()).sqrt();
    if norm == 0.0 {
        return [0.0, 0.0, 0.0, 1.0];
    }
    for v in &mut q {
        *v /= norm;
    }
    q
}
fn compose(p: V3, q: Quaternion, s: V3) -> Matrix {
    let [x, y, z, w] = q;
    let x2 = x + x;
    let y2 = y + y;
    let z2 = z + z;
    let xx = x * x2;
    let xy = x * y2;
    let xz = x * z2;
    let yy = y * y2;
    let yz = y * z2;
    let zz = z * z2;
    let wx = w * x2;
    let wy = w * y2;
    let wz = w * z2;
    [
        (1.0 - (yy + zz)) * s[0],
        (xy + wz) * s[0],
        (xz - wy) * s[0],
        0.0,
        (xy - wz) * s[1],
        (1.0 - (xx + zz)) * s[1],
        (yz + wx) * s[1],
        0.0,
        (xz + wy) * s[2],
        (yz - wx) * s[2],
        (1.0 - (xx + yy)) * s[2],
        0.0,
        p[0],
        p[1],
        p[2],
        1.0,
    ]
}
fn pose(p: V3, r: V3, s: V3) -> Matrix {
    compose(p, euler(r), s)
}
fn multiply(a: &Matrix, b: &Matrix) -> Matrix {
    let mut out = [0.0; 16];
    for column in 0..4 {
        for row in 0..4 {
            out[column * 4 + row] = a[row] * b[column * 4]
                + a[4 + row] * b[column * 4 + 1]
                + a[8 + row] * b[column * 4 + 2]
                + a[12 + row] * b[column * 4 + 3];
        }
    }
    out
}
fn write_matrix(output: &mut [f64], index: usize, matrix: Matrix) {
    output[index * 16..(index + 1) * 16].copy_from_slice(&matrix);
}

#[derive(Clone, Debug)]
struct Animal {
    cow: bool,
    x: f64,
    z: f64,
    phase: f64,
    radius: f64,
    offset: f64,
    size: f64,
    activity_offset: f64,
    graze: f64,
    walk: f64,
}

/// Fixed buffers are uploaded once and reused by all subsequent animation ticks.
pub struct Effects {
    pub kind: u32,
    pub config: Vec<f64>,
    pub input: Vec<f64>,
    pub output: Vec<f64>,
    parents: Vec<Matrix>,
    animals: Vec<Animal>,
    previous_time: Option<f64>,
    initialized: bool,
}
impl Effects {
    pub fn new(kind: u32, config_len: usize, input_len: usize, output_len: usize) -> Self {
        Self {
            kind,
            config: vec![0.0; config_len],
            input: vec![0.0; input_len],
            output: vec![0.0; output_len],
            parents: Vec::new(),
            animals: Vec::new(),
            previous_time: None,
            initialized: false,
        }
    }
    pub fn initialize(&mut self) -> bool {
        self.initialized = false;
        if !self.config.iter().all(|x| x.is_finite()) {
            return false;
        }
        let c = &self.config;
        match self.kind {
            0 => {
                if c.len() < 3 {
                    return false;
                }
                let Some(schools) = index(c[1], (c.len() - 3) / 5) else {
                    return false;
                };
                let Some(count) = index(c[2], self.output.len() / (9 * 16)) else {
                    return false;
                };
                if c.len() < 3 + schools * 5 || self.output.len() != count * 9 * 16 {
                    return false;
                }
                let mut actual_count = 0;
                for i in 0..schools {
                    let o = 3 + i * 5;
                    let Some(points) = index(c[o + 4], c.len() / 2) else {
                        return false;
                    };
                    let Some(offset) = index(c[o + 3], c.len()) else {
                        return false;
                    };
                    let Some(fish) = index(c[o], count) else {
                        return false;
                    };
                    if points < 2 || offset + points * 2 > c.len() || c[o + 2] <= 0.0 {
                        return false;
                    }
                    actual_count += fish;
                    if actual_count > count {
                        return false;
                    }
                }
                if actual_count != count {
                    return false;
                }
            }
            1 => {
                if c.len() < 2 {
                    return false;
                }
                let Some(animals) = index(c[0], (c.len() - 2) / 8) else {
                    return false;
                };
                let Some(parts) = index(c[1], self.output.len() / 16) else {
                    return false;
                };
                if c.len() != 2 + animals * 8 + parts * 17 || self.output.len() != parts * 16 {
                    return false;
                }
                let local_start = 2 + animals * 8;
                if (0..parts).any(|i| {
                    index(c[local_start + i * 17], animals * PARENTS_PER_ANIMAL)
                        .is_none_or(|parent| parent >= animals * PARENTS_PER_ANIMAL)
                }) {
                    return false;
                }
                self.animals = (0..animals)
                    .map(|i| {
                        let v = &c[2 + i * 8..];
                        Animal {
                            cow: v[0] != 0.0,
                            x: v[1],
                            z: v[2],
                            phase: v[3],
                            radius: v[4],
                            offset: v[5],
                            size: v[6],
                            activity_offset: v[7],
                            graze: 0.0,
                            walk: 0.0,
                        }
                    })
                    .collect();
                self.parents = vec![[0.0; 16]; animals * PARENTS_PER_ANIMAL];
                self.previous_time = None;
            }
            2 => {
                if c.len() != 25 || c[0] < 1.0 || c[1] <= 0.0 {
                    return false;
                }
                let Some(capacity) = index(c[0], self.input.len().saturating_sub(1) / 6) else {
                    return false;
                };
                if self.input.len() != 1 + capacity * 6
                    || self.output.len() != explosion_output_len(capacity)
                {
                    return false;
                }
            }
            _ => return false,
        }
        self.initialized = true;
        true
    }
    pub fn update(&mut self, time: f64, world: Option<&World>, night: bool) -> bool {
        if !self.initialized || !time.is_finite() {
            return false;
        }
        match self.kind {
            0 => update_fish(&self.config, &mut self.output, time),
            1 => {
                let dt = self
                    .previous_time
                    .map_or(0.0, |previous| (time - previous).clamp(0.0, 0.08));
                self.previous_time = Some(time);
                for (i, animal) in self.animals.iter_mut().enumerate() {
                    update_animal(
                        animal,
                        &mut self.parents[i * 32..(i + 1) * 32],
                        time,
                        dt,
                        world,
                    );
                }
                let offset = 2 + self.animals.len() * 8;
                for (i, part) in self.config[offset..].chunks_exact(17).enumerate() {
                    let local: Matrix = part[1..].try_into().expect("validated part matrix");
                    write_matrix(
                        &mut self.output,
                        i,
                        multiply(&self.parents[part[0] as usize], &local),
                    );
                }
            }
            2 => update_explosions(&self.config, &self.input, &mut self.output, world, night),
            _ => return false,
        }
        true
    }
}

fn update_fish(config: &[f64], output: &mut [f64], time: f64) {
    let count = config[2] as usize;
    let mut slot = 0;
    for school_index in 0..config[1] as usize {
        let c = &config[3 + school_index * 5..];
        let points = c[4] as usize;
        let points_offset = c[3] as usize;
        let point = |i: usize| -> [f64; 2] {
            [
                config[points_offset + i * 2],
                config[points_offset + i * 2 + 1],
            ]
        };
        for fish in 0..c[0] as usize {
            let f = fish as f64;
            let stagger = ((fish % 6) as f64 * 1.83).sin() * 0.45;
            let row = ((fish / 6) as f64 * 3.3 + stagger) / c[2];
            // JS' double remainder is kept intentionally for identical wrapping.
            let progress = ((time * 0.010 + school_index as f64 * 0.17 - row) % 1.0 + 1.0) % 1.0;
            let sample = progress * points as f64;
            let i = sample.floor() as usize;
            let fraction = sample - i as f64;
            let a = point(i);
            let b = point((i + 1) % points);
            let before = point((i + points - 1) % points);
            let after = point((i + 2) % points);
            let dx = lerp(b[0] - before[0], after[0] - a[0], fraction);
            let dz = lerp(b[1] - before[1], after[1] - a[1], fraction);
            let length = dx.hypot(dz);
            let lateral =
                ((fish % 6) as f64 - 2.5) * c[1] * 0.32 + (time * 0.8 + f * 2.1).sin() * 0.11;
            let x = lerp(a[0], b[0], fraction) - dz / length * lateral;
            let z = lerp(a[1], b[1], fraction) + dx / length * lateral;
            let size = 0.82 + (fish % 5) as f64 * 0.085;
            let root = pose(
                [
                    x,
                    config[0] - 0.34 - (fish % 3) as f64 * 0.085 + (time * 0.9 + f).sin() * 0.025,
                    z,
                ],
                [0.0, (-dx).atan2(-dz), (time * 1.3 + f).sin() * 0.035],
                [size; 3],
            );
            write_matrix(output, slot, root);
            write_matrix(
                output,
                count + slot,
                multiply(
                    &root,
                    &pose(
                        [0.0, 0.0, 0.49],
                        [0.0, (time * 7.0 + f * 0.6).sin() * 0.45, 0.0],
                        [1.0, 0.85, 1.0],
                    ),
                ),
            );
            write_matrix(
                output,
                count * 2 + slot,
                multiply(&root, &pose([0.0, 0.10, 0.0], [0.0; 3], UNIT)),
            );
            for (side_index, side) in [-1.0, 1.0].iter().enumerate() {
                let pair = slot * 2 + side_index;
                write_matrix(
                    output,
                    count * 3 + pair,
                    multiply(
                        &root,
                        &pose(
                            [side * 0.10, -0.035, -0.04],
                            [
                                0.0,
                                side * (0.72 + (time * 3.0 + f).sin() * 0.05),
                                side * std::f64::consts::FRAC_PI_2,
                            ],
                            [0.6, 0.63, 0.65],
                        ),
                    ),
                );
                write_matrix(
                    output,
                    count * 5 + pair,
                    multiply(
                        &root,
                        &pose([side * 0.082, 0.025, -0.425], [0.0; 3], [0.022; 3]),
                    ),
                );
                write_matrix(
                    output,
                    count * 7 + pair,
                    multiply(
                        &root,
                        &pose(
                            [side * 0.065, 0.0, -0.27],
                            [
                                0.0,
                                side * std::f64::consts::FRAC_PI_2,
                                std::f64::consts::PI * 0.16,
                            ],
                            [0.7, 1.0, 1.0],
                        ),
                    ),
                );
            }
            slot += 1;
        }
    }
}

fn update_animal(a: &mut Animal, out: &mut [Matrix], time: f64, dt: f64, world: Option<&World>) {
    let cow = a.cow;
    let activity = (time / if cow { 32.0 } else { 28.0 } + a.activity_offset) % 1.0;
    let graze_target = smooth(activity, 0.08, 0.18) * (1.0 - smooth(activity, 0.40, 0.53));
    let walk_target = smooth(activity, 0.60, 0.70) * (1.0 - smooth(activity, 0.91, 1.0));
    a.graze += (graze_target - a.graze) * (dt * 3.2).min(1.0);
    a.walk += (walk_target - a.walk) * (dt * 3.2).min(1.0);
    a.phase += dt * if cow { 0.065 } else { 0.083 } * a.walk;
    let x = a.x + a.phase.cos() * a.radius;
    let z = a.z + a.phase.sin() * a.radius * 0.77;
    let heading = a.phase.sin().atan2(-a.phase.cos() * 0.77);
    let root = pose(
        [
            x,
            world.map_or(0.0, |w| w.ground_height(x, z))
                + (time * 3.5 + a.offset).sin() * 0.008 * a.walk,
            z,
        ],
        [0.0, heading, (time * 0.68 + a.offset).sin() * 0.006],
        [a.size; 3],
    );
    out[0] = root;
    let g = a.graze;
    let nibble = (time * 5.3 + a.offset).sin() * g * 0.008;
    let head = [
        0.0,
        if cow {
            1.39 - g * 0.69
        } else {
            0.98 - g * 0.50
        } + nibble,
        if cow {
            -1.11 - g * 0.11
        } else {
            -0.71 - g * 0.065
        },
    ];
    out[1] = multiply(
        &root,
        &pose(
            head,
            [
                if cow {
                    -0.10 - g * 0.92
                } else {
                    -0.06 - g * 0.79
                } + (time * 1.1 + a.offset).sin() * 0.012,
                (time * 0.7 + a.offset).sin() * if g > 0.8 { 0.024 } else { 0.055 },
                0.0,
            ],
            UNIT,
        ),
    );
    let origin = [
        0.0,
        if cow { 1.18 } else { 0.80 },
        if cow { -0.88 } else { -0.47 },
    ];
    let dir = subtract(head, origin);
    out[2] = multiply(
        &root,
        &compose(
            origin,
            unit_vectors([0.0, 0.0, -1.0], dir),
            [1.0, 1.0, length(dir) / if cow { 0.55 } else { 0.36 }],
        ),
    );
    out[3] = multiply(
        &root,
        &pose(
            [
                0.0,
                if cow { 1.45 } else { 0.88 },
                if cow { 0.94 } else { 0.65 },
            ],
            [
                0.035 * (time * 0.91 + a.offset).sin(),
                (time * 0.80 + a.offset).sin() * 0.10,
                (time * 1.7 + a.offset).sin() * if cow { 0.13 } else { 0.08 },
            ],
            UNIT,
        ),
    );
    for leg in 0..4 {
        let front = leg < 2;
        let side = if leg % 2 == 1 { -1.0 } else { 1.0 };
        let leg_phase = if leg == 0 || leg == 3 {
            0.0
        } else {
            std::f64::consts::PI
        };
        let cycle = time * if cow { 2.7 } else { 3.3 } + a.offset + leg_phase;
        let stride = cycle.sin() * if cow { 0.14 } else { 0.10 } * a.walk;
        let lift = cycle.cos().max(0.0) * if cow { 0.073 } else { 0.059 } * a.walk;
        let spread = side * if cow { 0.31 } else { 0.215 };
        let p = if cow {
            [
                [
                    spread,
                    if front { 1.22 } else { 1.25 },
                    if front { -0.63 } else { 0.68 },
                ],
                [
                    spread * 1.02,
                    0.78 + lift * 0.22,
                    if front { -0.565 } else { 0.49 } + stride * 0.32,
                ],
                [
                    spread * 1.035,
                    0.44 + lift * 0.65,
                    if front { -0.665 } else { 0.775 } + stride * 0.60,
                ],
                [
                    spread * 1.06,
                    0.158 + lift,
                    if front { -0.66 } else { 0.645 } + stride,
                ],
            ]
        } else {
            [
                [spread, 0.81, if front { -0.40 } else { 0.43 }],
                [
                    spread * 1.02,
                    0.51 + lift * 0.22,
                    if front { -0.37 } else { 0.32 } + stride * 0.34,
                ],
                [
                    spread * 1.035,
                    0.27 + lift * 0.65,
                    if front { -0.43 } else { 0.50 } + stride * 0.62,
                ],
                [
                    spread * 1.06,
                    0.108 + lift,
                    if front { -0.43 } else { 0.42 } + stride,
                ],
            ]
        };
        let start = 4 + leg * 7;
        for bone in 0..3 {
            let dir = subtract(p[bone], p[bone + 1]);
            let midpoint = [
                (p[bone][0] + p[bone + 1][0]) * 0.5,
                (p[bone][1] + p[bone + 1][1]) * 0.5,
                (p[bone][2] + p[bone + 1][2]) * 0.5,
            ];
            let radius = if cow {
                if bone == 0 {
                    if front { 0.130 } else { 0.145 }
                } else if bone == 1 {
                    0.064
                } else {
                    0.046
                }
            } else if bone == 0 {
                0.067
            } else if bone == 1 {
                0.041
            } else {
                0.030
            };
            out[start + bone] = multiply(
                &root,
                &compose(
                    midpoint,
                    unit_vectors([0.0, 1.0, 0.0], dir),
                    [
                        radius,
                        length(dir),
                        radius * if bone == 0 { 1.18 } else { 1.0 },
                    ],
                ),
            );
            out[start + 3 + bone] = multiply(&root, &pose(p[bone + 1], [0.0; 3], UNIT));
        }
        out[start + 6] = multiply(&root, &pose([p[3][0], lift, p[3][2]], [0.0; 3], UNIT));
    }
}

pub fn explosion_output_len(capacity: usize) -> usize {
    EFFECT_HEADER
        + PARTICLES.iter().sum::<usize>() * capacity * PARTICLE_STRIDE
        + capacity * 3 * RING_STRIDE
        + capacity * 16 * 16
        + 3 * 7
}

fn random(id: f64, index: usize) -> f64 {
    let v = (id * 19.731 + index as f64 * 43.117).sin() * 41791.319;
    v - v.floor()
}
struct ParticleWriter<'a> {
    output: &'a mut [f64],
    capacity: usize,
    offsets: [usize; 9],
}
impl<'a> ParticleWriter<'a> {
    fn new(output: &'a mut [f64], capacity: usize) -> Self {
        output[..EFFECT_HEADER].fill(0.0);
        let mut offsets = [0; 9];
        let mut offset = EFFECT_HEADER;
        for (i, per) in PARTICLES.iter().enumerate() {
            offsets[i] = offset;
            offset += per * capacity * PARTICLE_STRIDE;
        }
        offsets[6] = offset;
        offset += capacity * 3 * RING_STRIDE;
        offsets[7] = offset;
        offset += capacity * 16 * 16;
        offsets[8] = offset;
        Self {
            output,
            capacity,
            offsets,
        }
    }
    fn particle(
        &mut self,
        kind: usize,
        position: V3,
        size: [f64; 2],
        alpha: f64,
        color: V3,
        seed: f64,
    ) {
        let count = self.output[kind] as usize;
        let capacity = self.capacity * PARTICLES[kind];
        if count >= capacity || alpha <= 0.008 {
            return;
        }
        let offset = self.offsets[kind];
        let start = offset + count * 16;
        self.output[start..start + 16].copy_from_slice(&pose(
            position,
            [0.0; 3],
            [size[0], size[1], 1.0],
        ));
        let start = offset + capacity * 16 + count * 3;
        self.output[start..start + 3].copy_from_slice(&color);
        self.output[offset + capacity * 19 + count] = alpha;
        self.output[offset + capacity * 20 + count] = seed;
        self.output[kind] += 1.0;
    }
    fn ring(&mut self, position: V3, radius: f64, color: V3, alpha: f64) {
        let count = self.output[6] as usize;
        let capacity = self.capacity * 3;
        let offset = self.offsets[6];
        let start = offset + count * 16;
        self.output[start..start + 16].copy_from_slice(&pose(
            position,
            [0.0; 3],
            [radius, 1.0, radius],
        ));
        let start = offset + capacity * 16 + count * 3;
        self.output[start..start + 3].copy_from_slice(&color);
        self.output[offset + capacity * 19 + count] = alpha;
        self.output[6] += 1.0;
    }
    fn fragment(&mut self, matrix: Matrix) {
        let start = self.offsets[7] + self.output[7] as usize * 16;
        self.output[start..start + 16].copy_from_slice(&matrix);
        self.output[7] += 1.0;
    }
    fn light(&mut self, position: V3, color: V3, intensity: f64) {
        let count = self.output[8] as usize;
        if count >= 3 {
            return;
        }
        let start = self.offsets[8] + count * 7;
        self.output[start..start + 3].copy_from_slice(&position);
        self.output[start + 3..start + 6].copy_from_slice(&color);
        self.output[start + 6] = intensity;
        self.output[8] += 1.0;
    }
}
fn update_explosions(
    config: &[f64],
    input: &[f64],
    output: &mut [f64],
    world: Option<&World>,
    night: bool,
) {
    let capacity = config[0] as usize;
    let lifetime = config[1];
    let blast = config[2];
    let water_level = config[3];
    let color = |i: usize| -> [f64; 3] {
        config[4 + i * 3..7 + i * 3]
            .try_into()
            .expect("validated color")
    };
    let smoke_color = color(0);
    let dust = color(1);
    let water = color(2);
    let flame = color(3);
    let white = color(4);
    let mut write = ParticleWriter::new(output, capacity);
    for e in input[1..]
        .chunks_exact(6)
        .take((input[0] as usize).min(capacity))
    {
        if !e.iter().all(|v| v.is_finite()) {
            continue;
        }
        let id = e[0];
        let [x, y, z] = [e[1], e[2], e[3]];
        let age = e[4].clamp(0.0, lifetime);
        if age >= lifetime {
            continue;
        }
        let water_impact =
            world.map_or(e[5] != 0.0, |w| w.is_water(x, z) && y <= water_level + 0.35);
        let late_fade = 1.0 - smooth(age, 2.5, lifetime);
        if age < 0.2 {
            write.light(
                [x, y + 1.2, z],
                color(if water_impact { 6 } else { 5 }),
                if night { 340.0 } else { 100.0 } * (1.0 - smooth(age, 0.025, 0.2)).powi(2),
            );
        }
        if age < 0.11 {
            write.particle(
                5,
                [x, y + 0.5, z],
                [1.0 + age * 24.0; 2],
                (1.0 - age / 0.11) * if water_impact { 0.42 } else { 0.9 },
                if water_impact { water } else { white },
                0.0,
            );
        }
        let duration = if water_impact { 2.5 } else { 0.7 };
        if age < duration {
            for ring in 0..if water_impact { 3 } else { 1 } {
                let r = ring as f64;
                let t = (age - r * 0.1).max(0.0);
                let radius = 0.4
                    + t * if water_impact {
                        5.2 - r * 0.75
                    } else {
                        blast / 0.7
                    };
                write.ring(
                    [x, y + 0.025 + r * 0.007, z],
                    radius,
                    if water_impact { water } else { dust },
                    (1.0 - age / duration).powf(1.4) * if water_impact { 0.72 } else { 0.22 },
                );
            }
        }
        if water_impact {
            if age < 1.15 {
                for i in 0..22 {
                    let r = random(id, i);
                    let angle = i as f64 * 2.39996 + id;
                    let radius = age * (2.8 + r * 7.2);
                    let height = (age * (5.0 + r * 7.0) - age * age * 7.5).max(0.0);
                    if height <= 0.025 && age > 0.3 {
                        continue;
                    }
                    write.particle(
                        4,
                        [
                            x + angle.cos() * radius,
                            y + height + 0.2,
                            z + angle.sin() * radius,
                        ],
                        [0.045 + r * 0.07, 0.18 + r * 0.24],
                        (1.0 - age / 1.15) * 0.78,
                        water,
                        0.0,
                    );
                }
            }
            for i in 0..14 {
                let r = random(id, i + 40);
                let angle = i as f64 * 2.39996 + id * 0.6;
                let radius = (0.2 + age * 0.7) * (1.0 + r);
                let size = 0.5 + age * (0.95 + r * 0.55);
                let alpha = smooth(age, 0.025, 0.23) * (1.0 - smooth(age, 1.5, 3.0)) * 0.24;
                write.particle(
                    3,
                    [
                        x + angle.cos() * radius + age * 0.3,
                        y + 0.5 + age * (1.1 + r * 0.45),
                        z + angle.sin() * radius,
                    ],
                    [size, size * 0.8],
                    alpha,
                    water,
                    r,
                );
            }
            continue;
        }
        if age < 0.65 {
            for i in 0..8 {
                let r = random(id, i);
                let angle = i as f64 * 2.39996 + id;
                let size = (0.5 + age * 5.2) * (0.68 + r * 0.6);
                let radius = age * (1.7 + r * 2.5);
                let alpha = smooth(age, 0.0, 0.03) * (1.0 - smooth(age, 0.16, 0.65)) * 0.64;
                write.particle(
                    1,
                    [
                        x + angle.cos() * radius,
                        y + 0.55 + age * (1.5 + r * 2.5),
                        z + angle.sin() * radius,
                    ],
                    [size, size * (0.8 + r * 0.4)],
                    alpha,
                    flame,
                    r,
                );
            }
        }
        if age < 1.75 {
            for i in 0..12 {
                let r = random(id, i + 10);
                let angle = i as f64 * 2.39996 + id * 0.4;
                let radius = age.sqrt() * (2.0 + r * 3.8);
                let size = 0.7 + age * (1.5 + r * 1.5);
                let alpha = smooth(age, 0.04, 0.2) * (1.0 - smooth(age, 0.6, 1.75)) * 0.23;
                write.particle(
                    2,
                    [
                        x + angle.cos() * radius,
                        y + 0.3 + age * (0.45 + r * 0.65),
                        z + angle.sin() * radius,
                    ],
                    [size, size * 0.55],
                    alpha,
                    dust,
                    r,
                );
            }
        }
        for i in 0..18 {
            let r = random(id, i + 80);
            let angle = i as f64 * 2.39996 + id * 0.3;
            let delay = (i % 6) as f64 * 0.045;
            let t = (age - delay).max(0.0);
            let radius = (0.15 + t * 0.62) * (0.7 + r);
            let size = 0.35 + t * (1.0 + r * 0.9);
            let rise = 0.5 + t * (1.6 + r) + (t * 1.1 + i as f64).sin() * t * 0.12;
            let alpha = smooth(t, 0.09, 0.44) * late_fade * (0.23 + r * 0.09);
            let amount = (1.0 - smooth(age, 0.15, 0.8)) * 0.32;
            let tint = [
                smoke_color[0] + (flame[0] - smoke_color[0]) * amount,
                smoke_color[1] + (flame[1] - smoke_color[1]) * amount,
                smoke_color[2] + (flame[2] - smoke_color[2]) * amount,
            ];
            write.particle(
                0,
                [
                    x + angle.cos() * radius + t * 0.45,
                    y + rise,
                    z + angle.sin() * radius + t * 0.18,
                ],
                [size, size * (1.0 + r * 0.27)],
                alpha,
                tint,
                r,
            );
        }
        if age < 1.1 {
            for i in 0..16 {
                let r = random(id, i + 120);
                let angle = i as f64 * 2.39996 + id * 0.73;
                let radius = age * (3.0 + r * 6.0);
                let height = age * (4.2 + r * 4.0) - age * age * 8.0;
                if height <= 0.0 && age > 0.1 {
                    continue;
                }
                let size = 0.55 + r;
                write.fragment(pose(
                    [
                        x + angle.cos() * radius,
                        y + height.max(0.05),
                        z + angle.sin() * radius,
                    ],
                    [
                        i as f64 + age * 5.0,
                        i as f64 * 0.3 + age * 7.0,
                        age * 4.0 + r,
                    ],
                    [size, size * 0.65, size * 1.5],
                ));
            }
        }
    }
}
