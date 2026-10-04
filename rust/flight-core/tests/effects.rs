use flight_core::effects::{Effects, explosion_output_len};

fn fish() -> Effects {
    let config = vec![
        0., 1., 6., 6., 2., 40., 8., 4., 0., 0., 10., 0., 10., 10., 0., 10.,
    ];
    let mut effects = Effects::new(0, config.len(), 0, 6 * 9 * 16);
    effects.config = config;
    assert!(effects.initialize());
    effects
}
fn livestock() -> Effects {
    let identity = [
        1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1.,
    ];
    let mut config = vec![
        2., 64., 1., 10., 20., 0., 4.5, 0.4, 0.94, 0., 0., -10., -20., 0.8, 4.5, 2.2, 0.89, 0.,
    ];
    for parent in 0..64 {
        config.push(parent as f64);
        config.extend(identity);
    }
    let mut effects = Effects::new(1, config.len(), 0, 64 * 16);
    effects.config = config;
    assert!(effects.initialize());
    effects
}
fn particles() -> Effects {
    let mut config = vec![4., 4., 12., 0.];
    config.extend([0.5; 21]);
    let mut effects = Effects::new(2, config.len(), 25, explosion_output_len(4));
    effects.config = config;
    assert!(effects.initialize());
    effects
}
fn affine(output: &[f64]) {
    for m in output.chunks_exact(16) {
        assert!(m.iter().all(|v| v.is_finite()));
        assert_eq!([m[3], m[7], m[11], m[15]], [0., 0., 0., 1.]);
    }
}

#[test]
fn fish_keeps_school_layout_and_repeats_without_allocating() {
    let mut effects = fish();
    let pointer = effects.output.as_ptr();
    assert!(effects.update(0., None, false));
    let initial = effects.output.clone();
    assert!((initial[12] + 1.6 / 2f64.sqrt()).abs() < 1e-12);
    assert!((initial[13] + 0.34).abs() < 1e-12);
    for time in [0., 0.1, 1., 13.25, 99.99, 100., 1000.] {
        assert!(effects.update(time, None, false));
        affine(&effects.output);
        assert_eq!(pointer, effects.output.as_ptr());
    }
    assert!(effects.update(0., None, false));
    assert_eq!(effects.output, initial);
}

#[test]
fn livestock_pause_preserves_state_and_all_joint_matrices_are_finite() {
    let mut a = livestock();
    let mut b = livestock();
    let pointer = a.output.as_ptr();
    for frame in 0..1800 {
        let time = frame as f64 / 60.;
        assert!(a.update(time, None, false));
        assert!(b.update(time, None, false));
        if frame % 120 == 0 {
            let saved = a.output.clone();
            assert!(a.update(time, None, false));
            assert_eq!(a.output, saved);
        }
    }
    assert_eq!(a.output, b.output);
    assert_eq!(pointer, a.output.as_ptr());
    affine(&a.output);
    assert!((a.output[12] - 10.).abs() <= 4.5);
    assert!((a.output[14] - 20.).abs() <= 4.5 * 0.77);
    let saved = a.output.clone();
    assert!(!a.update(f64::NAN, None, false));
    assert_eq!(saved, a.output);
}

#[test]
fn explosion_land_and_water_have_distinct_finite_bounded_batches() {
    let mut effects = particles();
    effects.input[..7].copy_from_slice(&[1., 7., 1., 0., 2., 0., 0.]);
    assert!(effects.update(0., None, false));
    assert_eq!(&effects.output[..9], &[0., 0., 0., 0., 0., 1., 1., 16., 1.]);
    effects.input[6] = 1.;
    assert!(effects.update(0., None, true));
    assert_eq!(&effects.output[..9], &[0., 0., 0., 0., 22., 1., 3., 0., 1.]);
    let pointer = effects.output.as_ptr();
    for frame in 0..241 {
        effects.input[5] = frame as f64 / 60.;
        assert!(effects.update(frame as f64 / 60., None, false));
        assert!(effects.output.iter().all(|v| v.is_finite()));
        assert_eq!(pointer, effects.output.as_ptr());
    }
    assert_eq!(&effects.output[..9], &[0.; 9]);
    effects.input[5] = f64::NAN;
    assert!(effects.update(1., None, false));
    assert_eq!(&effects.output[..9], &[0.; 9]);
}

#[test]
fn malformed_layout_is_rejected_before_update() {
    let mut school = fish();
    school.config[7] = 1.;
    assert!(!school.initialize());
    assert!(!school.update(0., None, false));
    let mut herd = livestock();
    herd.config[18] = 64.;
    assert!(!herd.initialize());
    let mut explosion = particles();
    explosion.config[1] = 0.;
    assert!(!explosion.initialize());
    let mut huge = fish();
    huge.config[1] = f64::MAX;
    assert!(!huge.initialize());
}
