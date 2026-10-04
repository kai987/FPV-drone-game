//! World ABI: one configuration upload and reusable query/batch buffers.
use crate::flight::Vec3;
use crate::world::{Obstacle, UrbanBox, World};
pub const TERRAIN_BATCH_CAPACITY: usize = 1024;
struct WorldBuffers {
    config: Vec<f64>,
    world: Option<World>,
    query: [f64; 4],
    batch_input: [f64; TERRAIN_BATCH_CAPACITY * 2],
    batch_output: [f64; TERRAIN_BATCH_CAPACITY * 2],
    obstacle_input: Vec<f64>,
    box_input: Vec<f64>,
}

/// # Safety
/// The handle must be zero or a live world_new allocation. The world must not
/// be mutated or freed while the returned reference is in use.
pub(crate) unsafe fn world_from_handle<'a>(handle: usize) -> Option<&'a World> {
    if handle == 0 {
        None
    } else {
        unsafe { (&*(handle as *const WorldBuffers)).world.as_ref() }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn world_new(config_len: usize) -> usize {
    if config_len > 1_000_000 {
        return 0;
    }
    Box::into_raw(Box::new(WorldBuffers {
        config: vec![0.0; config_len],
        world: None,
        query: [0.0; 4],
        batch_input: [0.0; TERRAIN_BATCH_CAPACITY * 2],
        batch_output: [0.0; TERRAIN_BATCH_CAPACITY * 2],
        obstacle_input: Vec::new(),
        box_input: Vec::new(),
    })) as usize
}
/// # Safety
/// handle must be live.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn world_config_ptr(handle: usize) -> *mut f64 {
    unsafe { (&mut *(handle as *mut WorldBuffers)).config.as_mut_ptr() }
}
/// # Safety
/// handle must be live, with a fully uploaded configuration packet.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn world_configure(handle: usize) -> u32 {
    let buffer = unsafe { &mut *(handle as *mut WorldBuffers) };
    let Some(world) = World::from_packet(&buffer.config) else {
        return 0;
    };
    buffer.world = Some(world);
    1
}
/// # Safety
/// handle must be live and configured. kind is valley=0, factory=1, harbor=2.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn world_set_map_kind(handle: usize, kind: u32) -> u32 {
    let buffer = unsafe { &mut *(handle as *mut WorldBuffers) };
    buffer
        .world
        .as_mut()
        .map_or(0, |world| u32::from(world.set_map_kind(kind)))
}
/// # Safety
/// handle must be live.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn world_query_ptr(handle: usize) -> *mut f64 {
    unsafe { (&mut *(handle as *mut WorldBuffers)).query.as_mut_ptr() }
}
/// # Safety
/// handle must be live and configured. query contains x,z,param.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn world_query(handle: usize, kind: u32) -> f64 {
    let buffer = unsafe { &*(handle as *const WorldBuffers) };
    let Some(world) = buffer.world.as_ref() else {
        return f64::NAN;
    };
    let [x, z, param, _] = buffer.query;
    match kind {
        0 => world.ground_height(x, z),
        1 => world.water_distance(x, z),
        2 => f64::from(world.is_water(x, z)),
        3 => world.surface_height(x, z),
        4 => world.flight_surface_height(x, z, param),
        5 => f64::from(world.clearance(x, z, param)),
        6 => f64::from(world.intersects_obstacle(Vec3 { x, y: param, z })),
        _ => f64::NAN,
    }
}
#[unsafe(no_mangle)]
pub extern "C" fn world_batch_capacity() -> usize {
    TERRAIN_BATCH_CAPACITY
}
/// # Safety
/// handle must be live.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn world_batch_input_ptr(handle: usize) -> *mut f64 {
    unsafe {
        (&mut *(handle as *mut WorldBuffers))
            .batch_input
            .as_mut_ptr()
    }
}
/// # Safety
/// handle must be live.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn world_batch_output_ptr(handle: usize) -> *mut f64 {
    unsafe {
        (&mut *(handle as *mut WorldBuffers))
            .batch_output
            .as_mut_ptr()
    }
}
/// # Safety
/// handle must be live and input holds count consecutive x,z pairs.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn world_sample_terrain(handle: usize, count: usize) -> usize {
    if count > TERRAIN_BATCH_CAPACITY {
        return 0;
    }
    let buffer = unsafe { &mut *(handle as *mut WorldBuffers) };
    let Some(world) = buffer.world.as_ref() else {
        return 0;
    };
    for index in 0..count {
        let x = buffer.batch_input[index * 2];
        let z = buffer.batch_input[index * 2 + 1];
        buffer.batch_output[index * 2] = world.ground_height(x, z);
        buffer.batch_output[index * 2 + 1] = world.water_distance(x, z);
    }
    count
}
/// # Safety
/// handle must be live. Allocates only while uploading/replacing static obstacles.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn world_obstacles_alloc(handle: usize, count: usize) -> *mut f64 {
    if count > 100_000 {
        return std::ptr::null_mut();
    }
    let buffer = unsafe { &mut *(handle as *mut WorldBuffers) };
    buffer.obstacle_input.resize(count * 6, 0.0);
    buffer.obstacle_input.as_mut_ptr()
}
/// # Safety
/// handle must be live with count complete obstacle rows x,z,radius,height,base,roof.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn world_set_obstacles(handle: usize, count: usize) -> u32 {
    let buffer = unsafe { &mut *(handle as *mut WorldBuffers) };
    if buffer.obstacle_input.len() != count * 6 {
        return 0;
    }
    let Some(world) = buffer.world.as_mut() else {
        return 0;
    };
    let mut obstacles = Vec::with_capacity(count);
    for v in buffer.obstacle_input.chunks_exact(6) {
        if !v[..4].iter().all(|x| x.is_finite()) || v[2] < 0.0 || v[2] > 10_000.0 || v[4].is_nan() {
            return 0;
        }
        obstacles.push(Obstacle {
            x: v[0],
            z: v[1],
            radius: v[2],
            height: v[3],
            base: v[4],
            roof: v[5] != 0.0,
        });
    }
    world.set_obstacles(obstacles);
    1
}
/// # Safety
/// handle must be live. Allocates only while uploading/replacing static boxes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn world_boxes_alloc(handle: usize, count: usize) -> *mut f64 {
    if count > 100_000 {
        return std::ptr::null_mut();
    }
    let buffer = unsafe { &mut *(handle as *mut WorldBuffers) };
    buffer.box_input.resize(count * 7, 0.0);
    buffer.box_input.as_mut_ptr()
}
/// # Safety
/// handle must be live with count complete rows x,z,width,depth,base,height,yaw.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn world_set_boxes(handle: usize, count: usize) -> u32 {
    let buffer = unsafe { &mut *(handle as *mut WorldBuffers) };
    if count > 100_000 || buffer.box_input.len() != count * 7 {
        return 0;
    }
    let Some(world) = buffer.world.as_mut() else {
        return 0;
    };
    let mut boxes = Vec::with_capacity(count);
    for v in buffer.box_input.chunks_exact(7) {
        if !v.iter().all(|value| value.is_finite())
            || !(0.0..=10_000.0).contains(&v[2])
            || !(0.0..=10_000.0).contains(&v[3])
            || v[2] == 0.0
            || v[3] == 0.0
            || v[5] <= 0.0
            || !(v[4] + v[5]).is_finite()
        {
            return 0;
        }
        boxes.push(UrbanBox {
            x: v[0],
            z: v[1],
            width: v[2],
            depth: v[3],
            base: v[4],
            height: v[5],
            yaw: v[6],
        });
    }
    world.set_boxes(boxes);
    1
}
/// # Safety
/// handle must be a live owned allocation, and must be freed once.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn world_free(handle: usize) {
    if handle != 0 {
        unsafe {
            drop(Box::from_raw(handle as *mut WorldBuffers));
        }
    }
}
