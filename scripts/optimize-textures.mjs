import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Encoding is an offline maintenance step; npm build requires no image tools.
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const originalRef = '62450333fb213aa24209bd97f843b7731ccba4de';
const textures = [
  {
    name: 'pine-tree', extension: 'png', options: ['-lossless', '-z', '9', '-exact'],
    sha256: 'd4d02182025151fccbca3067e1a35e81a6306a40b5b23d4372f396d5f695f552',
  },
  {
    name: 'grass-texture', extension: 'jpg', options: ['-q', '90', '-m', '6', '-sharp_yuv'],
    sha256: '4761685fff92bd29e837a5be9e93491644fb103633eade16835fc7da63d25caf',
  },
  {
    name: 'weathered-rock', extension: 'jpg', options: ['-q', '90', '-m', '6', '-sharp_yuv'],
    sha256: 'f79e0e94f74d31f319e6316835da6d896063649e94dd8e8392d4481f6e3574b2',
  },
];

let sourceRef = originalRef;
let sourceDirectory;
let outputDirectory = join(projectRoot, 'public/assets');
for (let index = 2; index < process.argv.length; index += 2) {
  const option = process.argv[index];
  const value = process.argv[index + 1];
  if (!value) throw new Error(`Missing value for ${option}.`);
  if (option === '--source-ref') sourceRef = value;
  else if (option === '--source-dir') sourceDirectory = resolve(value);
  else if (option === '--output-dir') outputDirectory = resolve(value);
  else throw new Error(`Unknown option: ${option}.`);
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'aeroflow-textures-'));
try {
  const encoded = [];
  for (const texture of textures) {
    const originalName = `${texture.name}.${texture.extension}`;
    let original;
    if (sourceDirectory) original = await readFile(join(sourceDirectory, originalName));
    else {
      const restored = spawnSync('git', ['show', `${sourceRef}:public/assets/${originalName}`], {
        cwd: projectRoot, maxBuffer: 8 * 1024 * 1024,
      });
      if (restored.error) throw restored.error;
      if (restored.status !== 0) throw new Error(restored.stderr.toString());
      original = restored.stdout;
    }
    if (createHash('sha256').update(original).digest('hex') !== texture.sha256) {
      throw new Error(`${originalName} does not match the documented source; refusing to recompress an unknown image.`);
    }
    const sourcePath = join(temporaryDirectory, originalName);
    const outputName = `${texture.name}.webp`;
    const outputPath = join(temporaryDirectory, outputName);
    await writeFile(sourcePath, original);
    const encoder = spawnSync('cwebp', [
      ...texture.options, '-metadata', 'none', '-quiet', sourcePath, '-o', outputPath,
    ], { stdio: 'inherit' });
    if (encoder.error) throw new Error(`Unable to run cwebp: ${encoder.error.message}. Install libwebp to regenerate textures.`);
    if (encoder.status !== 0) throw new Error(`cwebp failed for ${originalName}.`);
    const size = (await stat(outputPath)).size;
    if (size >= original.length) throw new Error(`${outputName} did not reduce the source file size.`);
    encoded.push({ originalName, outputName, outputPath, size, originalSize: original.length });
  }

  // Finish every encode before replacing production files. The panoramas are untouched.
  await mkdir(outputDirectory, { recursive: true });
  for (const texture of encoded) await copyFile(texture.outputPath, join(outputDirectory, texture.outputName));
  for (const texture of encoded) {
    await rm(join(outputDirectory, texture.originalName), { force: true });
    console.log(`${texture.outputName}: ${texture.originalSize} → ${texture.size} bytes`);
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
