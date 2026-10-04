use flight_core::Vec3;
use flight_core::weapons::{WeaponConfig, WeaponEvents, WeaponSimulation, WeaponTarget};

fn config() -> WeaponConfig {
    // Reference-fixture values: production configuration is uploaded by JS.
    WeaponConfig {
        capacity: 6,
        gravity: 18.0,
        drop_cooldown: 0.45,
        reload_time: 3.0,
        blast_radius: 9.0,
        explosion_lifetime: 3.8,
        max_bombs: 24,
        max_explosions: 32,
        max_substep: 1.0 / 60.0,
        max_substeps: 600,
        timer_epsilon: 1e-9,
    }
}
fn simulation() -> WeaponSimulation {
    WeaponSimulation::new(config(), vec![WeaponTarget { x: 0.0, z: 55.0 }]).unwrap()
}
fn position(y: f64) -> Vec3 {
    Vec3 { x: 0.0, y, z: 55.0 }
}
fn flat(_: f64, _: f64, _: f64) -> f64 {
    0.0
}
fn near(actual: f64, expected: f64) {
    assert!((actual - expected).abs() < 1e-8, "{actual} != {expected}");
}

#[test]
fn drop_copies_motion_consumes_ammo_and_blocks_until_cooldown() {
    let mut state = simulation();
    let velocity = Vec3 {
        x: 2.0,
        y: 1.0,
        z: -10.0,
    };
    assert!(state.drop_bomb(position(12.0), velocity));
    assert_eq!(state.ammo, 5);
    assert_eq!(state.bombs[0].id, 1.0);
    assert_eq!(state.bombs[0].velocity, velocity);
    near(state.bombs[0].position.y, 11.2);
    let before = state.clone();
    assert!(!state.drop_bomb(position(12.0), velocity));
    assert_eq!(state, before);
    state.step(0.45, flat);
    assert!(state.drop_bomb(position(12.0), velocity));
}

#[test]
fn gravity_integrates_horizontal_and_vertical_trajectory() {
    for fps in [30, 60, 120] {
        let mut state = simulation();
        state.drop_bomb(
            position(100.0),
            Vec3 {
                x: 6.0,
                y: 3.0,
                z: -12.0,
            },
        );
        for _ in 0..fps {
            state.step(1.0 / f64::from(fps), flat);
        }
        let bomb = state.bombs[0];
        near(bomb.position.x, 6.0);
        near(bomb.position.z, 43.0);
        near(bomb.position.y, 99.2 + 3.0 - 9.0);
        near(bomb.velocity.y, -15.0);
    }
}

#[test]
fn swept_impact_uses_trajectory_position_and_unique_target_scoring() {
    let mut state = simulation();
    state.drop_bomb(
        Vec3 {
            x: -10.0,
            y: 9.8,
            z: 55.0,
        },
        Vec3 {
            x: 10.0,
            ..Vec3::default()
        },
    );
    assert_eq!(
        state.step(2.0, flat),
        WeaponEvents {
            impacts: 1,
            hits: 1
        }
    );
    assert!(state.explosions[0].position.x.abs() < 1e-5);
    near(state.explosions[0].age, 1.0);
    assert_eq!(state.score, 100);
    state.drop_bomb(position(0.8), Vec3::default());
    assert_eq!(
        state.step(0.45, flat),
        WeaponEvents {
            impacts: 1,
            hits: 0
        }
    );
    assert_eq!(state.hit_target_indices, vec![0]);
    assert_eq!(state.score, 100);
}

#[test]
fn raised_ridges_and_height_aware_decks_intercept_at_the_correct_surface() {
    let mut state = simulation();
    state.drop_bomb(
        Vec3 {
            x: 0.0,
            y: 5.0,
            z: 500.0,
        },
        Vec3 {
            x: 60.0,
            ..Vec3::default()
        },
    );
    assert_eq!(
        state
            .step(0.1, |x, _, _| if (2.0..=3.0).contains(&x) {
                6.0
            } else {
                0.0
            })
            .impacts,
        1
    );
    assert!((2.0..=3.0).contains(&state.explosions[0].position.x));
    assert_eq!(state.explosions[0].position.y, 6.0);
    for (height, expected) in [(12.0, 5.0), (4.0, -2.0)] {
        state.reset();
        state.drop_bomb(position(height), Vec3::default());
        assert_eq!(
            state
                .step(1.5, |_, _, from_y| if from_y >= 5.0 { 5.0 } else { -2.0 })
                .impacts,
            1
        );
        assert_eq!(state.explosions[0].position.y, expected);
    }
}

