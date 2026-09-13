import { execFileSync } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  lipoArchitecture,
  macArguments,
  macArtifactPaths,
  releaseMetadata,
  sha256File,
  validateLegalResources,
} from './macos-artifacts.mjs';

if (process.platform !== 'darwin') throw new Error('Mac update archive creation requires macOS.');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const options = macArguments(process.argv.slice(2));
const release = process.env.OPENBRANCHES_SIGN_RELEASE === '1';
if (release !== options.release)
  throw new Error('The update archive release mode must match the packaged application.');
const metadata = await releaseMetadata(root);
const artifact = macArtifactPaths({ root, ...metadata, ...options });
await Promise.all([access(artifact.application), access(artifact.executable)]);
await validateLegalResources(artifact.application);
await mkdir(dirname(artifact.archive), { recursive: true });

execFileSync(
  '/usr/bin/lipo',
  [artifact.executable, '-verify_arch', lipoArchitecture(options.architecture)],
  { stdio: 'inherit' },
);
if (release) {
  execFileSync(
    '/usr/bin/codesign',
    ['--verify', '--deep', '--strict', '--verbose=2', artifact.application],
    { stdio: 'inherit' },
  );
  execFileSync('/usr/bin/xcrun', ['stapler', 'validate', artifact.application], {
    stdio: 'inherit',
  });
}

execFileSync(
  '/usr/bin/ditto',
  ['-c', '-k', '--sequesterRsrc', '--keepParent', artifact.application, artifact.archive],
  { stdio: 'inherit' },
);
const digest = await sha256File(artifact.archive);
await writeFile(artifact.archiveChecksum, `${digest}  ${basename(artifact.archive)}\n`, {
  mode: 0o644,
});
console.log(`Created ${artifact.archive}`);
console.log(`Created ${artifact.archiveChecksum}`);
