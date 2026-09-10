import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, readlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const architectures = new Set(['arm64', 'x64']);
const productPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const versionPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export function macArguments(args, hostArchitecture = process.arch) {
  let architecture = hostArchitecture;
  let release = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--release') {
      release = true;
      continue;
    }
    if (argument === '--arch') {
      architecture = args[++index];
      if (!architecture) throw new Error('Pass arm64 or x64 after --arch.');
      continue;
    }
    if (argument.startsWith('--arch=')) {
      architecture = argument.slice('--arch='.length);
      continue;
    }
    throw new Error(`Unknown Mac packaging option: ${argument}`);
  }
  if (!architectures.has(architecture))
    throw new Error(`Unsupported Mac architecture: ${architecture}`);
  return { architecture, release };
}

export async function releaseMetadata(root) {
  const value = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (!productPattern.test(value.productName ?? ''))
    throw new Error('package.json needs a file-safe productName.');
  if (!versionPattern.test(value.version ?? ''))
    throw new Error('package.json needs a valid release version.');
  return { productName: value.productName, version: value.version };
}

export function macArtifactPaths({ root, productName, version, architecture, release }) {
  if (!architectures.has(architecture))
    throw new Error(`Unsupported Mac architecture: ${architecture}`);
  if (!productPattern.test(productName) || !versionPattern.test(version))
    throw new Error('Invalid Mac artifact metadata.');
  const packageName = `${productName}-darwin-${architecture}`;
  const diskImageName = `${productName}-${version}-mac-${architecture}${release ? '' : '-unsigned'}.dmg`;
  return {
    packageName,
    application: join(root, 'out', packageName, `${productName}.app`),
    executable: join(
      root,
      'out',
      packageName,
      `${productName}.app`,
      'Contents',
      'MacOS',
      productName,
    ),
    diskImage: join(root, 'out', 'make', diskImageName),
    checksum: join(root, 'out', 'make', `${diskImageName}.sha256`),
  };
}

export async function absoluteBundleSymlinks(root) {
  const invalid = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        if (isAbsolute(await readlink(path))) invalid.push(path);
      } else if (entry.isDirectory()) {
        await visit(path);
      }
    }
  };
  await visit(root);
  return invalid;
}

export function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}
