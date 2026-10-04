use flight_core::{
    FlightConfig, FlightInput, FlightMode, FlightState, TickParameters, Vec3, WindSettings,
    WindStrength, WorldBounds, describe_wind, sample_wind, simulate, step_flight,
};
use std::f64::consts::PI;

fn assisted() -> FlightConfig {
    FlightConfig {
        speed: 20.0,
        climb_speed: 10.0,
        response: 5.6,
        brake: 6.8,
        yaw_speed: 1.4,
        bank: 0.2,
    }
}

fn sport() -> FlightConfig {
    FlightConfig {
        speed: 34.0,
        climb_speed: 17.0,
        response: 3.2,
        brake: 2.8,
        yaw_speed: 1.7,
        bank: 0.34,
    }
}

fn forward() -> FlightInput {
    FlightInput {
        forward: 1.0,
        ..FlightInput::default()
    }
}

fn near(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() < tolerance,
        "{actual} differs from {expected}"
    );
}

fn near_vec(actual: Vec3, expected: Vec3, tolerance: f64) {
    near(actual.x, expected.x, tolerance);
    near(actual.y, expected.y, tolerance);
    near(actual.z, expected.z, tolerance);
}

fn parameters(dt: f64) -> TickParameters {
    TickParameters {
        input: forward(),
        dt,
        clock: 0.0,
        mode: FlightMode::Assisted,
        config: assisted(),
        wind_base_speed: 2.5,
        wind_direction: 315.0,
        bounds: None,
        wind_override: None,
    }
}

fn bounds() -> WorldBounds {
    WorldBounds {
        min_x: -100.0,
        max_x: 100.0,
        min_z: -100.0,
        max_z: 100.0,
        max_altitude: 100.0,
    }
}

fn fly(
    input: FlightInput,
    mode: FlightMode,
    config: FlightConfig,
    wind: Vec3,
    seconds: usize,
    fps: usize,
) -> FlightState {
    let mut state = FlightState::default();
    for _ in 0..seconds * fps {
        step_flight(
            &mut state,
            input,
            1.0 / fps as f64,
            mode,
            |_, _| 0.0,
            config,
            wind,
        );
    }
    state
}

#[test]
fn neutral_hover_and_forward_follow_camera_heading() {
    let hover = fly(
        FlightInput::default(),
        FlightMode::Assisted,
        assisted(),
        Vec3::default(),
        2,
        60,
    );
    assert_eq!(hover, FlightState::default());
    let north = fly(
        forward(),
        FlightMode::Assisted,
        assisted(),
        Vec3::default(),
        2,
        60,
    );
    assert!(north.position.z < 55.0);
    assert_eq!(north.position.x, 0.0);
    assert_eq!(north.position.y, 12.0);
    let mut west = FlightState {
        yaw: PI / 2.0,
        pitch: 0.3,
        ..FlightState::default()
    };
    step_flight(
        &mut west,
        forward(),
        1.0 / 60.0,
        FlightMode::Assisted,
        |_, _| 0.0,
        assisted(),
        Vec3::default(),
    );
    assert!(west.position.x < 0.0 && west.position.y > 12.0);
    near(west.position.z, 55.0, 1e-10);
}

#[test]
fn airspeed_ceiling_applies_to_diagonals_and_resolved_boost_config() {
    let fast = fly(
        forward(),
        FlightMode::Sport,
        sport(),
        Vec3::default(),
        6,
        60,
    );
    let ordinary = fly(
        forward(),
        FlightMode::Assisted,
        assisted(),
        Vec3::default(),
        6,
        60,
    );
    let boost_config = FlightConfig {
        speed: 29.0,
        ..assisted()
    };
    let boosted = fly(
        forward(),
        FlightMode::Assisted,
        boost_config,
        Vec3::default(),
        6,
        60,
    );
    let diagonal = fly(
        FlightInput {
            forward: 1.0,
            strafe: 1.0,
            climb: 1.0,
            ..FlightInput::default()
        },
        FlightMode::Assisted,
        assisted(),
        Vec3::default(),
        6,
        60,
    );
    assert!(fast.velocity.length() > boosted.velocity.length());
    assert!(boosted.velocity.length() > ordinary.velocity.length());
    assert!(diagonal.velocity.length() <= 20.0 + 1e-9);
    near(boosted.velocity.length(), 29.0, 1e-10);
}

