use crate::flight::{
    FlightConfig, FlightInput, FlightMode, FlightState, GROUND_CLEARANCE, MAX_STEP, Vec3,
    advance_flight, apply_terrain,
};
use crate::wind::{WindDescription, describe_wind, sample_wind_speed};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WorldBounds {
    pub min_x: f64,
    pub max_x: f64,
    pub min_z: f64,
    pub max_z: f64,
    pub max_altitude: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TickParameters {
    pub input: FlightInput,
    pub dt: f64,
    pub clock: f64,
    pub mode: FlightMode,
    pub config: FlightConfig,
    pub wind_base_speed: f64,
    pub wind_direction: f64,
    pub bounds: Option<WorldBounds>,
    /// Tests can exercise the previous constant-wind flight API exactly.
    pub wind_override: Option<Vec3>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SimulationResult {
    pub clock: f64,
    pub wind: Vec3,
    pub wind_description: WindDescription,
    pub boundary_contact: bool,
    pub obstacle_contact: bool,
}

/// One unified simulation tick, including callbacks into the existing terrain
/// and obstacle grid. No allocation or retained global simulation state occurs.
pub fn simulate(
    state: &mut FlightState,
    parameters: TickParameters,
    mut surface_height: impl FnMut(f64, f64, f64) -> f64,
    mut obstacle_hit: impl FnMut(Vec3) -> bool,
) -> SimulationResult {
    let mut clock = parameters.clock;
    let mut boundary_contact = false;
    let mut obstacle_contact = false;
    if parameters.dt.is_finite() && parameters.dt > 0.0 {
        let time = parameters.dt.min(MAX_STEP);
        let previous = state.position;
        let wind = parameters.wind_override.unwrap_or_else(|| {
            sample_wind_speed(
                parameters.wind_base_speed,
                parameters.wind_direction,
                clock + time * 0.5,
                previous,
            )
        });
        advance_flight(
            state,
            parameters.input,
            time,
            parameters.mode,
            parameters.config,
            wind,
        );
        apply_terrain(
            state,
            surface_height(state.position.x, state.position.z, previous.y),
        );
        clock += time;

        // Preserve the former engine's terrain -> bounds -> obstacle order.
        if let Some(bounds) = parameters.bounds {
            let x = state.position.x.clamp(bounds.min_x, bounds.max_x);
            let z = state.position.z.clamp(bounds.min_z, bounds.max_z);
            let terrain = surface_height(x, z, previous.y);
            let floor = if terrain.is_finite() { terrain } else { 0.0 } + GROUND_CLEARANCE;
            let constrained = Vec3 {
                x,
                z,
                y: state
                    .position
                    .y
                    .clamp(floor, floor.max(bounds.max_altitude)),
            };
            if constrained != state.position {
                state.position = constrained;
                state.velocity = Vec3::default();
                boundary_contact = true;
            }
            if obstacle_hit(state.position) {
                state.position = previous;
                state.velocity = Vec3::default();
                obstacle_contact = true;
            }
        }
    }

    let mut wind = parameters.wind_override.unwrap_or_else(|| {
        sample_wind_speed(
            parameters.wind_base_speed,
            parameters.wind_direction,
            clock,
            state.position,
        )
    });
    // A direct test override has the same finite-vector telemetry contract as
    // sampled wind, while finite extremes still reach advance's existing clamp.
    for component in [&mut wind.x, &mut wind.y, &mut wind.z] {
        if !component.is_finite() {
            *component = 0.0;
        }
    }
    SimulationResult {
        clock,
        wind,
        wind_description: describe_wind(wind, state.yaw),
        boundary_contact,
        obstacle_contact,
    }
}
