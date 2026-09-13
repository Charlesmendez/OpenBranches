import { access, lstat, mkdtemp, readFile, readlink, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  absoluteBundleSymlinks,
  lipoArchitecture,
  macArguments,
  macArtifactPaths,
  releaseMetadata,
  sha256File,
  validateLegalResources,
} from './macos-artifacts.mjs';

if (process.platform !== 'darwin') throw new Error('Mac artifact verification requires macOS.');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const options = macArguments(process.argv.slice(2));
const metadata = await releaseMetadata(root);
const artifact = macArtifactPaths({ root, ...metadata, ...options });
const verifyBundleIdentifier = (application) => {
  const identifier = execFileSync(
    '/usr/libexec/PlistBuddy',
    ['-c', 'Print :CFBundleIdentifier', join(application, 'Contents', 'Info.plist')],
    { encoding: 'utf8' },
  ).trim();
  if (identifier !== metadata.bundleIdentifier)
    throw new Error(
      `The packaged bundle identifier is ${identifier || 'missing'}, expected ${metadata.bundleIdentifier}.`,
    );
};
await Promise.all([
  access(artifact.application),
  access(artifact.executable),
  access(artifact.diskImage),
  access(artifact.archive),
]);
verifyBundleIdentifier(artifact.application);

execFileSync(
  '/usr/bin/lipo',
  [artifact.executable, '-verify_arch', lipoArchitecture(options.architecture)],
  {
    stdio: 'inherit',
  },
);
execFileSync('/usr/bin/hdiutil', ['verify', artifact.diskImage], { stdio: 'inherit' });
if (options.release) {
  execFileSync(
    '/usr/bin/codesign',
    ['--verify', '--deep', '--strict', '--verbose=2', artifact.application],
    { stdio: 'inherit' },
  );
  execFileSync('/usr/bin/xcrun', ['stapler', 'validate', artifact.application], {
    stdio: 'inherit',
  });
  execFileSync('/usr/bin/xcrun', ['stapler', 'validate', artifact.diskImage], {
    stdio: 'inherit',
  });
}

const mount = await mkdtemp(join(tmpdir(), 'openbranches-verify-'));
let attached = false;
try {
  execFileSync(
    '/usr/bin/hdiutil',
    ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, artifact.diskImage],
    { stdio: 'ignore' },
  );
  attached = true;
  const mountedApplication = join(mount, `${metadata.productName}.app`);
  await access(mountedApplication);
  verifyBundleIdentifier(mountedApplication);
  await validateLegalResources(mountedApplication);
  const applicationsLink = join(mount, 'Applications');
  if (!(await lstat(applicationsLink)).isSymbolicLink())
    throw new Error('The DMG is missing its Applications shortcut.');
  if ((await readlink(applicationsLink)) !== '/Applications')
    throw new Error('The DMG Applications shortcut has an unexpected destination.');
  const invalidSymlinks = await absoluteBundleSymlinks(mountedApplication);
  if (invalidSymlinks.length)
    throw new Error('The DMG application contains an absolute bundle symlink.');
  if (options.release)
    execFileSync(
      '/usr/bin/codesign',
      ['--verify', '--deep', '--strict', '--verbose=2', mountedApplication],
      { stdio: 'inherit' },
    );
} finally {
  try {
    if (attached) execFileSync('/usr/bin/hdiutil', ['detach', mount], { stdio: 'ignore' });
  } finally {
    await rm(mount, { recursive: true, force: true });
  }
}

const digest = await sha256File(artifact.diskImage);
const expected = `${digest}  ${basename(artifact.diskImage)}\n`;
if ((await readFile(artifact.checksum, 'utf8')) !== expected)
  throw new Error(`Checksum does not match ${basename(artifact.diskImage)}.`);

const archiveDigest = await sha256File(artifact.archive);
const archiveExpected = `${archiveDigest}  ${basename(artifact.archive)}\n`;
if ((await readFile(artifact.archiveChecksum, 'utf8')) !== archiveExpected)
  throw new Error(`Checksum does not match ${basename(artifact.archive)}.`);

const archiveStage = await mkdtemp(join(tmpdir(), 'openbranches-update-verify-'));
try {
  execFileSync('/usr/bin/ditto', ['-x', '-k', artifact.archive, archiveStage], {
    stdio: 'inherit',
  });
  const archivedApplication = join(archiveStage, `${metadata.productName}.app`);
  const archivedExecutable = join(archivedApplication, 'Contents', 'MacOS', metadata.productName);
  await access(archivedExecutable);
  verifyBundleIdentifier(archivedApplication);
  await validateLegalResources(archivedApplication);
  const invalidSymlinks = await absoluteBundleSymlinks(archivedApplication);
  if (invalidSymlinks.length)
    throw new Error('The update archive application contains an absolute bundle symlink.');
  execFileSync(
    '/usr/bin/lipo',
    [archivedExecutable, '-verify_arch', lipoArchitecture(options.architecture)],
    { stdio: 'inherit' },
  );
  if (options.release) {
    execFileSync(
      '/usr/bin/codesign',
      ['--verify', '--deep', '--strict', '--verbose=2', archivedApplication],
      { stdio: 'inherit' },
    );
    execFileSync('/usr/bin/xcrun', ['stapler', 'validate', archivedApplication], {
      stdio: 'inherit',
    });
  }
} finally {
  await rm(archiveStage, { recursive: true, force: true });
}

console.log(
  `Verified ${basename(artifact.diskImage)} and ${basename(artifact.archive)} for ${options.architecture}.`,
);
