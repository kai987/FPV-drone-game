use flight_core::flight::Vec3;
use flight_core::world::{Bridge, Cabin, Lake, Obstacle, Pasture, RiverSample, World};

fn world() -> World {
    World::new(
        -2.0,
        vec![
            RiverSample {
                x: 0.0,
                z: -100.0,
                half_width: 5.0,
            },
            RiverSample {
                x: 0.0,
                z: 100.0,
                half_width: 5.0,
            },
        ],
        vec![Lake {
            x: 300.0,
            z: 0.0,
            radius_x: 60.0,
            radius_z: 40.0,
            rotation: 0.2,
            phase: 0.6,
        }],
        vec![Cabin {
            x: 100.0,
            z: 0.0,
            yaw: 0.0,
            width: 10.0,
            depth: 8.0,
            wall_height: 3.0,
            roof_height: 2.0,
            base_y: 2.0,
        }],
        vec![Bridge {
            x: 0.0,
            z: 0.0,
            yaw: 0.0,
            length: 30.0,
            width: 4.0,
            span: 10.0,
            ramp_length: 10.0,
            deck_y: 4.0,
            landing_a_y: 0.0,
            landing_b_y: 1.0,
        }],
        vec![Pasture {
            x: 200.0,
            z: 0.0,
            radius: 10.0,
        }],
    )
}
fn near(a: f64, b: f64) {
    assert!((a - b).abs() < 1e-9, "{a} differs from {b}");
}

#[test]
fn river_channel_and_irregular_lake_contour_have_exact_signed_distances() {
    let world = world();
    near(world.water_distance(0.0, 0.0), -5.0);
    near(world.water_distance(8.0, 0.0), 3.0);
    assert!(world.is_water(300.0, 0.0));
    let lake = world.lakes[0];
    for index in 0..96 {
        let angle = index as f64 / 96.0 * std::f64::consts::TAU;
        let shape = 1.0
            + 0.075 * (angle * 3.0 + lake.phase).sin()
            + 0.045 * (angle * 5.0 - lake.phase * 0.3).cos()
            + 0.025 * (angle * 8.0 + 0.4).sin();
        let x = angle.cos() * lake.radius_x * shape;
        let z = angle.sin() * lake.radius_z * shape;
        near(
            world.water_distance(
                lake.x + x * lake.rotation.cos() - z * lake.rotation.sin(),
                lake.z + x * lake.rotation.sin() + z * lake.rotation.cos(),
            ),
            0.0,
        );
    }
}
#[test]
fn roof_slopes_and_bridge_ramps_select_support_only_when_above_them() {
    let world = world();
    near(world.rural_surface_height(100.0, 0.0).unwrap(), 7.08);
    near(world.rural_surface_height(104.0, 0.0).unwrap(), 5.48);
    near(world.rural_surface_height(0.0, 0.0).unwrap(), 4.0);
    near(world.rural_surface_height(-10.0, 0.0).unwrap(), 2.0);
    near(world.rural_surface_height(10.0, 0.0).unwrap(), 2.5);
    near(world.flight_surface_height(0.0, 0.0, 3.0), -2.0);
    near(world.flight_surface_height(0.0, 0.0, 4.0), 4.0);
    near(world.flight_surface_height(0.0, 0.0, f64::INFINITY), 4.0);
}
#[test]
fn rural_clearance_uses_strict_edges_and_padding() {
    let world = world();
    assert!(!world.clearance(100.0, 0.0, 0.0));
    assert!(world.clearance(109.0, 0.0, 0.0));
    assert!(!world.clearance(109.0, 0.0, 1.0));
    assert!(!world.clearance(200.0, 12.0, 0.0));
    assert!(world.clearance(200.0, 13.0, 0.0));
    assert!(!world.clearance(0.0, 4.0, 0.0));
    assert!(world.clearance(0.0, 5.0, 0.0));
}
#[test]
fn obstacle_grid_indexes_across_cells_and_honours_elevated_bottoms() {
    let mut world = world();
    let ground = world.ground_height(63.8, -64.0);
    world.set_obstacles(vec![Obstacle {
        x: 63.8,
        z: -64.0,
        radius: 1.0,
        height: 10.0,
        base: ground + 5.0,
        roof: false,
    }]);
    assert!(world.intersects_obstacle(Vec3 {
        x: 64.4,
        y: ground + 7.0,
        z: -64.2
    }));
    assert!(!world.intersects_obstacle(Vec3 {
        x: 64.4,
        y: ground + 4.0,
        z: -64.2
    }));
    assert!(!world.intersects_obstacle(Vec3 {
        x: 66.0,
        y: ground + 7.0,
        z: -64.0
    }));
    world.set_obstacles(vec![]);
    assert!(!world.intersects_obstacle(Vec3 {
        x: 64.4,
        y: ground + 7.0,
        z: -64.2
    }));
}
#[test]
fn roof_obstacle_narrow_phase_uses_true_outline_and_sloping_top() {
    let mut world = world();
    world.set_obstacles(vec![Obstacle {
        x: 100.0,
        z: 0.0,
        radius: 9.0,
        height: 100.0,
        base: f64::NEG_INFINITY,
        roof: true,
    }]);
    assert!(world.intersects_obstacle(Vec3 {
        x: 104.0,
        y: 5.5,
        z: 0.0
    }));
    assert!(!world.intersects_obstacle(Vec3 {
        x: 104.0,
        y: 6.0,
        z: 0.0
    }));
    assert!(!world.intersects_obstacle(Vec3 {
        x: 108.0,
        y: 3.0,
        z: 0.0
    }));
}
#[test]
fn malformed_uploaded_geometry_is_rejected_before_building_a_world() {
    assert!(World::from_packet(&[]).is_none());
    assert!(World::from_packet(&[-2.0, 2.5, 0.0, 0.0, 0.0, 0.0]).is_none());
    assert!(
        World::from_packet(&[
            -2.0, 2.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 5.0, 0.0, 100.0, 5.0
        ])
        .is_some()
    );
    assert!(
        World::from_packet(&[
            f64::NAN,
            2.0,
            0.0,
            0.0,
            0.0,
            0.0,
            0.0,
            0.0,
            5.0,
            0.0,
            100.0,
            5.0
        ])
        .is_none()
    );
}
