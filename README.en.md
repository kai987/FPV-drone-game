# AEROFLOW · FPV Drone Game

[中文](./README.md) | [日本語](./README.ja.md) | **English**

A browser game for drone flying and bombing practice, with chase, top-down aiming, and first-person views. React, TypeScript, Vite, and Three.js provide the interface and 3D rendering. Rust compiles to WebAssembly and handles flight, wind, geography queries, bombs, and batched scene and animation calculations. No account, backend, or paid API is required.

Play online: [GitHub Pages](https://kai987.github.io/FPV-drone-game/) · [Sites](https://aeroflow-fpv-drone-game.huamengdiqidiguo.chatgpt.site/)

## Features

- Six fictional FPV drones with distinct shapes, colors, and handling. Hangar thumbnails, the rotatable large preview, and the flying drone share the same 3D model. Browse hardware settings and game flight parameters.
- Three independent maps, each with eight checkpoint rings, five bombing targets, and its own minimap. Choose a timed challenge or free flight, and Assisted or Sport handling.
- Calm, Breeze, Moderate, and Strong wind with eight base origin directions. Takeoff starts at the base direction, then the actual direction shifts smoothly over time. Wind speed also varies with time, position, and altitude. Headwind, tailwind, and crosswind affect actual ground speed and trajectory. Live instrument degrees show where wind comes from; the compass beside the minimap shows where it blows. Pause freezes the wind field.
- Six bombs, automatic reloading, smoke and debris on land, and splashes and ripples on water. The first hit on each target earns 100 points.
- Day/night switching, a drone searchlight, lit windows, urban streetlights, and a harbor lighthouse. Optional motor, checkpoint, and bombing audio is muted by default.
- A draggable, zoomable minimap, live telemetry, pause/restart, fullscreen, and multitouch mobile controls.
- Instantly switch the header selector between **中文 / 日本語 / English**. Chinese is the default. The language is stored as `zh / ja / en` under `aeroflow-language` in localStorage. Switching preserves flight position and progress, the map, ammunition, wind, minimap view, and the existing 3D renderer. Flying and language switching still work when local storage is unavailable.

Both handling modes automatically hover in calm air. Wind causes drift that needs correction. Sport offers higher speed, more inertia, and stronger banking feedback. This is an accessible game model, not a professional Acro/Rate, gravity-based flight, or real aerodynamic simulator.

## Three maps

| Map | Flying envelope | Area | Scenery |
| --- | --- | --- | --- |
| Pine Valley · PINE VALLEY | 3.6 × 3.6 km | 12.96 km²; approximately 13 km² in the UI | Rolling terrain, pine woods, meadows, a river, Emerald Lake, and Pine Shadow Lake |
| Industrial Factory · IRON WORKS | 7.2 × 7.2 km | 51.84 km²; approximately 52 km² in the UI | Industrial avenues, outer production districts, tanks, chimneys, pipes, and logistics yards |
| Harbor · SEA PORT | 7.2 × 7.2 km | 51.84 km²; approximately 52 km² in the UI | Coastal warehouses, container piers, gantry cranes, cargo ships, and open sea |

All maps have a 450 m altitude ceiling. The factory and harbor have about four times their original area, retaining their spawn points and training routes. New districts and facilities provide the expansion; buildings are not scaled up.

- **Valley:** Three country cabins, a wooden bridge, walking and grazing cattle and sheep, and river/lake fish schools. Water features multiscale waves, river-aligned texture flow, shallow-water transitions, and reflected sky and mountains. Rocks show mineral grains, cracks, and moss, with shrubs and gravel along the banks.
- **Factory:** 190 buildings, 41 tanks, 15 chimneys, 40 trucks, 30 pipe segments, and 1,023 containers, with 101 buildings in the central district. Fly below elevated structures or land on supported roofs.
- **Harbor:** 125 warehouses, nine piers, nine gantry cranes, 27 trucks, four cargo ships, two breakwaters, and 2,932 containers, with 54 warehouses in the central district. Each of the six new piers is 960 m long. The sea has waves, reflections, and shore foam; the lighthouse has a rotating beam at night.
- **Roads:** Each industrial map retains 21 main-road crossroads with zebra crossings and stop bars on all four approaches. Shared service roads connect the loading entrances of all 190 factory buildings and 125 harbor warehouses, avoiding buildings, cargo, tanks and the shoreline. The factory adds 148 T-junctions and 11 crossroads; the harbor adds 88 T-junctions and 7 crossroads. Long service roads have center dashes and junctions have zebra crossings; only the terminating approach stops at a T-junction. The 3D pavement, ground cutouts and minimap share the complete metre-scaled road layout.
- **Switching:** On first entry, all three maps prepare their scenes, textures, Rust services, and day/night shaders, with per-map progress. Flying is enabled only after all are ready. Switching reuses cached scenes, returns to the selected map's spawn point, and resets the route, timer, ammunition, and score. Drone, game/handling mode, wind, day/night, sound, language, and camera view are retained.

## Six drones

| Game drone | Frame and color | Assisted / Sport speed limit |
| --- | --- | --- |
| CINE | Compact duct guards, orange | 51.8 / 88.1 km/h |
| FLOW | Balanced standard X frame, green | 72.0 / 122.4 km/h |
| RACE | Narrow racing frame, red | 97.2 / 165.2 km/h |
| RANGE | Long arms, large battery, and tall antenna, blue | 64.8 / 110.2 km/h |
| VECTOR | Low fairing and symmetrical speed X frame, cyan | 152.9 / 260.0 km/h |
| FALCON | Long axial center pod and four parallel motor pods, gold | 211.8 / 360.0 km/h |

These are ordinary, calm-air game limits calculated from the shared flight configuration. Actual ground speed depends on wind, turns, acceleration, and braking. **All drones are fictional game configurations. Hardware and endurance are also fictional settings, battery drain is not simulated, and these values are not product measurements or world records.**

Drag the large hangar preview to rotate, use the wheel or pinch to zoom, and reset to restore the view. Opening the hangar during flight pauses the game. Changing drones requires returning to the spawn point through “Return to start and apply.” FALCON's main axis is upright while hovering and tilts toward the flight direction when moving forward.

VECTOR is inspired by the [2017 DRL RacerX record report](https://www.guinnessworldrecords.com/news/commercial/2017/7/the-drone-racing-league-builds-the-worlds-fastest-racing-drone-482701), and FALCON by [AirShaper's Peregreen V4 case study](https://airshaper.com/cases/peregreen-v4-fastest-drone). The hangar separates prototype references from game performance. Model shapes are game adaptations.

## Controls

| Action | Key or interface |
| --- | --- |
| Forward / backward | W / S |
| Strafe left / right | A / D |
| Turn left / right | Q / E, or left/right arrow keys |
| Ascend / descend | Space / Shift |
| Look up / down | Up/down arrow keys |
| Pause | Esc |
| Pause / resume | P |
| Restart from the spawn point | R |
| Drop a bomb | B, or the bombing button |
| Day / night | N, or the header day/night button |
| Chase → top-down aiming → first-person | V, or the camera button at the upper right of the scene |
| Minimap zoom | − / +: 1×, 2×, 4×, 8× |
| Browse the minimap | Mouse or single-finger drag; arrow keys when the minimap has focus |
| Restore minimap following | Follow button, or Home when the minimap has focus |
| Minimap overview | Click the magnification or Route/Overview preset to return to 1× |
| Interface language | Header 中文 / 日本語 / English selector |

Click the 3D scene during flight to enable mouse look. Esc releases the mouse and pauses. Switching browser tabs or losing window focus also pauses automatically. After takeoff on mobile, control flight with gestures on the flight view. Hold one finger to accelerate gradually from low speed; input reaches the selected aircraft and mode’s maximum after about two seconds. Drag up/down for forward/backward flight and left/right to strafe. Drag a second finger up/down to climb/descend and left/right to turn; both fingers can work together. Releasing a finger clears its axes and flight physics slows the aircraft. Assisted mode brakes faster, and wind can still cause drift. Bombing, wind direction, and the minimap sit in a panel below the flight view. Dragging or zooming the minimap does not steer the aircraft. Inputs, selectors, and modal dialogs isolate flight shortcuts to prevent accidental movement or bombing while using the interface.

### Flight, wind, and bombing tips

- **Timed challenge:** Fly through the illuminated rings in order, approaching their front side. Collisions slow the drone and add three seconds; persistent contact has a penalty cooldown. **Free flight** has no ring requirement or collision time penalty.
- Game and handling modes are locked while flying or paused. Return to the spawn point to change them. Wind can be adjusted at any time: opening settings pauses the game, and applying changes preserves position, time, and ammunition until you resume manually.
- The default breeze uses northwest as its base direction and causes slight drift. Select Calm, then hold W to practice the first two rings. Wind names and live degrees indicate its origin: a north wind blows north to south. The compass arrow indicates its destination. Actual direction changes smoothly on its own; watch the degrees and arrow, then steer against the drift. Direction and speed freeze while paused, and restarting begins at the base direction. Assisted reduces drift; Sport requires more active correction.
- A practice target is directly below the spawn point. Take off, press V for top-down aiming, then B to drop a bomb. Bombs inherit drone velocity; the reticle marks the point below the drone, not a predicted impact.
- After all six bombs are used, reloading takes three seconds. Each of the five targets awards 100 points on its first hit. Bombing scores are separate from ring timing, and bombing works in both game modes. Pause freezes bombs, explosions, and the reload timer; restarting restores ammunition, targets, and score.
- Light-blue fish icons on the valley minimap mark schools. Near the river bend east of spawn, downstream of the wooden bridge, or at a lake, hover about 2–8 m above water and use top-down view. High or horizontal views can be obscured by reflections.
- Water contact stabilizes the drone. The camera, drone, and bombs share ground/water queries. Explore both lakes along the river in free flight, or cruise the full industrial-map envelope.

Personal bests are stored in the current browser's localStorage, separated by map, drone, handling mode, wind strength, and base origin direction. Calm records ignore direction. Records for dynamic wind and denser urban maps are stored separately from earlier windy flights and urban records. Calm Valley flights still read older records for the same drone and handling mode; original records are retained. Manually changing wind mid-run excludes that flight from personal bests; automatic direction shifts do not. Restarting restores eligibility. Flying remains available when storage is blocked.

## Run locally

Development requires **Node.js 22.18+ (24 recommended)**, npm, and Rust/Cargo managed by rustup. [rust-toolchain.toml](./rust-toolchain.toml) pins **Rust 1.93.0** and the **`wasm32-unknown-unknown`** target. On first use, rustup prepares the configured toolchain.

Players only need a browser with **WebGL 2, WebAssembly, and hardware acceleration**; Node.js and Rust are not required to play.

```sh
npm ci
npm run dev
```

Open the address printed in the terminal, normally [http://127.0.0.1:5173/](http://127.0.0.1:5173/).

```sh
npm run build:wasm # Build Rust and update WASM separately
npm test           # Build WASM, run native Cargo and Node tests
npm run check      # npm test, then TypeScript checks
npm run build      # Build WASM, check TypeScript, generate dist/
npm run preview    # Preview existing dist/, normally http://127.0.0.1:4173/
```

Development, tests, checks, and production builds all generate WASM first. The development server does not watch Rust source. After Rust changes, run `npm run build:wasm` or restart `npm run dev`. `src/game/generated/flight_core.wasm`, Cargo's `target/`, `node_modules/`, and `dist/` are ignored build/dependency outputs that the commands above recreate from a fresh checkout.

Game artwork ships with the repository; no generative AI is called at runtime. Fonts may load from Google Fonts and fall back to system fonts offline or when unavailable. There are no account, database, paid API, or server-secret dependencies.

## Build and deploy

**`dist/` from `npm run build` is the complete static website**, containing HTML, JavaScript, CSS, WASM, and artwork. Publish that directory to a static host. Publishing source alone or opening the source HTML directly does not run the production game. Vite's `base: './'` supports subdirectories, including GitHub Pages' `/FPV-drone-game/`. The WASM loader supports streaming compilation and falls back to ordinary compilation of the same bytes if the host's MIME type is unsuitable.

GitHub Pages setup:

1. In **Settings → Pages → Build and deployment → Source**, choose **GitHub Actions**.
2. Push changes to `main`. [pages.yml](./.github/workflows/pages.yml) installs Node.js 24 and Rust 1.93.0's WASM target, then runs `npm ci`, `npm run check`, and `npm run build`.
3. The workflow uploads `dist/` as the Pages artifact and deploys to the `github-pages` environment. Failed checks or builds prevent publication.
4. Confirm both `build` and `deploy` succeed, then open the [Pages game](https://kai987.github.io/FPV-drone-game/) and verify loading and takeoff.

You can also select `main` in **Actions → Deploy game to GitHub Pages → Run workflow** to redeploy manually. Other branches are not published; pushes and pull requests use the separate [ci.yml](./.github/workflows/ci.yml) checks. `dist/` and generated WASM are not committed. Ordinary CI success does not establish deployment completion. Workflow reference: [GitHub custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Rust and rendering architecture

- **Rust/WASM:** Flight position, velocity, attitude, and wind; terrain, rivers/lakes, bridges, roofs, decks, and obstacle spatial grids; bomb trajectories, first hits, scoring, and reloading; generation of woods, rocks, shrubs, terrain colors, and water textures; batched fish, livestock, and explosion animation calculations.
- **TypeScript/Three.js:** Input, shared map/drone configuration, rings and timing, audio, language and interface, plus geometry, materials, cameras, GPU water/fire/vegetation shaders, and 3D rendering.

One game shares one WASM instance and WebGL context. Each map owns independent world, flight, and weapon services. Services have their own buffers and lifecycles; adapters reacquire views after memory growth. One `simulate_world_tick` calculates flight and wind per flight frame. Weapons and animation services update in batches, then copy results into Three.js. Flight and bombs query the same Rust world directly.

Maps are scenes generated from shared configuration and procedural models, not complete 3D map files packed into Rust. Industrial buildings, rotated cargo, piers, breakwaters, and ship hulls use the same metre-based layout for rendering, the minimap, and Rust collisions. Nine piers and two breakwaters are uploaded once into Rust's land union, keeping terrain/water classification and support heights consistent.

Initial loading reuses decoded images, overlaps texture downloads with scene preparation, and serially compiles and warms all three maps' day/night GPU resources. Trees use instanced billboards. Basic urban structures are instanced by material; details use 600 m spatial chunks and a 450 m visibility margin around their bounding spheres. Night streetlights use a fixed pool of eight lights. All map and rendering resources are released when leaving the game.

Original TypeScript mathematics and frozen older scene/explosion equations remain independent test references. Production uses Rust services and shows a load failure instead of silently switching to JS physics. WASM calculations still run synchronously on the main thread, without a Worker. No FPS improvement is claimed for the Rust migration or map optimization; performance changes require separate measurement.

### Main directories

```text
rust-toolchain.toml          Rust version and WASM target
rust/flight-core/            Rust core, batch ABI, and native tests
scripts/build-wasm.mjs       Build and update WASM
scripts/optimize-textures.mjs Offline texture re-encoding
src/App.tsx                 Page, settings, and game state
src/i18n/                   Language context, storage, and translation catalogs
src/components/             Telemetry, minimap, guide, hangar, and touch controls
src/game/engine.ts          Frame loop, input, and challenge flow
src/game/rust-runtime.ts    Shared WASM instance and memory views
src/game/*-simulation.ts    Flight, weapon, scene, and animation adapters
src/game/world-kernel.ts    Shared geography and Rust world queries
src/game/map-*.ts           Map catalog, layouts, and preparation cache
src/game/urban-*.ts         Urban scenery, roads, sea, and sky
src/game/drone*.ts          Drone configuration and shared 3D models
src/game/world.ts           Map entry point and valley scenery
src/game/landscape.ts       Valley bounds, rivers/lakes, and terrain reference
src/game/rural*.ts          Rural layout, models, and animals
src/game/water.ts           Multiscale water textures and reflections
src/game/records.ts         Personal bests by condition
src/game/generated/        Generated WASM; not committed
public/assets/              Bundled artwork
tests/                      Native WASM integration and independent references
docs/design.md              Design and validation notes
docs/asset-licenses.md      Asset sources and offline processing records
```

## Validation

`npm run check` runs native Cargo tests, Node tests using the real WASM file, and TypeScript checks. `npm run build` validates production output. Test counts grow with features; use the command results as the current count.

Coverage includes numerical compatibility across six drones, two handling modes, four wind strengths, eight directions, and 30/60/120 fps; complete Valley and urban eight-ring routes using ordinary controls; pause, invalid time steps, bounds, bridges, roofs/decks, elevated and rotated-object collisions, weapon lifecycles, layered impact surfaces, records and language storage, map caching, and resource cleanup. Seeded scenery, complete terrain heights/colors, water textures/flow, batched fish/livestock/explosion animation, expanded-map roads, berths, land/water boundaries, and minimap bounds are also checked.

Browser checks include three-map preloading, map/drone switching, day/night, bombing, language changes, minimap/touch interaction at desktop and mobile sizes, page overflow, and the console. Browser viewport checks are not physical-phone GPU benchmarks, and real drone performance is outside validation scope.

## Artwork and license

The snowy-mountain, pine-valley, and blue-sky panorama began as a 1774×887 image generated with built-in Image Gen, then received 4× Real-ESRGAN upscaling. A 7096×3548 HD WebP or 3548×1774 mobile version is selected according to viewport width and GPU capability. This is enhanced artwork, not native 7K/8K photography. The sky follows the camera, forests below the horizon transition into fog, and rivers/lakes share the panorama for reflections.

Transparent pines, grass, and weathered-rock textures are also generated artwork converted offline to WebP. Pine RGBA values are preserved pixel for pixel; grass and rocks retain their original dimensions. Texture optimization did not replace the HD panorama. Encoding tools are offline utilities, not player or build dependencies. Sources, processing commands, license notes, and SHA256 values are documented in the [asset records](./docs/asset-licenses.md) and [design notes](./docs/design.md).

The HUD and controls use HTML/SVG, with Lucide icons. Fonts use Manrope/Noto Sans with system fallbacks. Source code is covered by the repository's [MIT License](./LICENSE). Asset provenance and third-party tool licenses are described separately in the asset records; software licenses are not presented as licenses for generated images or model weights.
