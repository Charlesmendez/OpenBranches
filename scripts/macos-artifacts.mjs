import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, readlink, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const architectures = new Set(['arm64', 'x64']);
const productPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const versionPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const bundleIdentifierPattern = /^(?:[A-Za-z0-9-]+\.)+[A-Za-z0-9-]+$/;

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
  if (!bundleIdentifierPattern.test(value.openbranches?.bundleIdentifier ?? ''))
    throw new Error('package.json needs a reverse-DNS OpenBranches bundle identifier.');
  return {
    productName: value.productName,
    version: value.version,
    bundleIdentifier: value.openbranches.bundleIdentifier,
  };
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

export async function validateLegalResources(application) {
  const resources = join(application, 'Contents', 'Resources');
  const [license, notices, chromium] = await Promise.all([
    readFile(join(resources, 'OPENBRANCHES_LICENSE.txt'), 'utf8'),
    readFile(join(resources, 'THIRD_PARTY_NOTICES.txt'), 'utf8'),
    stat(join(resources, 'LICENSES.chromium.html')),
  ]);
  if (!license.includes('Copyright (c) 2026 Carlos Mendez'))
    throw new Error('The application license is missing or unexpected.');
  if (!notices.startsWith('# OpenBranches third-party notices\n'))
    throw new Error('The third-party notices are missing or unexpected.');
  if (chromium.size < 1_000_000)
    throw new Error('The Chromium license collection is missing or incomplete.');
}
