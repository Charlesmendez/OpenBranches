import { cp, mkdir, mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

if (process.platform !== 'darwin') throw new Error('DMG creation requires macOS.');
const output = resolve('out/make');
await mkdir(output, { recursive: true });
const packages = (await readdir('out')).filter((name) =>
  /^OpenBranches-darwin-(arm64|x64)$/.test(name),
);
if (!packages.length)
  throw new Error('Package OpenBranches with Electron Forge before creating a DMG.');
for (const name of packages) {
  const stage = await mkdtemp(join(tmpdir(), 'openbranches-dmg-'));
  try {
    const bundle = resolve('out', name, 'OpenBranches.app');
    await cp(bundle, join(stage, 'OpenBranches.app'), {
      recursive: true,
      preserveTimestamps: true,
    });
    await symlink('/Applications', join(stage, 'Applications'));
    const signed = process.env.OPENBRANCHES_SIGN_RELEASE === '1';
    const destination = join(output, `${name}${signed ? '' : '-unsigned'}.dmg`);
    execFileSync(
      '/usr/bin/hdiutil',
      [
        'create',
        '-ov',
        '-format',
        'UDZO',
        '-volname',
        'OpenBranches',
        '-srcfolder',
        stage,
        destination,
      ],
      { stdio: 'inherit' },
    );
    if (signed) {
      execFileSync(
        '/usr/bin/xcrun',
        [
          'notarytool',
          'submit',
          destination,
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
      execFileSync('/usr/bin/xcrun', ['stapler', 'staple', destination], { stdio: 'inherit' });
    }
    console.log(`Created ${destination}`);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
