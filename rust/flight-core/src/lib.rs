//! AEROFLOW's deterministic flight and wind simulation.
//!
//! Coordinates are metres, yaw zero points toward world -Z, and positive yaw
//! turns left. This deliberately preserves the existing arcade flight model.

mod abi;
pub mod effects;
mod effects_abi;
pub mod flight;
pub mod scene;
mod scene_abi;
pub mod simulation;
pub mod weapons;
mod weapons_abi;
pub mod wind;
pub mod world;
mod world_abi;

pub use flight::{
    FlightConfig, FlightInput, FlightMode, FlightState, Vec3, advance_flight, apply_terrain,
    step_flight,
};
pub use simulation::{SimulationResult, TickParameters, WorldBounds, simulate};
pub use wind::{WindDescription, WindSettings, WindStrength, describe_wind, sample_wind};
