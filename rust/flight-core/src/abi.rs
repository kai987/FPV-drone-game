//! Fixed-buffer ABI version 1. A handle owns two Box-backed f64 arrays; callers
//! write input, run one tick and read output without per-frame allocation.
//!
//! Handles/pointers must only originate from this module and remain live until
//! `simulation_free`. The TypeScript owner prevents use after free and reentry.

use crate::flight::{FlightConfig, FlightInput, FlightMode, FlightState, Vec3};
use crate::simulation::{TickParameters, WorldBounds, simulate};

const INPUT_LEN: usize = 36;
const OUTPUT_LEN: usize = 22;

struct SimulationBuffers {
    input: [f64; INPUT_LEN],
    output: [f64; OUTPUT_LEN],
}

#[unsafe(no_mangle)]
pub extern "C" fn abi_version() -> u32 {
    1
}

#[unsafe(no_mangle)]
pub extern "C" fn input_len() -> usize {
    INPUT_LEN
}

#[unsafe(no_mangle)]
pub extern "C" fn output_len() -> usize {
    OUTPUT_LEN
}

#[unsafe(no_mangle)]
pub extern "C" fn simulation_new() -> usize {
    Box::into_raw(Box::new(SimulationBuffers {
        input: [0.0; INPUT_LEN],
        output: [0.0; OUTPUT_LEN],
    })) as usize
}

/// # Safety
/// The handle must be a live value returned by `simulation_new`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn simulation_input_ptr(handle: usize) -> *mut f64 {
    if handle == 0 {
        return std::ptr::null_mut();
    }
    unsafe {
        (&mut *(handle as *mut SimulationBuffers))
            .input
            .as_mut_ptr()
    }
}

/// # Safety
/// The handle must be a live value returned by `simulation_new`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn simulation_output_ptr(handle: usize) -> *mut f64 {
    if handle == 0 {
        return std::ptr::null_mut();
    }
    unsafe {
        (&mut *(handle as *mut SimulationBuffers))
            .output
            .as_mut_ptr()
    }
}

/// # Safety
/// The handle must be live, owned by the caller, and freed exactly once.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn simulation_free(handle: usize) {
    if handle != 0 {
        unsafe {
            drop(Box::from_raw(handle as *mut SimulationBuffers));
        }
    }
}

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "env")]
unsafe extern "C" {
    fn surface_height(x: f64, z: f64, from_y: f64) -> f64;
    fn obstacle_hit(x: f64, y: f64, z: f64) -> i32;
}

#[cfg(target_arch = "wasm32")]
fn query_surface(x: f64, z: f64, from_y: f64) -> f64 {
    unsafe { surface_height(x, z, from_y) }
}

#[cfg(target_arch = "wasm32")]
fn query_obstacle(position: Vec3) -> bool {
    unsafe { obstacle_hit(position.x, position.y, position.z) != 0 }
}

// Native builds run tests through simulate's injected callbacks, without host imports.
#[cfg(not(target_arch = "wasm32"))]
fn query_surface(_: f64, _: f64, _: f64) -> f64 {
    0.0
}

#[cfg(not(target_arch = "wasm32"))]
fn query_obstacle(_: Vec3) -> bool {
    false
}

/// # Safety
/// The handle must be live and calls must not reenter or mutate its input buffer.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn simulate_tick(handle: usize) {
    if handle == 0 {
        return;
    }
    let buffers = unsafe { &mut *(handle as *mut SimulationBuffers) };
    let input = &buffers.input;
    let mut state = FlightState {
        position: Vec3 {
            x: input[0],
            y: input[1],
            z: input[2],
        },
        velocity: Vec3 {
            x: input[3],
            y: input[4],
            z: input[5],
        },
        yaw: input[6],
        pitch: input[7],
        roll: input[8],
        collision: input[9] != 0.0,
    };
    let result = simulate(
        &mut state,
        TickParameters {
            input: FlightInput {
                forward: input[10],
                strafe: input[11],
                climb: input[12],
                yaw: input[13],
                look_pitch: input[14],
            },
            dt: input[15],
            clock: input[16],
            mode: if input[17] == 1.0 {
                FlightMode::Sport
            } else {
                FlightMode::Assisted
            },
            config: FlightConfig {
                speed: input[18],
                climb_speed: input[19],
                response: input[20],
                brake: input[21],
                yaw_speed: input[22],
                bank: input[23],
            },
            wind_base_speed: input[24],
            wind_direction: input[25],
            bounds: if input[26] != 0.0 {
                Some(WorldBounds {
                    min_x: input[27],
                    max_x: input[28],
                    min_z: input[29],
                    max_z: input[30],
                    max_altitude: input[31],
                })
            } else {
                None
            },
            wind_override: if input[32] != 0.0 {
                Some(Vec3 {
                    x: input[33],
                    y: input[34],
                    z: input[35],
                })
            } else {
                None
            },
        },
        query_surface,
        query_obstacle,
    );
    let description = result.wind_description;
    let sector = |value: u32| -> f64 {
        match value {
            8 => -1.0,
            9 => -2.0,
            _ => value as f64,
        }
    };
    buffers.output = [
        state.position.x,
        state.position.y,
        state.position.z,
        state.velocity.x,
        state.velocity.y,
        state.velocity.z,
        state.yaw,
        state.pitch,
        state.roll,
        f64::from(state.collision),
        result.clock,
        result.wind.x,
        result.wind.y,
        result.wind.z,
        description.speed,
        description.from_degrees,
        description.headwind,
        description.crosswind,
        sector(description.direction_sector),
        sector(description.relative_sector),
        f64::from(result.boundary_contact),
        f64::from(result.obstacle_contact),
    ];
}
