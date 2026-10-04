//! Initialization-only scene generation and reusable batches.
use crate::scene::{LakeEdge, Point, RiverPoint, SceneConfig, ripple_texture, terrain_color};
use crate::world_abi::world_from_handle;
const BATCH: usize = 512;
struct SceneBuffers {
    config_input: Vec<f64>,
    config: Option<SceneConfig>,
    output: Vec<f64>,
    input: [f64; BATCH * 8 + 13],
    batch_output: [f64; BATCH * 4],
}
fn count(value: f64, max: usize) -> Option<usize> {
    if value.is_finite() && value >= 0.0 && value.floor() == value && value <= max as f64 {
        Some(value as usize)
    } else {
        None
    }
}
fn parse(input: &[f64]) -> Option<SceneConfig> {
    if input.len() < 10 || input.iter().any(|v| !v.is_finite()) {
        return None;
    }
    let mut i = 10;
    let course_count = count(input[6], 4096)?;
    let target_count = count(input[7], 128)?;
    let river_count = count(input[8], 4096)?;
    let lake_count = count(input[9], 32)?;
    if course_count < 2 || river_count < 2 || lake_count == 0 {
        return None;
    }
    let mut take = |length: usize| {
        let values = input.get(i..i + length);
        i += length;
        values
    };
    let course = take(course_count * 2)?
        .chunks_exact(2)
        .map(|p| Point { x: p[0], z: p[1] })
        .collect();
    let targets = take(target_count * 3)?
        .chunks_exact(3)
        .map(|p| (Point { x: p[0], z: p[1] }, p[2]))
        .collect();
    let river = take(river_count * 3)?
        .chunks_exact(3)
        .map(|p| RiverPoint {
            point: Point { x: p[0], z: p[1] },
            width: p[2],
        })
        .collect();
    let mut lakes = Vec::new();
    for _ in 0..lake_count {
        let meta = take(6)?;
        let length = count(meta[5], 4096)?;
        if length < 3 || meta[2] <= 0.0 || meta[3] <= 0.0 {
            return None;
        }
        let boundary = take(length * 2)?
            .chunks_exact(2)
            .map(|p| Point { x: p[0], z: p[1] })
            .collect();
        lakes.push(LakeEdge {
            center: Point {
                x: meta[0],
                z: meta[1],
            },
            radius_x: meta[2],
            radius_z: meta[3],
            rotation: meta[4],
            boundary,
        });
    }
    Some(SceneConfig {
        seed: count(input[0], u32::MAX as usize)? as u32,
        skip: count(input[1], 1000000)?,
        bounds: [input[2], input[3], input[4], input[5]],
        course,
        targets,
        river,
        lakes,
    })
}
#[unsafe(no_mangle)]
pub extern "C" fn scene_new(length: usize) -> usize {
    if !(10..=100000).contains(&length) {
        return 0;
    }
    Box::into_raw(Box::new(SceneBuffers {
        config_input: vec![0.0; length],
        config: None,
        output: Vec::new(),
        input: [0.0; BATCH * 8 + 13],
        batch_output: [0.0; BATCH * 4],
    })) as usize
}
/// # Safety
/// Handle must be live and exclusively owned by the host.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn scene_config_ptr(handle: usize) -> *mut f64 {
    unsafe {
        (&mut *(handle as *mut SceneBuffers))
            .config_input
            .as_mut_ptr()
    }
}
/// # Safety
/// Handle must be live and exclusively owned by the host.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn scene_input_ptr(handle: usize) -> *mut f64 {
    unsafe { (&mut *(handle as *mut SceneBuffers)).input.as_mut_ptr() }
}
/// # Safety
/// Both handles must be live in this WASM instance; no concurrent mutation.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn scene_generate(handle: usize, world_handle: usize) -> i32 {
    if handle == 0 {
        return 0;
    }
    let buffers = unsafe { &mut *(handle as *mut SceneBuffers) };
    let Some(world) = (unsafe { world_from_handle(world_handle) }) else {
        return 0;
    };
    let Some(config) = parse(&buffers.config_input) else {
        return 0;
    };
    let data = config.generate(world);
    buffers.output = vec![
        (data.trees.len() / 7) as f64,
        (data.rocks.len() / 12) as f64,
        (data.banks.len() / 12) as f64,
        (data.shrubs.len() / 5) as f64,
    ];
    buffers.output.extend(data.trees);
    buffers.output.extend(data.rocks);
    buffers.output.extend(data.banks);
    buffers.output.extend(data.shrubs);
    buffers.config = Some(config);
    1
}
/// # Safety
/// Handle must be live. Returned pointer is invalidated by scene_generate/free.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn scene_output_ptr(handle: usize) -> *const f64 {
    unsafe { (&*(handle as *const SceneBuffers)).output.as_ptr() }
}
/// # Safety
/// Handle must be live.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn scene_output_len(handle: usize) -> usize {
    unsafe { (&*(handle as *const SceneBuffers)).output.len() }
}
/// # Safety
/// Handle must be live.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn scene_batch_ptr(handle: usize) -> *const f64 {
    unsafe { (&*(handle as *const SceneBuffers)).batch_output.as_ptr() }
}
/// # Safety
/// Handle must be live; count at most BATCH; input 13 palette/spacing values + 8 per point.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn scene_colors(handle: usize, count: usize) {
    if handle == 0 || count > BATCH {
        return;
    }
    let b = unsafe { &mut *(handle as *mut SceneBuffers) };
    for index in 0..count {
        let offset = 13 + index * 8;
        let color = terrain_color(&b.input[..12], &b.input[offset..offset + 8], b.input[12]);
        b.batch_output[index * 3..index * 3 + 3].copy_from_slice(&color);
    }
}
/// # Safety
/// Handle must be configured/live; input x,z,ground triples; count at most BATCH.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn scene_water(
    handle: usize,
    world_handle: usize,
    count: usize,
    water_level: f64,
) {
    if handle == 0 || count > BATCH {
        return;
    }
    let b = unsafe { &mut *(handle as *mut SceneBuffers) };
    let Some(config) = &b.config else {
        return;
    };
    let Some(world) = (unsafe { world_from_handle(world_handle) }) else {
        return;
    };
    for index in 0..count {
        let p = index * 3;
        let depth = water_level - world.ground_height(b.input[p], b.input[p + 1]);
        let current = if depth > -6.0 {
            config.current(Point {
                x: b.input[p],
                z: b.input[p + 1],
            })
        } else {
            [0.0; 3]
        };
        let out = index * 4;
        b.batch_output[out] = depth;
        b.batch_output[out + 1..out + 4].copy_from_slice(&current);
    }
}
/// # Safety
/// Handle must be live and freed exactly once.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn scene_free(handle: usize) {
    if handle != 0 {
        unsafe {
            drop(Box::from_raw(handle as *mut SceneBuffers));
        }
    }
}
struct Ripple(Vec<u8>);
#[unsafe(no_mangle)]
pub extern "C" fn scene_ripple_new(size: usize) -> usize {
    if !(16..=512).contains(&size) {
        return 0;
    }
    Box::into_raw(Box::new(Ripple(ripple_texture(size)))) as usize
}
/// # Safety
/// Handle must be a live ripple handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn scene_ripple_ptr(handle: usize) -> *const u8 {
    unsafe { (&*(handle as *const Ripple)).0.as_ptr() }
}
/// # Safety
/// Handle must be a live ripple handle, freed exactly once.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn scene_ripple_free(handle: usize) {
    if handle != 0 {
        unsafe {
            drop(Box::from_raw(handle as *mut Ripple));
        }
    }
}