#[test]
fn acceleration_and_constant_wind_travel_are_frame_rate_independent() {
    for (mode, config) in [
        (FlightMode::Assisted, assisted()),
        (FlightMode::Sport, sport()),
    ] {
        let input = FlightInput {
            forward: 1.0,
            strafe: 0.3,
            ..FlightInput::default()
        };
        let wind = Vec3 {
            x: -6.0,
            y: 0.2,
            z: 3.0,
        };
        let reference = fly(input, mode, config, wind, 4, 30);
        for fps in [60, 120] {
            let state = fly(input, mode, config, wind, 4, fps);
            near_vec(state.position, reference.position, 1e-8);
            near_vec(state.velocity, reference.velocity, 1e-8);
            near(state.roll, reference.roll, 1e-10);
        }
    }
}

#[test]
fn headwind_tailwind_and_assistance_keep_the_existing_ground_speed_effects() {
    for (mode, config, gain) in [
        (FlightMode::Assisted, assisted(), 0.35),
        (FlightMode::Sport, sport(), 0.85),
    ] {
        let calm = fly(forward(), mode, config, Vec3::default(), 10, 60);
        let head = fly(
            forward(),
            mode,
            config,
            Vec3 {
                x: 0.0,
                y: 0.0,
                z: 6.0,
            },
            10,
            60,
        );
        let tail = fly(
            forward(),
            mode,
            config,
            Vec3 {
                x: 0.0,
                y: 0.0,
                z: -6.0,
            },
            10,
            60,
        );
        near(calm.velocity.z - head.velocity.z, -6.0 * gain, 1e-6);
        near(calm.velocity.z - tail.velocity.z, 6.0 * gain, 1e-6);
        let corrected = fly(
            FlightInput {
                forward: 0.7,
                strafe: -6.0 * gain / config.speed,
                ..FlightInput::default()
            },
            mode,
            config,
            Vec3 {
                x: 6.0,
                y: 0.0,
                z: 0.0,
            },
            10,
            60,
        );
        near(corrected.position.x, 0.0, 1e-10);
        assert!(corrected.position.z < 55.0);
    }
    let side = Vec3 {
        x: 6.0,
        y: 0.0,
        z: 0.0,
    };
    let assisted_drift = fly(
        FlightInput::default(),
        FlightMode::Assisted,
        assisted(),
        side,
        10,
        60,
    );
    let sport_drift = fly(
        FlightInput::default(),
        FlightMode::Sport,
        sport(),
        side,
        10,
        60,
    );
    assert!(sport_drift.position.x > assisted_drift.position.x);
    assert!(assisted_drift.roll > 0.0 && assisted_drift.roll < 0.1);
}

#[test]
fn paused_and_invalid_time_preserve_state_clock_and_skip_world_queries() {
    for dt in [0.0, -1.0, f64::NAN, f64::INFINITY] {
        let before = FlightState {
            collision: true,
            ..FlightState::default()
        };
        let mut state = before;
        let options = TickParameters {
            clock: 12.3,
            bounds: Some(bounds()),
            ..parameters(dt)
        };
        let result = simulate(
            &mut state,
            options,
            |_, _, _| panic!("paused terrain query"),
            |_| panic!("paused obstacle query"),
        );
        assert_eq!(state, before);
        assert_eq!(result.clock, 12.3);
        assert_eq!(
            result.wind,
            sample_wind(WindSettings::default(), 12.3, before.position)
        );
        assert!(!result.boundary_contact && !result.obstacle_contact);
    }
}

