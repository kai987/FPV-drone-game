//! Fictional practice-game hitscan and ammunition, independent of bomb state.
use crate::flight::Vec3;

pub const CAPACITY: usize = 40;
pub const SHOT_INTERVAL: f64 = 1.0 / 24.0;
pub const RELOAD_TIME: f64 = 2.4;
pub const RANGE: f64 = 360.0;
pub const SHOT_LIFETIME: f64 = 0.45;
pub const IMPACT_LIFETIME: f64 = 0.3;
pub const MAX_SHOTS: usize = 16;
pub const MAX_IMPACTS: usize = 16;
pub const MAX_TARGETS: usize = 16;
const EPSILON: f64 = 1e-9;

#[derive(Clone, Copy, Debug)]
pub struct GunTarget {
    pub position: Vec3,
    pub radius: f64,
}
#[derive(Clone, Copy, Debug)]
pub struct GunShot {
    pub id: f64,
    pub from: Vec3,
    pub to: Vec3,
    pub age: f64,
}
#[derive(Clone, Copy, Debug)]
pub struct GunImpact {
    pub id: f64,
    pub position: Vec3,
    pub age: f64,
    pub hit: bool,
}
#[derive(Default, Debug)]
pub struct GunEvents {
    pub shots: usize,
    pub hits: usize,
}

pub struct GunSimulation {
    pub ammo: usize,
    pub reload_remaining: f64,
    pub score: usize,
    pub total_shots: usize,
    pub shots: Vec<GunShot>,
    pub impacts: Vec<GunImpact>,
    pub hit_target_indices: Vec<usize>,
    targets: Vec<GunTarget>,
    cooldown: f64,
    next_id: f64,
}

fn finite(v: Vec3) -> bool {
    v.x.is_finite() && v.y.is_finite() && v.z.is_finite()
}
fn at(origin: Vec3, direction: Vec3, distance: f64) -> Vec3 {
    Vec3 {
        x: origin.x + direction.x * distance,
        y: origin.y + direction.y * distance,
        z: origin.z + direction.z * distance,
    }
}
fn countdown(value: f64, dt: f64) -> f64 {
    if value - dt <= EPSILON {
        0.0
    } else {
        value - dt
    }
}

