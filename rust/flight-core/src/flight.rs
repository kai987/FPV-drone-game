use std::f64::consts::{PI, TAU};

pub const MAX_STEP: f64 = 0.06;
pub const GROUND_CLEARANCE: f64 = 1.8;
const PITCH_LIMIT: f64 = 0.75;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Vec3 {
    pub fn length(self) -> f64 {
        self.x.hypot(self.y).hypot(self.z)
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct FlightInput {
    pub forward: f64,
    pub strafe: f64,
    pub climb: f64,
    pub yaw: f64,
    pub look_pitch: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FlightState {
    pub position: Vec3,
    pub velocity: Vec3,
    pub yaw: f64,
    pub pitch: f64,
    pub roll: f64,
    pub collision: bool,
}

impl Default for FlightState {
    fn default() -> Self {
        Self {
            position: Vec3 {
                x: 0.0,
                y: 12.0,
                z: 55.0,
            },
            velocity: Vec3::default(),
            yaw: 0.0,
            pitch: 0.0,
            roll: 0.0,
            collision: false,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum FlightMode {
    #[default]
    Assisted,
    Sport,
}

/// Already resolved catalogue values. Aircraft and boost tuning stay in TS.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FlightConfig {
    pub speed: f64,
    pub climb_speed: f64,
    pub response: f64,
    pub brake: f64,
    pub yaw_speed: f64,
    pub bank: f64,
}

fn axis(value: f64) -> f64 {
    if value.is_finite() {
        value.clamp(-1.0, 1.0)
    } else {
        0.0
    }
}

fn bounded_wind(value: f64) -> f64 {
    if value.is_finite() {
        value.clamp(-50.0, 50.0)
    } else {
        0.0
    }
}

fn wrap_angle(angle: f64) -> f64 {
    ((angle + PI) % TAU + TAU) % TAU - PI
}

/// Integrate once before querying terrain at the resulting x/z position.
/// Returns false for invalid or paused time, leaving every state field intact.
pub fn advance_flight(
    state: &mut FlightState,
    input: FlightInput,
    dt: f64,
    mode: FlightMode,
    config: FlightConfig,
    wind: Vec3,
) -> bool {
    if !dt.is_finite() || dt <= 0.0 {
        return false;
    }
    let time = dt.min(MAX_STEP);
    let forward = axis(input.forward);
    let strafe = axis(input.strafe);
    let climb = axis(input.climb);
    let yaw_input = axis(input.yaw);

    state.collision = false;
    state.yaw = wrap_angle(state.yaw + yaw_input * config.yaw_speed * time);
    state.pitch =
        (state.pitch + axis(input.look_pitch) * 1.25 * time).clamp(-PITCH_LIMIT, PITCH_LIMIT);

    let horizontal_input_length = forward.hypot(strafe).max(1.0);
    let thrust = forward / horizontal_input_length;
    let side_thrust = strafe / horizontal_input_length;
    let sin_yaw = state.yaw.sin();
    let cos_yaw = state.yaw.cos();
    let cos_pitch = state.pitch.cos();
    let mut target = Vec3 {
        x: (-sin_yaw * cos_pitch * thrust + cos_yaw * side_thrust) * config.speed,
        y: state.pitch.sin() * thrust * config.speed + climb * config.climb_speed,
        z: (-cos_yaw * cos_pitch * thrust - sin_yaw * side_thrust) * config.speed,
    };

    // Climb and diagonal input cannot exceed the existing airspeed ceiling.
    let target_length = target.length();
    if target_length > config.speed {
        let scale = config.speed / target_length;
        target.x *= scale;
        target.y *= scale;
        target.z *= scale;
    }

    let wind_x = bounded_wind(wind.x);
    let wind_y = bounded_wind(wind.y);
    let wind_z = bounded_wind(wind.z);
    let has_wind = wind_x != 0.0 || wind_y != 0.0 || wind_z != 0.0;
    if has_wind {
        let influence = match mode {
            FlightMode::Assisted => 0.35,
            FlightMode::Sport => 0.85,
        };
        target.x += wind_x * influence;
        target.y += wind_y * influence;
        target.z += wind_z * influence;
    }

    let active_thrust = forward.abs() + strafe.abs() + climb.abs() > 0.001;
    let response = if active_thrust {
        config.response
    } else {
        config.brake
    };
    let decay = (-response * time).exp();
    let integral = (1.0 - decay) / response;

    fn integrate(
        position: &mut f64,
        velocity: &mut f64,
        target: f64,
        time: f64,
        integral: f64,
        decay: f64,
    ) {
        let old_velocity = *velocity;
        *position += target * time + (old_velocity - target) * integral;
        *velocity = target + (old_velocity - target) * decay;
    }
    integrate(
        &mut state.position.x,
        &mut state.velocity.x,
        target.x,
        time,
        integral,
        decay,
    );
    integrate(
        &mut state.position.y,
        &mut state.velocity.y,
        target.y,
        time,
        integral,
        decay,
    );
    integrate(
        &mut state.position.z,
        &mut state.velocity.z,
        target.z,
        time,
        integral,
        decay,
    );

    let mut target_roll = ((-strafe * 0.8 + yaw_input * 0.6) * config.bank).clamp(-0.45, 0.45);
    if has_wind {
        target_roll =
            (target_roll + (wind_x * cos_yaw - wind_z * sin_yaw) * 0.008).clamp(-0.45, 0.45);
    }
    state.roll += (target_roll - state.roll) * (1.0 - (-7.0 * time).exp());
    true
}

/// Apply the same contact response after terrain has been sampled at the new position.
pub fn apply_terrain(state: &mut FlightState, terrain: f64) {
    let floor = if terrain.is_finite() { terrain } else { 0.0 } + GROUND_CLEARANCE;
    if state.position.y < floor {
        state.position.y = floor;
        state.velocity.y = (state.velocity.y.min(0.0).abs() * 0.18).min(1.2);
        state.velocity.x *= 0.65;
        state.velocity.z *= 0.65;
        state.collision = true;
    }
}

/// Native/test convenience wrapper. The WASM tick invokes its terrain import
/// after integration and then applies the same contact response.
pub fn step_flight(
    state: &mut FlightState,
    input: FlightInput,
    dt: f64,
    mode: FlightMode,
    ground_height: impl FnOnce(f64, f64) -> f64,
    config: FlightConfig,
    wind: Vec3,
) {
    if advance_flight(state, input, dt, mode, config, wind) {
        apply_terrain(state, ground_height(state.position.x, state.position.z));
    }
}
