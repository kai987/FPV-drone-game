import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createBuildInfo, sourceFingerprint } from '../scripts/build-info.ts';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aeroflow-build-info-'));
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'public'));
  writeFileSync(join(root, 'package.json'), '{"version":"1.0.0"}');
  writeFileSync(join(root, 'src', 'main.ts'), 'export const game = 1;');
  writeFileSync(join(root, 'public', 'texture.webp'), Buffer.from([1, 2, 3, 4]));
  return root;
}

test('build identity is reproducible across checkouts and detects changes to source and shipped assets', () => {
  const a = fixture(), b = fixture();
  try {
    const before = sourceFingerprint(a);
    assert.equal(sourceFingerprint(b), before, 'machine paths and timestamps do not change identity');
    writeFileSync(join(a, 'README.md'), 'Documentation is not part of the browser build.');
    assert.equal(sourceFingerprint(a), before);
    writeFileSync(join(a, 'public', 'texture.webp'), Buffer.from([1, 2, 3, 5]));
    assert.notEqual(sourceFingerprint(a), before, 'the actual texture bytes are part of the identity');
    writeFileSync(join(a, 'public', 'texture.webp'), readFileSync(join(b, 'public', 'texture.webp')));
    writeFileSync(join(a, 'src', 'main.ts'), 'export const game = 2;');
    assert.notEqual(sourceFingerprint(a), before);
  } finally { rmSync(a, { recursive: true }); rmSync(b, { recursive: true }); }
});

test('a clean commit is identified exactly, while uncommitted source never claims to be that release', () => {
  const root = fixture();
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    git('init'); git('add', '.');
    git('-c', 'user.name=Build test', '-c', 'user.email=build@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Fixture');
    git('remote', 'add', 'origin', 'https://github.com/kai987/FPV-drone-game.git');
    const clean = createBuildInfo(root);
    assert.equal(clean.sourceRevision, git('rev-parse', 'HEAD'));
    assert.equal(clean.sourceDirty, false);
    assert.equal(clean.sourceRepository, 'https://github.com/kai987/FPV-drone-game');
    assert.equal(clean.appVersion, '1.0.0');
    writeFileSync(join(root, 'src', 'main.ts'), 'export const game = 3;');
    const changed = createBuildInfo(root);
    assert.equal(changed.sourceRevision, clean.sourceRevision);
    assert.equal(changed.sourceDirty, true);
    assert.notEqual(changed.buildId, clean.buildId);
    assert.notEqual(changed.sourceFingerprint, clean.sourceFingerprint);
    git('remote', 'set-url', 'origin', 'https://site-source.example.invalid/project.git');
    assert.equal(createBuildInfo(root).sourceRepository, null, 'Site repository SHAs never become invented GitHub links');
    git('remote', 'set-url', 'origin', 'git@github.com:kai987/FPV-drone-game.git');
    assert.equal(createBuildInfo(root).sourceRepository, clean.sourceRepository);
  } finally { rmSync(root, { recursive: true }); }
});

test('source archives without Git have an honest content identity and no invented revision', () => {
  const root = fixture();
  try {
    const info = createBuildInfo(root);
    assert.equal(info.sourceRevision, null);
    assert.equal(info.sourceRepository, null);
    assert.equal(info.sourceDirty, true);
    assert.match(info.sourceFingerprint, /^[a-f0-9]{64}$/);
    assert.match(info.buildId, /^archive-dirty-[a-f0-9]{12}$/);
  } finally { rmSync(root, { recursive: true }); }
});