impl GunSimulation {
    pub fn new(targets: Vec<GunTarget>) -> Option<Self> {
        if targets.len() > MAX_TARGETS
            || targets.iter().any(|t| {
                !finite(t.position) || !t.radius.is_finite() || t.radius <= 0.0 || t.radius > 100.0
            })
        {
            return None;
        }
        Some(Self {
            ammo: CAPACITY,
            reload_remaining: 0.0,
            score: 0,
            total_shots: 0,
            shots: Vec::with_capacity(MAX_SHOTS),
            impacts: Vec::with_capacity(MAX_IMPACTS),
            hit_target_indices: Vec::with_capacity(MAX_TARGETS),
            targets,
            cooldown: 0.0,
            next_id: 1.0,
        })
    }
    pub fn reset(&mut self) {
        self.ammo = CAPACITY;
        self.reload_remaining = 0.0;
        self.score = 0;
        self.total_shots = 0;
        self.cooldown = 0.0;
        self.next_id = 1.0;
        self.shots.clear();
        self.impacts.clear();
        self.hit_target_indices.clear();
    }
    fn age(&mut self, dt: f64) {
        self.cooldown = countdown(self.cooldown, dt);
        if self.reload_remaining > 0.0 {
            self.reload_remaining = countdown(self.reload_remaining, dt);
            if self.reload_remaining == 0.0 {
                self.ammo = CAPACITY;
            }
        }
        for shot in &mut self.shots {
            shot.age += dt;
        }
        for impact in &mut self.impacts {
            impact.age += dt;
        }
        self.shots.retain(|s| s.age < SHOT_LIFETIME);
        self.impacts.retain(|i| i.age < IMPACT_LIFETIME);
    }
    fn trace(
        &self,
        origin: Vec3,
        direction: Vec3,
        blocked: &mut impl FnMut(Vec3) -> bool,
    ) -> (Vec3, Option<usize>, bool) {
        // Targets are solid practice volumes, including targets already scored.
        let mut limit = RANGE;
        let mut target_index = None;
        for (index, target) in self.targets.iter().enumerate() {
            let offset = Vec3 {
                x: origin.x - target.position.x,
                y: origin.y - target.position.y,
                z: origin.z - target.position.z,
            };
            // Practice pads are wide and low, rather than tall spherical hitboxes.
            let height = target.radius.min(0.8);
            let inv_xz = 1.0 / (target.radius * target.radius);
            let inv_y = 1.0 / (height * height);
            let a = (direction.x * direction.x + direction.z * direction.z) * inv_xz
                + direction.y * direction.y * inv_y;
            let b = (offset.x * direction.x + offset.z * direction.z) * inv_xz
                + offset.y * direction.y * inv_y;
            let c = (offset.x * offset.x + offset.z * offset.z) * inv_xz
                + offset.y * offset.y * inv_y
                - 1.0;
            let discriminant = b * b - a * c;
            if discriminant < 0.0 {
                continue;
            }
            let distance = if c <= 0.0 {
                0.0
            } else {
                (-b - discriminant.sqrt()) / a
            };
            if distance >= 0.0 && distance <= limit {
                limit = distance;
                target_index = Some(index);
            }
        }
        // Half-unit samples use the native world's spatial indexes. Existing
        // collision padding also catches the narrowest game obstacles. Refine
        // the first contact; never let a target behind a wall receive a score.
        let mut obstruction = None;
        if blocked(origin) {
            obstruction = Some(0.0);
        }
        let samples = (limit / 0.5).ceil().max(1.0) as usize;
        let mut previous = 0.0;
        if obstruction.is_none() {
            for sample in 1..=samples {
                let distance = limit * sample as f64 / samples as f64;
                if blocked(at(origin, direction, distance)) {
                    let mut low = previous;
                    let mut high = distance;
                    for _ in 0..12 {
                        let middle = (low + high) / 2.0;
                        if blocked(at(origin, direction, middle)) {
                            high = middle;
                        } else {
                            low = middle;
                        }
                    }
                    obstruction = Some(high);
                    break;
                }
                previous = distance;
            }
        }
        if let Some(distance) = obstruction {
            limit = distance;
            target_index = None;
        }
        (
            at(origin, direction, limit),
            target_index,
            obstruction.is_some(),
        )
    }
    fn fire(
        &mut self,
        origin: Vec3,
        mut direction: Vec3,
        aim_origin: Option<Vec3>,
        blocked: &mut impl FnMut(Vec3) -> bool,
    ) -> usize {
        if let Some(camera) = aim_origin {
            let (aim, _, _) = self.trace(camera, direction, blocked);
            let delta = Vec3 {
                x: aim.x - origin.x,
                y: aim.y - origin.y,
                z: aim.z - origin.z,
            };
            let length = delta.x.hypot(delta.y).hypot(delta.z);
            if length > EPSILON {
                direction = Vec3 {
                    x: delta.x / length,
                    y: delta.y / length,
                    z: delta.z / length,
                };
            }
        }
        let (position, target_index, obstruction) = self.trace(origin, direction, blocked);
        let mut hits = 0;
        if let Some(index) = target_index {
            if !self.hit_target_indices.contains(&index) {
                self.hit_target_indices.push(index);
                self.score += 100;
                hits = 1;
            }
        }
        let id = self.next_id;
        self.next_id += 1.0;
        if self.shots.len() == MAX_SHOTS {
            self.shots.remove(0);
        }
        self.shots.push(GunShot {
            id,
            from: origin,
            to: position,
            age: 0.0,
        });
        if obstruction || target_index.is_some() {
            if self.impacts.len() == MAX_IMPACTS {
                self.impacts.remove(0);
            }
            self.impacts.push(GunImpact {
                id,
                position,
                age: 0.0,
                hit: target_index.is_some(),
            });
        }
        self.total_shots += 1;
        self.ammo -= 1;
        self.cooldown = SHOT_INTERVAL;
        if self.ammo == 0 {
            self.reload_remaining = RELOAD_TIME;
        }
        hits
    }
    pub fn step(
        &mut self,
        dt: f64,
        trigger: bool,
        origin: Vec3,
        direction: Vec3,
        aim_origin: Option<Vec3>,
        mut blocked: impl FnMut(Vec3) -> bool,
    ) -> GunEvents {
        let mut events = GunEvents::default();
        let length = direction.x.hypot(direction.y).hypot(direction.z);
        // Bounded elapsed time keeps accidental huge updates from monopolizing
        // the render thread. The engine supplies its fixed 1/60 second tick.
        if !dt.is_finite()
            || dt <= 0.0
            || dt > 10.0
            || !finite(origin)
            || !finite(direction)
            || !length.is_finite()
            || length < EPSILON
            || aim_origin.is_some_and(|v| !finite(v))
        {
            return events;
        }
        let direction = Vec3 {
            x: direction.x / length,
            y: direction.y / length,
            z: direction.z / length,
        };
        let mut remaining = dt;
        while remaining > EPSILON {
            if trigger && self.reload_remaining == 0.0 && self.cooldown == 0.0 && self.ammo > 0 {
                events.hits += self.fire(origin, direction, aim_origin, &mut blocked);
                events.shots += 1;
            }
            let until_event = if !trigger {
                remaining
            } else if self.reload_remaining > 0.0 {
                self.reload_remaining
            } else {
                self.cooldown.max(EPSILON)
            };
            let elapsed = remaining.min(until_event);
            self.age(elapsed);
            remaining -= elapsed;
        }
        events
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const ORIGIN: Vec3 = Vec3 {
        x: 0.0,
        y: 10.0,
        z: 0.0,
    };
    const FORWARD: Vec3 = Vec3 {
        x: 0.0,
        y: 0.0,
        z: -1.0,
    };

    #[test]
    fn cadence_is_independent_of_frame_partition_and_release() {
        for fps in [30, 60, 120] {
            let mut gun = GunSimulation::new(vec![]).unwrap();
            for _ in 0..fps {
                gun.step(1.0 / fps as f64, true, ORIGIN, FORWARD, None, |_| false);
            }
            assert_eq!(gun.total_shots, 24);
            assert!(gun.shots.len() >= 10 && gun.shots.len() <= 11);
            gun.step(1.0, false, ORIGIN, FORWARD, None, |_| false);
            assert_eq!(gun.total_shots, 24);
            assert!(gun.shots.is_empty());
        }
    }

    #[test]
    fn continuous_fire_resumes_only_after_complete_reload() {
        let mut gun = GunSimulation::new(vec![]).unwrap();
        assert_eq!(
            gun.step(2.0, true, ORIGIN, FORWARD, None, |_| false).shots,
            40
        );
        assert_eq!(gun.ammo, 0);
        assert_eq!(
            gun.step(2.025, true, ORIGIN, FORWARD, None, |_| false)
                .shots,
            0
        );
        assert_eq!(gun.ammo, CAPACITY);
        assert_eq!(
            gun.step(0.01, true, ORIGIN, FORWARD, None, |_| false).shots,
            1
        );
        gun.reset();
        assert_eq!(gun.total_shots, 0);
        assert_eq!(gun.ammo, CAPACITY);
    }

    #[test]
    fn invalid_updates_do_not_query_world_and_valid_work_is_bounded() {
        let mut gun = GunSimulation::new(vec![]).unwrap();
        for dt in [f64::NAN, f64::INFINITY, -1.0, 0.0, 11.0] {
            gun.step(dt, true, ORIGIN, FORWARD, None, |_| {
                panic!("invalid tick queried world")
            });
        }
        assert_eq!(gun.total_shots, 0);
        let mut queries = 0;
        gun.step(0.01, true, ORIGIN, FORWARD, None, |_| {
            queries += 1;
            false
        });
        assert!(queries <= 721);
        assert_eq!(gun.total_shots, 1);
    }
}
