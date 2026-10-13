use crate::flight::Vec3;
use crate::gun::{GunEvents, GunSimulation, GunTarget, MAX_IMPACTS, MAX_SHOTS, MAX_TARGETS};
use crate::world_abi::world_from_handle;

const STEP_OFFSET: usize = 1 + MAX_TARGETS * 4;
const INPUT_LEN: usize = STEP_OFFSET + 12;
const SHOT_OFFSET: usize = 9;
const IMPACT_OFFSET: usize = SHOT_OFFSET + MAX_SHOTS * 8;
const TARGET_OFFSET: usize = IMPACT_OFFSET + MAX_IMPACTS * 6;
const OUTPUT_LEN: usize = TARGET_OFFSET + MAX_TARGETS;

struct GunKernel {
    input: [f64; INPUT_LEN],
    output: [f64; OUTPUT_LEN],
    simulation: Option<GunSimulation>,
    world_handle: usize,
}
impl GunKernel {
    fn write(&mut self, events: GunEvents) {
        self.output.fill(0.0);
        let Some(state) = &self.simulation else {
            return;
        };
        self.output[..SHOT_OFFSET].copy_from_slice(&[
            state.ammo as f64,
            state.reload_remaining,
            state.score as f64,
            state.total_shots as f64,
            state.shots.len() as f64,
            state.impacts.len() as f64,
            state.hit_target_indices.len() as f64,
            events.shots as f64,
            events.hits as f64,
        ]);
        for (index, shot) in state.shots.iter().enumerate() {
            let start = SHOT_OFFSET + index * 8;
            self.output[start..start + 8].copy_from_slice(&[
                shot.id,
                shot.from.x,
                shot.from.y,
                shot.from.z,
                shot.to.x,
                shot.to.y,
                shot.to.z,
                shot.age,
            ]);
        }
        for (index, impact) in state.impacts.iter().enumerate() {
            let start = IMPACT_OFFSET + index * 6;
            self.output[start..start + 6].copy_from_slice(&[
                impact.id,
                impact.position.x,
                impact.position.y,
                impact.position.z,
                impact.age,
                f64::from(impact.hit),
            ]);
        }
        for (index, target) in state.hit_target_indices.iter().enumerate() {
            self.output[TARGET_OFFSET + index] = *target as f64;
        }
    }
}
unsafe fn kernel(handle: usize) -> Option<&'static mut GunKernel> {
    if handle == 0 {
        None
    } else {
        unsafe { (handle as *mut GunKernel).as_mut() }
    }
}
#[unsafe(no_mangle)]
pub extern "C" fn gun_input_len() -> usize {
    INPUT_LEN
}
#[unsafe(no_mangle)]
pub extern "C" fn gun_output_len() -> usize {
    OUTPUT_LEN
}
#[unsafe(no_mangle)]
pub extern "C" fn gun_new(world_handle: usize) -> usize {
    if world_handle == 0 {
        return 0;
    }
    Box::into_raw(Box::new(GunKernel {
        input: [0.0; INPUT_LEN],
        output: [0.0; OUTPUT_LEN],
        simulation: None,
        world_handle,
    })) as usize
}
#[unsafe(no_mangle)]
pub extern "C" fn gun_input_ptr(handle: usize) -> usize {
    unsafe { kernel(handle) }.map_or(0, |k| k.input.as_mut_ptr() as usize)
}
#[unsafe(no_mangle)]
pub extern "C" fn gun_output_ptr(handle: usize) -> usize {
    unsafe { kernel(handle) }.map_or(0, |k| k.output.as_mut_ptr() as usize)
}
#[unsafe(no_mangle)]
pub extern "C" fn gun_configure(handle: usize) -> i32 {
    let Some(k) = (unsafe { kernel(handle) }) else {
        return 0;
    };
    let count = k.input[0];
    if !count.is_finite() || count < 0.0 || count.fract() != 0.0 || count > MAX_TARGETS as f64 {
        return 0;
    }
    let Some(world) = (unsafe { world_from_handle(k.world_handle) }) else {
        return 0;
    };
    let mut targets = Vec::new();
    for index in 0..count as usize {
        let start = 1 + index * 4;
        let (x, y, z, radius) = (
            k.input[start],
            k.input[start + 1],
            k.input[start + 2],
            k.input[start + 3],
        );
        if !x.is_finite() || !y.is_finite() || !z.is_finite() {
            return 0;
        }
        targets.push(GunTarget {
            position: Vec3 {
                x,
                y: y.max(world.flight_surface_height(x, z, f64::INFINITY) + 0.7),
                z,
            },
            radius,
        });
    }
    let Some(state) = GunSimulation::new(targets) else {
        return 0;
    };
    k.simulation = Some(state);
    k.write(GunEvents::default());
    1
}
#[unsafe(no_mangle)]
pub extern "C" fn gun_reset(handle: usize) {
    let Some(k) = (unsafe { kernel(handle) }) else {
        return;
    };
    if let Some(state) = &mut k.simulation {
        state.reset();
    }
    k.write(GunEvents::default());
}
#[unsafe(no_mangle)]
pub extern "C" fn gun_step(handle: usize) {
    let Some(k) = (unsafe { kernel(handle) }) else {
        return;
    };
    let input = &k.input[STEP_OFFSET..];
    let events = match (&mut k.simulation, unsafe {
        world_from_handle(k.world_handle)
    }) {
        (Some(state), Some(world)) if input[1] == 0.0 || input[1] == 1.0 => {
            let origin = Vec3 {
                x: input[2],
                y: input[3],
                z: input[4],
            };
            let direction = Vec3 {
                x: input[5],
                y: input[6],
                z: input[7],
            };
            let aim_origin = if input[8] == 1.0 {
                Some(Vec3 {
                    x: input[9],
                    y: input[10],
                    z: input[11],
                })
            } else {
                None
            };
            state.step(
                input[0],
                input[1] == 1.0,
                origin,
                direction,
                aim_origin,
                |position| {
                    position.y <= world.flight_surface_height(position.x, position.z, origin.y)
                        || world.intersects_obstacle(position)
                },
            )
        }
        _ => GunEvents::default(),
    };
    k.write(events);
}
#[unsafe(no_mangle)]
pub extern "C" fn gun_free(handle: usize) {
    if handle != 0 {
        unsafe {
            drop(Box::from_raw(handle as *mut GunKernel));
        }
    }
}
