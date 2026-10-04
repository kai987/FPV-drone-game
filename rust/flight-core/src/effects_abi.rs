//! Handle-owned animation buffers. All layouts are validated before the first tick.
use crate::effects::Effects;
use crate::world_abi::world_from_handle;

#[unsafe(no_mangle)]
pub extern "C" fn effects_new(
    kind: u32,
    config_len: usize,
    input_len: usize,
    output_len: usize,
) -> usize {
    if kind > 2 || config_len > 2_000_000 || input_len > 2_000_000 || output_len > 2_000_000 {
        return 0;
    }
    Box::into_raw(Box::new(Effects::new(
        kind, config_len, input_len, output_len,
    ))) as usize
}

/// # Safety
/// `handle` must be a live effect handle; its returned buffer is caller-owned.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn effects_config_ptr(handle: usize) -> *mut f64 {
    if handle == 0 {
        return std::ptr::null_mut();
    }
    unsafe { (&mut *(handle as *mut Effects)).config.as_mut_ptr() }
}
/// # Safety
/// `handle` must be a live effect handle; its returned buffer is caller-owned.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn effects_input_ptr(handle: usize) -> *mut f64 {
    if handle == 0 {
        return std::ptr::null_mut();
    }
    unsafe { (&mut *(handle as *mut Effects)).input.as_mut_ptr() }
}
/// # Safety
/// `handle` must be a live effect handle; its returned buffer is caller-owned.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn effects_output_ptr(handle: usize) -> *mut f64 {
    if handle == 0 {
        return std::ptr::null_mut();
    }
    unsafe { (&mut *(handle as *mut Effects)).output.as_mut_ptr() }
}
/// # Safety
/// `handle` must be a live effect handle, exclusively owned for this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn effects_initialize(handle: usize) -> u32 {
    if handle == 0 {
        return 0;
    }
    u32::from(unsafe { (&mut *(handle as *mut Effects)).initialize() })
}
/// # Safety
/// Both handles must be live; callers must not reenter or mutate the buffers.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn effects_update(
    handle: usize,
    time: f64,
    world_handle: usize,
    night: u32,
) -> u32 {
    if handle == 0 {
        return 0;
    }
    let world = unsafe { world_from_handle(world_handle) };
    u32::from(unsafe { (&mut *(handle as *mut Effects)).update(time, world, night != 0) })
}
/// # Safety
/// Free each live effect handle exactly once, after all its views are unused.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn effects_free(handle: usize) {
    if handle != 0 {
        unsafe {
            drop(Box::from_raw(handle as *mut Effects));
        }
    }
}
