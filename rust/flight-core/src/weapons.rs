//! Stateful projectile integration. The shared TypeScript catalog supplies all
//! tunings and target coordinates once; Rust owns motion, contacts and scores.

use crate::flight::Vec3;

pub const MAX_PACKET_BOMBS: usize = 24;
pub const MAX_PACKET_EXPLOSIONS: usize = 32;
pub const MAX_PACKET_TARGETS: usize = 16;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WeaponConfig {
    pub capacity: usize,
    pub gravity: f64,
    pub drop_cooldown: f64,
    pub reload_time: f64,
    pub blast_radius: f64,
    pub explosion_lifetime: f64,
    pub max_bombs: usize,
    pub max_explosions: usize,
    pub max_substep: f64,
    pub max_substeps: usize,
    pub timer_epsilon: f64,
}

impl WeaponConfig {
    pub fn valid(self) -> bool {
        self.capacity > 0
            && self.capacity <= self.max_bombs
            && (1..=MAX_PACKET_BOMBS).contains(&self.max_bombs)
            && (1..=MAX_PACKET_EXPLOSIONS).contains(&self.max_explosions)
            && (1..=600).contains(&self.max_substeps)
            && [
                self.gravity,
                self.drop_cooldown,
                self.reload_time,
                self.blast_radius,
                self.explosion_lifetime,
                self.max_substep,
            ]
            .iter()
            .all(|value| value.is_finite() && *value > 0.0)
            && self.timer_epsilon.is_finite()
            && self.timer_epsilon >= 0.0
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WeaponTarget {
    pub x: f64,
    pub z: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bomb {
    pub id: f64,
    pub position: Vec3,
    pub velocity: Vec3,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Explosion {
    pub id: f64,
    pub position: Vec3,
    pub age: f64,
    pub hit_count: usize,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct WeaponEvents {
    pub impacts: usize,
    pub hits: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub struct WeaponSimulation {
    pub config: WeaponConfig,
    pub targets: Vec<WeaponTarget>,
    pub bombs: Vec<Bomb>,
    pub explosions: Vec<Explosion>,
    pub ammo: usize,
    pub reload_remaining: f64,
    pub cooldown: f64,
    pub score: usize,
    /// Indices retain the original chronological target-hit order.
    pub hit_target_indices: Vec<usize>,
    pub next_id: f64,
}

fn finite_vector(vector: Vec3) -> bool {
    vector.x.is_finite() && vector.y.is_finite() && vector.z.is_finite()
}

fn ground_at(surface: &mut impl FnMut(f64, f64, f64) -> f64, x: f64, z: f64, from_y: f64) -> f64 {
    let height = surface(x, z, from_y);
    if height.is_finite() { height } else { 0.0 }
}

fn position_at(bomb: Bomb, time: f64, gravity: f64) -> Vec3 {
    Vec3 {
        x: bomb.position.x + bomb.velocity.x * time,
        y: bomb.position.y + bomb.velocity.y * time - gravity * time * time / 2.0,
        z: bomb.position.z + bomb.velocity.z * time,
    }
}

fn ground_impact_time(
    bomb: Bomb,
    dt: f64,
    gravity: f64,
    surface: &mut impl FnMut(f64, f64, f64) -> f64,
) -> Option<f64> {
    let mut above_ground = |time| {
        let position = position_at(bomb, time, gravity);
        position.y - ground_at(surface, position.x, position.z, bomb.position.y)
    };
    if above_ground(0.0) <= 0.0 {
        return Some(0.0);
    }
    let mut previous_time = 0.0;
    for sample in 1..=4 {
        let time = dt * f64::from(sample) / 4.0;
        if above_ground(time) <= 0.0 {
            let mut low = previous_time;
            let mut high = time;
            for _ in 0..18 {
                let midpoint = (low + high) / 2.0;
                if above_ground(midpoint) > 0.0 {
                    low = midpoint;
                } else {
                    high = midpoint;
                }
            }
            return Some(high);
        }
        previous_time = time;
    }
    None
}

impl WeaponSimulation {
    pub fn new(config: WeaponConfig, targets: Vec<WeaponTarget>) -> Option<Self> {
        if !config.valid()
            || targets.len() > MAX_PACKET_TARGETS
            || targets
                .iter()
                .any(|target| !target.x.is_finite() || !target.z.is_finite())
        {
            return None;
        }
        Some(Self {
            config,
            targets,
            bombs: Vec::with_capacity(config.max_bombs),
            explosions: Vec::with_capacity(config.max_explosions + 1),
            ammo: config.capacity,
            reload_remaining: 0.0,
            cooldown: 0.0,
            score: 0,
            hit_target_indices: Vec::with_capacity(MAX_PACKET_TARGETS),
            next_id: 1.0,
        })
    }

    pub fn reset(&mut self) {
        self.bombs.clear();
        self.explosions.clear();
        self.hit_target_indices.clear();
        self.ammo = self.config.capacity;
        self.reload_remaining = 0.0;
        self.cooldown = 0.0;
        self.score = 0;
        self.next_id = 1.0;
    }

    pub fn drop_bomb(&mut self, position: Vec3, velocity: Vec3) -> bool {
        if self.ammo == 0
            || self.reload_remaining > 0.0
            || self.cooldown > 0.0
            || self.bombs.len() >= self.config.max_bombs
            || !finite_vector(position)
            || !finite_vector(velocity)
        {
            return false;
        }
        self.bombs.push(Bomb {
            id: self.next_id,
            position: Vec3 {
                y: position.y - 0.8,
                ..position
            },
            velocity,
        });
        self.next_id += 1.0;
        self.ammo -= 1;
        self.cooldown = self.config.drop_cooldown;
        if self.ammo == 0 {
            self.reload_remaining = self.config.reload_time;
        }
        true
    }

    pub fn step(&mut self, dt: f64, mut surface: impl FnMut(f64, f64, f64) -> f64) -> WeaponEvents {
        let mut events = WeaponEvents::default();
        if !dt.is_finite() || dt <= 0.0 {
            return events;
        }
        let countdown = |remaining: f64| {
            let next = remaining - dt;
            if next <= self.config.timer_epsilon {
                0.0
            } else {
                next
            }
        };
        self.cooldown = countdown(self.cooldown);
        if self.reload_remaining > 0.0 {
            self.reload_remaining = countdown(self.reload_remaining);
            if self.reload_remaining == 0.0 {
                self.ammo = self.config.capacity;
            }
        }
        let steps = ((dt / self.config.max_substep).ceil() as usize)
            .max(1)
            .min(self.config.max_substeps);
        let substep = dt / steps as f64;
        for _ in 0..steps {
            for explosion in &mut self.explosions {
                explosion.age += substep;
            }
            self.explosions
                .retain(|explosion| explosion.age < self.config.explosion_lifetime);
            // Compact in place: long frames allocate no per-projectile buffers.
            let mut flying = 0;
            for index in 0..self.bombs.len() {
                let mut bomb = self.bombs[index];
                let Some(impact_time) =
                    ground_impact_time(bomb, substep, self.config.gravity, &mut surface)
                else {
                    bomb.position = position_at(bomb, substep, self.config.gravity);
                    bomb.velocity.y -= self.config.gravity * substep;
                    self.bombs[flying] = bomb;
                    flying += 1;
                    continue;
                };
                let mut impact = position_at(bomb, impact_time, self.config.gravity);
                impact.y = ground_at(&mut surface, impact.x, impact.z, bomb.position.y);
                let mut hit_count = 0;
                for (target_index, target) in self.targets.iter().enumerate() {
                    if self.hit_target_indices.contains(&target_index) {
                        continue;
                    }
                    if (impact.x - target.x).hypot(impact.z - target.z) <= self.config.blast_radius
                    {
                        self.hit_target_indices.push(target_index);
                        hit_count += 1;
                    }
                }
                self.score += hit_count * 100;
                self.explosions.push(Explosion {
                    id: self.next_id,
                    position: impact,
                    age: substep - impact_time,
                    hit_count,
                });
                self.next_id += 1.0;
                if self.explosions.len() > self.config.max_explosions {
                    self.explosions.remove(0);
                }
                events.impacts += 1;
                events.hits += hit_count;
            }
            self.bombs.truncate(flying);
            self.explosions
                .retain(|explosion| explosion.age < self.config.explosion_lifetime);
        }
        events
    }
}