#[test]
fn long_frames_are_clamped_for_both_flight_and_wind_clock() {
    let mut long = FlightState::default();
    let mut bounded = FlightState::default();
    let a = simulate(&mut long, parameters(30.0), |_, _, _| 0.0, |_| false);
    let b = simulate(&mut bounded, parameters(0.06), |_, _, _| 0.0, |_| false);
    assert_eq!(long, bounded);
    assert_eq!(a, b);
    assert_eq!(a.clock, 0.06);
}

#[test]
fn terrain_callback_uses_new_xz_and_previous_altitude_then_bounces() {
    let mut state = FlightState {
        position: Vec3 {
            x: 0.0,
            y: 6.9,
            z: 0.0,
        },
        velocity: Vec3 {
            x: 0.0,
            y: -10.0,
            z: 0.0,
        },
        ..FlightState::default()
    };
    let input = FlightInput {
        forward: 1.0,
        climb: -1.0,
        ..FlightInput::default()
    };
    let mut query = Vec3::default();
    let result = simulate(
        &mut state,
        TickParameters {
            input,
            wind_base_speed: 0.0,
            ..parameters(1.0 / 60.0)
        },
        |x, z, from_y| {
            query = Vec3 { x, y: from_y, z };
            5.0
        },
        |_| panic!("bounds-disabled obstacle"),
    );
    assert_eq!(query.x, state.position.x);
    assert_eq!(query.z, state.position.z);
    assert_eq!(query.y, 6.9);
    assert_eq!(state.position.y, 6.8);
    assert!(state.collision && state.velocity.y > 0.0 && state.velocity.y <= 1.2);
    assert!(!result.boundary_contact && !result.obstacle_contact);
}

#[test]
fn bounds_zero_velocity_before_obstacle_query_and_rollback_preserves_attitude() {
    let mut state = FlightState {
        position: Vec3 {
            x: 99.9,
            y: 12.0,
            z: 0.0,
        },
        velocity: Vec3 {
            x: 20.0,
            y: 0.0,
            z: 0.0,
        },
        ..FlightState::default()
    };
    let previous = state.position;
    let mut query_positions = Vec::new();
    let mut obstacle_position = Vec3::default();
    let result = simulate(
        &mut state,
        TickParameters {
            input: FlightInput {
                strafe: 1.0,
                yaw: 1.0,
                ..FlightInput::default()
            },
            wind_base_speed: 0.0,
            bounds: Some(bounds()),
            ..parameters(0.05)
        },
        |x, z, from_y| {
            query_positions.push(Vec3 { x, y: from_y, z });
            0.0
        },
        |p| {
            obstacle_position = p;
            true
        },
    );
    assert_eq!(query_positions.len(), 2);
    assert!(query_positions[0].x > 100.0);
    assert_eq!(query_positions[1].x, 100.0);
    assert_eq!(query_positions[0].y, previous.y);
    assert_eq!(query_positions[1].y, previous.y);
    assert_eq!(obstacle_position.x, 100.0);
    assert_eq!(state.position, previous);
    assert_eq!(state.velocity, Vec3::default());
    assert!(state.yaw > 0.0 && state.roll != 0.0);
    assert!(result.boundary_contact && result.obstacle_contact);
    assert!(!state.collision);
}

#[test]
fn obstacle_rollback_does_not_hide_the_ground_contact_flag() {
    let mut state = FlightState {
        position: Vec3 {
            x: 0.0,
            y: 1.9,
            z: 0.0,
        },
        velocity: Vec3 {
            x: 0.0,
            y: -10.0,
            z: 0.0,
        },
        ..FlightState::default()
    };
    let previous = state.position;
    let result = simulate(
        &mut state,
        TickParameters {
            input: FlightInput {
                climb: -1.0,
                ..FlightInput::default()
            },
            bounds: Some(bounds()),
            ..parameters(0.05)
        },
        |_, _, _| 0.0,
        |_| true,
    );
    assert!(state.collision && result.obstacle_contact);
    assert_eq!(state.position, previous);
    assert_eq!(state.velocity, Vec3::default());
    assert_eq!(
        result.wind,
        sample_wind(WindSettings::default(), 0.05, previous)
    );
}

