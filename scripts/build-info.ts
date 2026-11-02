import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { BuildInfo } from '../src/game/build-info.ts';

const INPUTS = ['src', 'public', 'data', 'rust/flight-core/src', 'scripts', 'index.html',
  'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'rust-toolchain.toml',
  'rust/flight-core/Cargo.toml', 'rust/flight-core/Cargo.lock'];

/** Include source and the actual compiled WASM; ignore timestamps and machine paths. */
export function sourceFingerprint(root: string): string {
  const hash = createHash('sha256');
  const files: string[] = [];
  const collect = (path: string) => {
    if (!existsSync(path)) return;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Build input must not be a symbolic link: ${relative(root, path)}`);
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) if (!name.startsWith('.')) collect(join(path, name));
    } else if (stat.isFile() && !path.endsWith('.tmp')) files.push(path);
  };
  for (const input of INPUTS) collect(join(root, input));
  for (const path of files.sort()) {
    const bytes = readFileSync(path);
    hash.update(relative(root, path).replaceAll('\\', '/')).update('\0');
    hash.update(String(bytes.length)).update('\0').update(bytes).update('\0');
  }
  return hash.digest('hex');
}

export function createBuildInfo(root: string): BuildInfo {
  const git = (args: string[]) => {
    try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { return null; }
  };
  const head = git(['rev-parse', '--verify', 'HEAD']);
  const sourceRevision = head && /^[a-f0-9]{40,64}$/.test(head) ? head : null;
  const origin = git(['remote', 'get-url', 'origin']);
  let sourceRepository: string | null = null;
  try {
    const url = new URL(origin?.replace(/^git@github\.com:/, 'https://github.com/') ?? '');
    const repository = url.pathname.replace(/\.git\/?$/, '').replace(/\/$/, '').toLowerCase();
    if (url.hostname.toLowerCase() === 'github.com' && repository === '/kai987/fpv-drone-game') {
      sourceRepository = 'https://github.com/kai987/FPV-drone-game';
    }
  } catch { /* A separate Site repository or archive must not invent a GitHub link. */ }
  const status = git(['status', '--porcelain', '--untracked-files=normal']);
  const sourceDirty = sourceRevision === null || status === null || status !== '';
  const fingerprint = sourceFingerprint(root);
  let appVersion = 'unknown';
  try {
    const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
    if (typeof version === 'string') appVersion = version;
  } catch { /* Source archives still have an unambiguous content fingerprint. */ }
  return {
    schemaVersion: 1, appVersion,
    buildId: `${sourceRevision?.slice(0, 8) ?? 'archive'}${sourceDirty ? '-dirty' : ''}-${fingerprint.slice(0, 12)}`,
    sourceRevision, sourceRepository, sourceDirty, sourceFingerprint: fingerprint,
  };
}