#[test]
fn blast_boundary_is_inclusive_and_nonfinite_surface_falls_back_to_zero() {
    for (offset, expected) in [(9.0, 1), (9.01, 0)] {
        let mut state = simulation();
        state.drop_bomb(
            Vec3 {
                x: offset,
                ..position(0.8)
            },
            Vec3::default(),
        );
        assert_eq!(state.step(1.0 / 60.0, |_, _, _| f64::NAN).hits, expected);
        assert_eq!(state.score, expected * 100);
        assert_eq!(state.explosions[0].position.y, 0.0);
    }
}

#[test]
fn sixth_drop_reloads_without_frame_sized_timer_residues() {
    let mut state = simulation();
    for index in 0..6 {
        assert!(state.drop_bomb(position(1000.0), Vec3::default()));
        if index < 5 {
            for _ in 0..27 {
                state.step(1.0 / 60.0, flat);
            }
        }
    }
    assert_eq!(state.ammo, 0);
    assert_eq!(state.reload_remaining, 3.0);
    assert!(!state.drop_bomb(position(12.0), Vec3::default()));
    for _ in 0..180 {
        state.step(1.0 / 60.0, flat);
    }
    assert_eq!(state.reload_remaining, 0.0);
    assert_eq!(state.cooldown, 0.0);
    assert_eq!(state.ammo, 6);
}

#[test]
fn invalid_time_or_vectors_preserve_state_and_long_frames_remain_bounded() {
    let mut state = simulation();
    state.drop_bomb(position(12.0), Vec3::default());
    let before = state.clone();
    for dt in [0.0, -1.0, f64::NAN, f64::INFINITY] {
        assert_eq!(state.step(dt, flat), WeaponEvents::default());
        assert_eq!(state, before);
    }
    assert!(!state.drop_bomb(position(f64::NAN), Vec3::default()));
    state.reset();
    assert!(!state.drop_bomb(
        position(12.0),
        Vec3 {
            x: f64::INFINITY,
            ..Vec3::default()
        }
    ));
    state.drop_bomb(position(12.0), Vec3::default());
    assert_eq!(
        state.step(60.0, flat),
        WeaponEvents {
            impacts: 1,
            hits: 1
        }
    );
    assert!(state.bombs.is_empty());
    assert!(state.explosions.is_empty());
}

#[test]
fn active_lists_ids_and_reset_are_bounded_and_independent() {
    let mut state = simulation();
    for _ in 0..24 {
        assert!(state.drop_bomb(position(100_000.0), Vec3::default()));
        state.step(if state.ammo == 0 { 3.0 } else { 0.45 }, flat);
    }
    assert_eq!(state.bombs.len(), 24);
    let before = state.clone();
    assert!(!state.drop_bomb(position(100_000.0), Vec3::default()));
    assert_eq!(state, before);
    state.reset();
    assert_eq!(state, simulation());
    let mut custom = config();
    custom.max_explosions = 4;
    custom.explosion_lifetime = 1000.0;
    let mut bounded = WeaponSimulation::new(custom, vec![]).unwrap();
    for _ in 0..20 {
        assert!(bounded.drop_bomb(position(0.8), Vec3::default()));
        bounded.step(if bounded.ammo == 0 { 3.0 } else { 0.45 }, flat);
    }
    assert_eq!(bounded.explosions.len(), 4);
    assert!(
        bounded
            .explosions
            .windows(2)
            .all(|pair| pair[0].id < pair[1].id)
    );
}

#[test]
fn invalid_configuration_cannot_overflow_the_fixed_packet() {
    let mut bad = config();
    bad.max_bombs = 25;
    assert!(WeaponSimulation::new(bad, vec![]).is_none());
    bad = config();
    bad.gravity = f64::NAN;
    assert!(WeaponSimulation::new(bad, vec![]).is_none());
    assert!(WeaponSimulation::new(config(), vec![WeaponTarget { x: 0.0, z: 0.0 }; 17]).is_none());
}