#[test]
fn nonfinite_surface_samples_use_zero_ground_even_with_bounds_enabled() {
    let mut state = FlightState::default();
    let result = simulate(
        &mut state,
        TickParameters {
            bounds: Some(bounds()),
            ..parameters(0.05)
        },
        |_, _, _| f64::NAN,
        |_| false,
    );
    assert!(!result.boundary_contact);
    assert!(!state.collision);
    assert!(
        state.position.x.is_finite()
            && state.position.y.is_finite()
            && state.position.z.is_finite()
    );
}

#[test]
fn wind_directions_and_relative_sectors_follow_meteorological_origins() {
    let origin = Vec3::default();
    for index in 0..8 {
        let direction = index as f64 * 45.0;
        let wind = sample_wind(
            WindSettings {
                strength: WindStrength::Windy,
                direction,
            },
            0.0,
            origin,
        );
        near(wind.x, -(direction * PI / 180.0).sin() * 6.0 * 0.78, 1e-10);
        near(wind.z, (direction * PI / 180.0).cos() * 6.0 * 0.78, 1e-10);
        let description = describe_wind(wind, 0.0);
        assert_eq!(description.direction_sector, index);
        assert_eq!(description.relative_sector, index);
        near(description.headwind, wind.z, 1e-10);
        near(description.crosswind, -wind.x, 1e-10);
    }
    let north = describe_wind(
        Vec3 {
            x: 0.0,
            y: 0.0,
            z: 6.0,
        },
        PI / 2.0,
    );
    assert_eq!(north.relative_sector, 2);
    near(north.headwind, 0.0, 1e-10);
    near(north.crosswind, 6.0, 1e-10);
    assert_eq!(describe_wind(Vec3::default(), 0.0).direction_sector, 8);
    assert_eq!(
        describe_wind(
            Vec3 {
                x: 0.0,
                y: 2.0,
                z: 0.0
            },
            0.0
        )
        .direction_sector,
        9
    );
}

#[test]
fn gusts_are_deterministic_smooth_spatial_and_altitude_dependent() {
    let settings = WindSettings {
        strength: WindStrength::Strong,
        direction: 315.0,
    };
    let position = Vec3 {
        x: 125.0,
        y: 20.0,
        z: -310.0,
    };
    let wind = sample_wind(settings, 12.3, position);
    assert_eq!(wind, sample_wind(settings, 12.3, position));
    assert_ne!(wind, sample_wind(settings, 15.0, position));
    let later = sample_wind(settings, 12.301, position);
    assert!(
        (Vec3 {
            x: later.x - wind.x,
            y: later.y - wind.y,
            z: later.z - wind.z
        })
        .length()
            < 0.004
    );
    let low = sample_wind(settings, 12.3, Vec3 { y: 0.0, ..position });
    let high = sample_wind(
        settings,
        12.3,
        Vec3 {
            y: 250.0,
            ..position
        },
    );
    assert!(high.x.hypot(high.z) > low.x.hypot(low.z));
    assert_eq!(
        sample_wind(
            WindSettings {
                direction: 450.0,
                ..settings
            },
            1.0,
            position
        ),
        sample_wind(
            WindSettings {
                direction: 90.0,
                ..settings
            },
            1.0,
            position
        )
    );
}

