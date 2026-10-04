use crate::flight::Vec3;
use crate::weapons::{
    MAX_PACKET_BOMBS, MAX_PACKET_EXPLOSIONS, MAX_PACKET_TARGETS, WeaponConfig, WeaponEvents,
    WeaponSimulation, WeaponTarget,
};
use crate::world_abi::world_from_handle;

const INPUT_LEN: usize = 51;
const OUTPUT_LEN: usize =
    10 + MAX_PACKET_BOMBS * 7 + MAX_PACKET_EXPLOSIONS * 6 + MAX_PACKET_TARGETS;

struct WeaponKernel {
    input: [f64; INPUT_LEN],
    output: [f64; OUTPUT_LEN],
    simulation: Option<WeaponSimulation>,
    world_handle: usize,
}

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "env")]
unsafe extern "C" {
    fn surface_height(x: f64, z: f64, from_y: f64) -> f64;
}

fn callback_surface(x: f64, z: f64, from_y: f64) -> f64 {
    #[cfg(target_arch = "wasm32")]
    {
        unsafe { surface_height(x, z, from_y) }
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = (x, z, from_y);
        0.0
    }
}

fn count(value: f64, maximum: usize) -> Option<usize> {
    if value.is_finite() && value >= 0.0 && value.fract() == 0.0 && value <= maximum as f64 {
        Some(value as usize)
    } else {
        None
    }
}

fn configured(input: &[f64; INPUT_LEN]) -> Option<WeaponSimulation> {
    let config = WeaponConfig {
        capacity: count(input[0], MAX_PACKET_BOMBS)?,
        gravity: input[1],
        drop_cooldown: input[2],
        reload_time: input[3],
        blast_radius: input[4],
        explosion_lifetime: input[5],
        max_bombs: count(input[6], MAX_PACKET_BOMBS)?,
        max_explosions: count(input[7], MAX_PACKET_EXPLOSIONS)?,
        max_substep: input[8],
        max_substeps: count(input[9], 600)?,
        timer_epsilon: input[10],
    };
    let targets = (0..count(input[11], MAX_PACKET_TARGETS)?)
        .map(|index| WeaponTarget {
            x: input[12 + index * 2],
            z: input[13 + index * 2],
        })
        .collect();
    WeaponSimulation::new(config, targets)
}

impl WeaponKernel {
    fn write_output(&mut self, events: WeaponEvents) {
        self.output.fill(0.0);
        let Some(state) = &self.simulation else {
            return;
        };
        self.output[..10].copy_from_slice(&[
            state.ammo as f64,
            state.reload_remaining,
            state.cooldown,
            state.score as f64,
            state.next_id,
            state.bombs.len() as f64,
            state.explosions.len() as f64,
            state.hit_target_indices.len() as f64,
            events.impacts as f64,
            events.hits as f64,
        ]);
        for (index, bomb) in state.bombs.iter().enumerate() {
            let start = 10 + index * 7;
            self.output[start..start + 7].copy_from_slice(&[
                bomb.id,
                bomb.position.x,
                bomb.position.y,
                bomb.position.z,
                bomb.velocity.x,
                bomb.velocity.y,
                bomb.velocity.z,
            ]);
        }
        for (index, explosion) in state.explosions.iter().enumerate() {
            let start = 10 + MAX_PACKET_BOMBS * 7 + index * 6;
            self.output[start..start + 6].copy_from_slice(&[
                explosion.id,
                explosion.position.x,
                explosion.position.y,
                explosion.position.z,
                explosion.age,
                explosion.hit_count as f64,
            ]);
        }
        for (index, target) in state.hit_target_indices.iter().enumerate() {
            self.output[10 + MAX_PACKET_BOMBS * 7 + MAX_PACKET_EXPLOSIONS * 6 + index] =
                *target as f64;
        }
    }
}

unsafe fn kernel(handle: usize) -> Option<&'static mut WeaponKernel> {
    if handle == 0 {
        None
    } else {
        unsafe { (handle as *mut WeaponKernel).as_mut() }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn weapons_input_len() -> usize {
    INPUT_LEN
}
#[unsafe(no_mangle)]
pub extern "C" fn weapons_output_len() -> usize {
    OUTPUT_LEN
}
#[unsafe(no_mangle)]
pub extern "C" fn weapons_new(world_handle: usize) -> usize {
    Box::into_raw(Box::new(WeaponKernel {
        input: [0.0; INPUT_LEN],
        output: [0.0; OUTPUT_LEN],
        simulation: None,
        world_handle,
    })) as usize
}
#[unsafe(no_mangle)]
pub extern "C" fn weapons_input_ptr(handle: usize) -> usize {
    unsafe { kernel(handle) }.map_or(0, |kernel| kernel.input.as_mut_ptr() as usize)
}
#[unsafe(no_mangle)]
pub extern "C" fn weapons_output_ptr(handle: usize) -> usize {
    unsafe { kernel(handle) }.map_or(0, |kernel| kernel.output.as_mut_ptr() as usize)
}
#[unsafe(no_mangle)]
pub extern "C" fn weapons_configure(handle: usize) -> i32 {
    let Some(kernel) = (unsafe { kernel(handle) }) else {
        return 0;
    };
    let Some(simulation) = configured(&kernel.input) else {
        return 0;
    };
    kernel.simulation = Some(simulation);
    kernel.write_output(WeaponEvents::default());
    1
}
#[unsafe(no_mangle)]
pub extern "C" fn weapons_reset(handle: usize) {
    let Some(kernel) = (unsafe { kernel(handle) }) else {
        return;
    };
    if let Some(state) = &mut kernel.simulation {
        state.reset();
    }
    kernel.write_output(WeaponEvents::default());
}
#[unsafe(no_mangle)]
pub extern "C" fn weapons_drop(handle: usize) -> i32 {
    let Some(kernel) = (unsafe { kernel(handle) }) else {
        return 0;
    };
    let dropped = kernel.simulation.as_mut().is_some_and(|state| {
        state.drop_bomb(
            Vec3 {
                x: kernel.input[44],
                y: kernel.input[45],
                z: kernel.input[46],
            },
            Vec3 {
                x: kernel.input[47],
                y: kernel.input[48],
                z: kernel.input[49],
            },
        )
    });
    kernel.write_output(WeaponEvents::default());
    i32::from(dropped)
}
#[unsafe(no_mangle)]
pub extern "C" fn weapons_step(handle: usize) {
    let Some(kernel) = (unsafe { kernel(handle) }) else {
        return;
    };
    let world_handle = kernel.world_handle;
    let events = if let Some(state) = &mut kernel.simulation {
        if world_handle == 0 {
            // Independent migration tests supply artificial ridges/decks via the
            // legacy import. Production always uses the native world's handle.
            state.step(kernel.input[50], callback_surface)
        } else if let Some(world) = unsafe { world_from_handle(world_handle) } {
            state.step(kernel.input[50], |x, z, from_y| {
                world.flight_surface_height(x, z, from_y)
            })
        } else {
            WeaponEvents::default()
        }
    } else {
        WeaponEvents::default()
    };
    kernel.write_output(events);
}
#[unsafe(no_mangle)]
pub extern "C" fn weapons_free(handle: usize) {
    if handle != 0 {
        unsafe {
            drop(Box::from_raw(handle as *mut WeaponKernel));
        }
    }
}
