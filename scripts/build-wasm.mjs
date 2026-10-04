import { copyFile, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const targetDirectory = join(projectRoot, 'rust/flight-core/target');
const outputFile = join(projectRoot, 'src/game/generated/flight_core.wasm');
const artifactFile = join(targetDirectory, 'wasm32-unknown-unknown/release/flight_core.wasm');

const build = spawnSync('cargo', [
  'build', '--release', '--locked', '--target', 'wasm32-unknown-unknown',
  '--manifest-path', join(projectRoot, 'rust/flight-core/Cargo.toml'),
], {
  cwd: projectRoot,
  env: { ...process.env, CARGO_TARGET_DIR: targetDirectory },
  stdio: 'inherit',
});

if (build.error) {
  console.error(`Unable to run Cargo: ${build.error.message}`);
  console.error('Install Rust with rustup; rust-toolchain.toml selects the required toolchain and WASM target.');
  process.exit(1);
}
if (build.status !== 0) process.exit(build.status ?? 1);

const artifact = await readFile(artifactFile);
const wasmHeader = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
if (!artifact.subarray(0, wasmHeader.length).equals(wasmHeader)) {
  throw new Error('Cargo did not produce a valid WebAssembly module.');
}

await mkdir(dirname(outputFile), { recursive: true });
const temporaryFile = `${outputFile}.${process.pid}.tmp`;
try {
  await copyFile(artifactFile, temporaryFile);
  await rename(temporaryFile, outputFile);
} finally {
  await rm(temporaryFile, { force: true });
}
console.log(`Built Rust flight core: ${artifact.length.toLocaleString('en-US')} bytes`);