#[test]
fn nonfinite_wind_and_inputs_cannot_poison_valid_flight_state() {
    let invalid = Vec3 {
        x: f64::NAN,
        y: f64::INFINITY,
        z: f64::NEG_INFINITY,
    };
    let mut state = FlightState::default();
    let mut calm = state;
    step_flight(
        &mut state,
        forward(),
        1.0 / 60.0,
        FlightMode::Assisted,
        |_, _| 0.0,
        assisted(),
        invalid,
    );
    step_flight(
        &mut calm,
        forward(),
        1.0 / 60.0,
        FlightMode::Assisted,
        |_, _| 0.0,
        assisted(),
        Vec3::default(),
    );
    assert_eq!(state, calm);
    let result = simulate(
        &mut state,
        TickParameters {
            wind_override: Some(invalid),
            ..parameters(0.05)
        },
        |_, _, _| 0.0,
        |_| false,
    );
    assert_eq!(result.wind, Vec3::default());
    assert!(
        state.position.x.is_finite()
            && state.position.y.is_finite()
            && state.position.z.is_finite()
    );
    assert_eq!(
        describe_wind(invalid, f64::NAN),
        describe_wind(Vec3::default(), 0.0)
    );
    assert_eq!(
        sample_wind(WindSettings::default(), f64::NAN, invalid),
        sample_wind(WindSettings::default(), 0.0, Vec3::default())
    );
    let options = WindSettings {
        direction: f64::INFINITY,
        ..WindSettings::default()
    };
    assert_eq!(sample_wind(options, 0.0, Vec3::default()), Vec3::default());
    let mut controls = FlightState::default();
    let bad_input = FlightInput {
        forward: f64::NAN,
        strafe: f64::INFINITY,
        climb: f64::NEG_INFINITY,
        yaw: f64::NAN,
        look_pitch: f64::INFINITY,
    };
    step_flight(
        &mut controls,
        bad_input,
        0.05,
        FlightMode::Assisted,
        |_, _| f64::NAN,
        assisted(),
        Vec3::default(),
    );
    assert_eq!(controls, FlightState::default());
}

#[test]
fn sampled_wind_and_position_are_consistent_after_midpoint_tick() {
    let mut state = FlightState::default();
    let before = state;
    let result = simulate(&mut state, parameters(0.05), |_, _, _| 0.0, |_| false);
    let mut expected = before;
    let midpoint = sample_wind(WindSettings::default(), 0.025, before.position);
    step_flight(
        &mut expected,
        forward(),
        0.05,
        FlightMode::Assisted,
        |_, _| 0.0,
        assisted(),
        midpoint,
    );
    assert_eq!(state, expected);
    assert_eq!(
        result.wind,
        sample_wind(WindSettings::default(), 0.05, expected.position)
    );
    assert_eq!(
        result.wind_description,
        describe_wind(result.wind, expected.yaw)
    );
}

#[test]
fn moving_gusts_keep_travel_within_centimetres_across_frame_rates() {
    let mut states = Vec::new();
    for fps in [30, 60, 120] {
        let mut state = FlightState::default();
        let mut clock = 0.0;
        for _ in 0..12 * fps {
            let result = simulate(
                &mut state,
                TickParameters {
                    clock,
                    config: sport(),
                    mode: FlightMode::Sport,
                    wind_base_speed: 10.5,
                    wind_direction: 315.0,
                    ..parameters(1.0 / fps as f64)
                },
                |_, _, _| 0.0,
                |_| false,
            );
            clock = result.clock;
        }
        near(clock, 12.0, 1e-10);
        states.push(state);
    }
    for state in &states[1..] {
        near_vec(state.position, states[0].position, 0.03);
        near_vec(state.velocity, states[0].velocity, 0.01);
    }
}

#[test]
fn pitch_is_bounded_and_positive_yaw_turns_left() {
    let mut state = FlightState::default();
    for _ in 0..180 {
        step_flight(
            &mut state,
            FlightInput {
                look_pitch: 1.0,
                ..FlightInput::default()
            },
            1.0 / 60.0,
            FlightMode::Assisted,
            |_, _| 0.0,
            assisted(),
            Vec3::default(),
        );
    }
    assert_eq!(state.pitch, 0.75);
    step_flight(
        &mut state,
        FlightInput {
            yaw: 1.0,
            ..FlightInput::default()
        },
        1.0 / 60.0,
        FlightMode::Assisted,
        |_, _| 0.0,
        assisted(),
        Vec3::default(),
    );
    assert!(state.yaw > 0.0);
}
