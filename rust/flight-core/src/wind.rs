use crate::flight::Vec3;
use std::f64::consts::{PI, TAU};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum WindStrength {
    Calm,
    #[default]
    Breeze,
    Windy,
    Strong,
}

impl WindStrength {
    pub fn base_speed(self) -> f64 {
        match self {
            Self::Calm => 0.0,
            Self::Breeze => 2.5,
            Self::Windy => 6.0,
            Self::Strong => 10.5,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WindSettings {
    pub strength: WindStrength,
    /// Baseline meteorological origin: 0 north (-Z), 90 east (+X).
    pub direction: f64,
}

impl Default for WindSettings {
    fn default() -> Self {
        Self {
            strength: WindStrength::Breeze,
            direction: 315.0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WindDescription {
    pub speed: f64,
    pub from_degrees: f64,
    pub headwind: f64,
    pub crosswind: f64,
    /// 0 north through 7 northwest. 8 calm, 9 vertical gust.
    pub direction_sector: u32,
    /// 0 headwind through 7 left/front crosswind. 8 calm, 9 vertical gust.
    pub relative_sector: u32,
}

fn finite(value: f64) -> f64 {
    if value.is_finite() { value } else { 0.0 }
}

fn degrees(value: f64) -> f64 {
    ((value % 360.0) + 360.0) % 360.0
}

/// Continuous deterministic game gusts with a slowly meandering bearing.
/// Callers own elapsed simulation time, so pausing freezes the field without
/// changing positions or settings; a reset reproduces the same weather.
pub fn sample_wind(settings: WindSettings, elapsed: f64, position: Vec3) -> Vec3 {
    sample_wind_speed(
        settings.strength.base_speed(),
        settings.direction,
        elapsed,
        position,
    )
}

/// Runtime entry using the shared UI preset's speed instead of a duplicate table.
pub fn sample_wind_speed(base_speed: f64, direction: f64, elapsed: f64, position: Vec3) -> Vec3 {
    if !base_speed.is_finite() || base_speed <= 0.0 || !direction.is_finite() {
        return Vec3::default();
    }
    let time = finite(elapsed).max(0.0);
    let x = finite(position.x);
    let z = finite(position.z);
    let altitude = finite(position.y).max(0.0);
    let phase = x * 0.0017 + z * 0.0021;
    let gust = 1.0
        + 0.16 * (time * 0.43 + phase).sin()
        + 0.075 * (time * 1.07 + x * 0.0029 - z * 0.0013).sin()
        + 0.035 * (time * 0.19 - phase * 0.6).sin();
    let altitude_factor = 0.78 + 0.22 * (1.0 - (-altitude / 60.0).exp());
    let speed = base_speed * altitude_factor * gust;
    // Match the TypeScript reference's operation order. Two slow weather waves
    // and a small directional gust stay within 40 degrees of the baseline.
    // The smooth onset makes every position start at the selected direction.
    let direction_offset = (27.0 * (time * (TAU / 64.0) + phase * 0.6).sin()
        + 9.0 * (time * (TAU / 37.0) + phase * 0.35).sin()
        + 4.0 * (time * (TAU / 12.0) + phase * 1.1).sin())
        * (1.0 - (-time / 6.0).exp());
    let bearing = (degrees(direction) + direction_offset) * PI / 180.0;
    Vec3 {
        x: -bearing.sin() * speed,
        y: base_speed * altitude_factor * 0.025 * (time * 0.61 + phase * 0.8).sin(),
        z: bearing.cos() * speed,
    }
}

/// Numeric wind telemetry. Localized display strings remain a UI concern.
pub fn describe_wind(wind: Vec3, yaw: f64) -> WindDescription {
    let x = finite(wind.x);
    let y = finite(wind.y);
    let z = finite(wind.z);
    let speed = x.hypot(y).hypot(z);
    let heading = finite(yaw) % TAU;
    if x.hypot(z) < 1e-8 {
        let sector = if speed < 1e-8 { 8 } else { 9 };
        return WindDescription {
            speed,
            from_degrees: 0.0,
            headwind: 0.0,
            crosswind: 0.0,
            direction_sector: sector,
            relative_sector: sector,
        };
    }
    let from_degrees = degrees((-x).atan2(z) * 180.0 / PI);
    let relative_degrees = degrees(from_degrees + heading * 180.0 / PI);
    WindDescription {
        speed,
        from_degrees,
        headwind: x * heading.sin() + z * heading.cos(),
        crosswind: -x * heading.cos() + z * heading.sin(),
        direction_sector: (from_degrees / 45.0).round() as u32 % 8,
        relative_sector: (relative_degrees / 45.0).round() as u32 % 8,
    }
}
