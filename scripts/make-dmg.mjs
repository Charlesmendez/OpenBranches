import { access, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  absoluteBundleSymlinks,
  macArguments,
  macArtifactPaths,
  releaseMetadata,
  sha256File,
  validateLegalResources,
} from './macos-artifacts.mjs';

if (process.platform !== 'darwin') throw new Error('DMG creation requires macOS.');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const options = macArguments(process.argv.slice(2));
const release = process.env.OPENBRANCHES_SIGN_RELEASE === '1';
if (release !== options.release)
  throw new Error('The DMG release mode must match the packaged application.');
const metadata = await releaseMetadata(root);
const artifact = macArtifactPaths({ root, ...metadata, ...options });
await Promise.all([access(artifact.application), access(artifact.executable)]);
await validateLegalResources(artifact.application);
await mkdir(dirname(artifact.diskImage), { recursive: true });

execFileSync('/usr/bin/lipo', [artifact.executable, '-verify_arch', options.architecture], {
  stdio: 'inherit',
});
if (release)
  execFileSync(
    '/usr/bin/codesign',
    ['--verify', '--deep', '--strict', '--verbose=2', artifact.application],
    { stdio: 'inherit' },
  );

const stage = await mkdtemp(join(tmpdir(), 'openbranches-dmg-'));
try {
  const stagedApplication = join(stage, `${metadata.productName}.app`);
  execFileSync('/usr/bin/ditto', [artifact.application, stagedApplication], { stdio: 'inherit' });
  const invalidSymlinks = await absoluteBundleSymlinks(stagedApplication);
  if (invalidSymlinks.length)
    throw new Error('The staged application contains an absolute bundle symlink.');
  await validateLegalResources(stagedApplication);
  if (release)
    execFileSync(
      '/usr/bin/codesign',
      ['--verify', '--deep', '--strict', '--verbose=2', stagedApplication],
      { stdio: 'inherit' },
    );
  await symlink('/Applications', join(stage, 'Applications'));
  execFileSync(
    '/usr/bin/hdiutil',
    [
      'create',
      '-ov',
      '-format',
      'UDZO',
      '-volname',
      metadata.productName,
      '-srcfolder',
      stage,
      artifact.diskImage,
    ],
    { stdio: 'inherit' },
  );
  if (release) {
    execFileSync(
      '/usr/bin/xcrun',
      [
        'notarytool',
        'submit',
        artifact.diskImage,
        '--apple-id',
        process.env.APPLE_ID,
        '--password',
        process.env.APPLE_APP_SPECIFIC_PASSWORD,
        '--team-id',
        process.env.APPLE_TEAM_ID,
        '--wait',
      ],
      { stdio: 'inherit' },
    );
    execFileSync('/usr/bin/xcrun', ['stapler', 'staple', artifact.diskImage], {
      stdio: 'inherit',
    });
  }
  execFileSync('/usr/bin/hdiutil', ['verify', artifact.diskImage], { stdio: 'inherit' });
  const digest = await sha256File(artifact.diskImage);
  await writeFile(artifact.checksum, `${digest}  ${basename(artifact.diskImage)}\n`, {
    mode: 0o644,
  });
  console.log(`Created ${artifact.diskImage}`);
  console.log(`Created ${artifact.checksum}`);
} finally {
  await rm(stage, { recursive: true, force: true });
}
