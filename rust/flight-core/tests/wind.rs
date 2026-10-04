use flight_core::wind::sample_wind_speed;
use flight_core::{
    FlightConfig, FlightInput, FlightMode, FlightState, TickParameters, Vec3, WindSettings,
    WindStrength, describe_wind, sample_wind, simulate,
};

fn angle_difference(actual: f64, expected: f64) -> f64 {
    ((actual - expected + 540.0) % 360.0) - 180.0
}

#[test]
fn every_selected_bearing_starts_exactly_at_time_zero_at_every_position() {
    for strength in [
        WindStrength::Breeze,
        WindStrength::Windy,
        WindStrength::Strong,
    ] {
        for position in [
            Vec3::default(),
            FlightState::default().position,
            Vec3 {
                x: 1500.0,
                y: 200.0,
                z: -400.0,
            },
        ] {
            for direction in [0.0, 45.0, 90.0, 135.0, 180.0, 225.0, 270.0, 315.0] {
                let wind = sample_wind(
                    WindSettings {
                        strength,
                        direction,
                    },
                    0.0,
                    position,
                );
                let actual = describe_wind(wind, 0.0).from_degrees;
                assert!(angle_difference(actual, direction).abs() < 1e-10);
            }
        }
    }
}

#[test]
fn bearing_meanders_both_ways_without_spins_or_discontinuities() {
    let settings = WindSettings::default();
    let position = FlightState::default().position;
    let mut previous = settings.direction;
    let mut minimum = 0.0_f64;
    let mut maximum = 0.0_f64;
    for frame in 0..=120 * 20 {
        let wind = sample_wind(settings, frame as f64 / 20.0, position);
        let bearing = describe_wind(wind, 0.0).from_degrees;
        let offset = angle_difference(bearing, settings.direction);
        assert!(offset.abs() <= 40.0 + 1e-10);
        // The envelope and frequency terms bound a fixed point to 6.67 deg/s.
        assert!(angle_difference(bearing, previous).abs() <= 0.334);
        minimum = minimum.min(offset);
        maximum = maximum.max(offset);
        previous = bearing;
    }
    assert!(minimum < -20.0 && maximum > 20.0);
}

#[test]
fn spatial_phase_changes_direction_but_altitude_only_changes_strength() {
    let settings = WindSettings::default();
    let low = FlightState::default().position;
    let high = Vec3 { y: 300.0, ..low };
    let distant = Vec3 {
        x: 1500.0,
        y: 200.0,
        z: -400.0,
    };
    let bearing = |position| describe_wind(sample_wind(settings, 12.0, position), 0.0).from_degrees;
    assert!(angle_difference(bearing(low), bearing(high)).abs() < 1e-10);
    assert!(angle_difference(bearing(low), bearing(distant)).abs() > 1.0);
    let low_wind = sample_wind(settings, 12.0, low);
    let high_wind = sample_wind(settings, 12.0, high);
    assert!(high_wind.length() > low_wind.length());
    assert_eq!(
        sample_wind(settings, 12.0, low),
        sample_wind(settings, 12.0, low)
    );
}

#[test]
fn calm_invalid_settings_and_existing_finite_fallbacks_remain_unchanged() {
    let position = FlightState::default().position;
    for direction in [0.0, 315.0, f64::NAN, f64::INFINITY] {
        assert_eq!(
            sample_wind(
                WindSettings {
                    strength: WindStrength::Calm,
                    direction
                },
                35.0,
                position
            ),
            Vec3::default()
        );
    }
    for direction in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert_eq!(
            sample_wind_speed(10.5, direction, 35.0, position),
            Vec3::default()
        );
    }
    for speed in [0.0, -1.0, f64::NAN, f64::INFINITY] {
        assert_eq!(
            sample_wind_speed(speed, 315.0, 35.0, position),
            Vec3::default()
        );
    }
    let invalid = Vec3 {
        x: f64::NAN,
        y: f64::INFINITY,
        z: f64::NEG_INFINITY,
    };
    assert_eq!(
        sample_wind(WindSettings::default(), f64::NAN, invalid),
        sample_wind(WindSettings::default(), 0.0, Vec3::default())
    );
}

#[test]
fn explicit_override_stays_constant_despite_dynamic_settings_and_elapsed_time() {
    let mut state = FlightState::default();
    let override_wind = Vec3 {
        x: -6.0,
        y: 0.2,
        z: 3.0,
    };
    let expected = describe_wind(override_wind, 0.0);
    let mut clock = 32.0;
    for _ in 0..120 {
        let result = simulate(
            &mut state,
            TickParameters {
                input: FlightInput {
                    forward: 1.0,
                    ..FlightInput::default()
                },
                dt: 1.0 / 60.0,
                clock,
                mode: FlightMode::Sport,
                config: FlightConfig {
                    speed: 34.0,
                    climb_speed: 17.0,
                    response: 3.2,
                    brake: 2.8,
                    yaw_speed: 1.7,
                    bank: 0.34,
                },
                wind_base_speed: 10.5,
                wind_direction: 315.0,
                bounds: None,
                wind_override: Some(override_wind),
            },
            |_, _, _| 0.0,
            |_| false,
        );
        assert_eq!(result.wind, override_wind);
        assert_eq!(result.wind_description, expected);
        clock = result.clock;
    }
    assert!(clock > 33.9);
}
