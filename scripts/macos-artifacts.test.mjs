import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  absoluteBundleSymlinks,
  macArguments,
  macArtifactPaths,
  sha256File,
  validateLegalResources,
} from './macos-artifacts.mjs';

describe('Mac release artifacts', () => {
  it('defaults to the host architecture and an unsigned build', () => {
    assert.deepEqual(macArguments([], 'arm64'), { architecture: 'arm64', release: false });
  });

  it('accepts only the two supported Mac architectures', () => {
    assert.deepEqual(macArguments(['--release', '--arch=x64'], 'arm64'), {
      architecture: 'x64',
      release: true,
    });
    assert.deepEqual(macArguments(['--arch', 'arm64'], 'x64'), {
      architecture: 'arm64',
      release: false,
    });
    assert.throws(() => macArguments(['--arch=riscv64']), /Unsupported Mac architecture/);
    assert.throws(() => macArguments(['--publish']), /Unknown Mac packaging option/);
  });

  it('gives signed and preview installers distinct, readable names', () => {
    const input = {
      root: '/project',
      productName: 'OpenBranches',
      version: '0.1.0',
      architecture: 'arm64',
    };
    assert.equal(
      macArtifactPaths({ ...input, release: true }).diskImage,
      '/project/out/make/OpenBranches-0.1.0-mac-arm64.dmg',
    );
    assert.equal(
      macArtifactPaths({ ...input, release: false }).diskImage,
      '/project/out/make/OpenBranches-0.1.0-mac-arm64-unsigned.dmg',
    );
  });

  it('finds absolute symlinks that would break after distributing an app bundle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openbranches-artifacts-test-'));
    try {
      await mkdir(join(root, 'Framework.framework', 'Versions'), { recursive: true });
      await symlink('A', join(root, 'Framework.framework', 'Versions', 'Current'));
      await symlink('/private/source/Resources', join(root, 'Framework.framework', 'Resources'));
      assert.deepEqual(await absoluteBundleSymlinks(root), [
        join(root, 'Framework.framework', 'Resources'),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('hashes installer bytes for a reproducible checksum file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openbranches-artifacts-test-'));
    try {
      const installer = join(root, 'OpenBranches.dmg');
      await writeFile(installer, 'OpenBranches');
      assert.equal(
        await sha256File(installer),
        'f99fe37236921978b1cf7f8cabbbffaa6719bb7b087d3a8cf7b8561af1be6328',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('requires complete legal resources in the packaged application', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openbranches-artifacts-test-'));
    const resources = join(root, 'OpenBranches.app', 'Contents', 'Resources');
    try {
      await mkdir(resources, { recursive: true });
      await writeFile(
        join(resources, 'OPENBRANCHES_LICENSE.txt'),
        'Copyright (c) 2026 Carlos Mendez',
      );
      await writeFile(
        join(resources, 'THIRD_PARTY_NOTICES.txt'),
        '# OpenBranches third-party notices\n',
      );
      await writeFile(join(resources, 'LICENSES.chromium.html'), Buffer.alloc(1_000_000));
      await validateLegalResources(join(root, 'OpenBranches.app'));
      await writeFile(join(resources, 'LICENSES.chromium.html'), 'incomplete');
      await assert.rejects(
        validateLegalResources(join(root, 'OpenBranches.app')),
        /missing or incomplete/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
