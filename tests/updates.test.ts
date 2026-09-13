import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { UpdateService, type NativeUpdater } from '../electron/updates/service';

class FakeUpdater extends EventEmitter implements NativeUpdater {
  feed?: { url: string };
  checks = 0;
  installs = 0;

  setFeedURL(options: { url: string }) {
    this.feed = options;
  }

  checkForUpdates() {
    this.checks++;
  }

  quitAndInstall() {
    this.installs++;
  }
}

describe('desktop updates', () => {
  it('stays unavailable outside a packaged Mac app', async () => {
    const updater = new FakeUpdater();
    const service = new UpdateService(updater, '0.1.4', vi.fn(), { enabled: false });
    expect(service.current()).toEqual({ currentVersion: '0.1.4', state: 'unavailable' });
    expect(await service.check()).toEqual({ currentVersion: '0.1.4', state: 'unavailable' });
    expect(updater.feed).toBeUndefined();
    expect(updater.checks).toBe(0);
  });

  it('uses the public architecture-specific OpenBranches feed and coalesces checks', async () => {
    const updater = new FakeUpdater();
    const published = vi.fn();
    const service = new UpdateService(updater, '0.1.4', published, {
      enabled: true,
      platform: 'darwin',
      architecture: 'arm64',
    });
    expect(updater.feed?.url).toBe(
      'https://update.electronjs.org/Charlesmendez/OpenBranches/darwin-arm64/0.1.4',
    );

    const first = service.check();
    const second = service.check();
    expect(updater.checks).toBe(1);
    updater.emit('update-available');
    await expect(first).resolves.toMatchObject({ state: 'downloading' });
    await expect(second).resolves.toMatchObject({ state: 'downloading' });
    expect(published).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentVersion: '0.1.4', state: 'downloading' }),
    );
    service.close();
  });

  it('publishes release details and installs only a downloaded update', async () => {
    const updater = new FakeUpdater();
    const service = new UpdateService(updater, '0.1.4', vi.fn(), {
      enabled: true,
      platform: 'darwin',
      architecture: 'x64',
      now: () => new Date('2026-09-12T12:00:00.000Z'),
    });
    expect(() => service.install()).toThrow(/No downloaded update/);
    const checking = service.check();
    updater.emit(
      'update-downloaded',
      {},
      'Fixes update discovery and improves release handling.',
      'OpenBranches v0.1.5',
      new Date('2026-09-12T11:00:00.000Z'),
      'https://example.invalid/update.zip',
    );
    await expect(checking).resolves.toMatchObject({
      state: 'ready',
      availableVersion: '0.1.5',
      releaseName: 'OpenBranches v0.1.5',
      releaseDate: '2026-09-12T11:00:00.000Z',
      checkedAt: '2026-09-12T12:00:00.000Z',
    });
    service.install();
    expect(updater.installs).toBe(1);
    service.close();
  });

  it('reports a current version and makes failed checks retryable', async () => {
    const updater = new FakeUpdater();
    const service = new UpdateService(updater, '0.1.4', vi.fn(), {
      enabled: true,
      now: () => new Date('2026-09-12T12:00:00.000Z'),
    });
    const current = service.check();
    updater.emit('update-not-available');
    await expect(current).resolves.toEqual({
      currentVersion: '0.1.4',
      state: 'current',
      checkedAt: '2026-09-12T12:00:00.000Z',
    });
    const failed = service.check();
    updater.emit('error', new Error('Feed unavailable'));
    await expect(failed).resolves.toMatchObject({ state: 'error', error: 'Feed unavailable' });
    service.close();
  });
});
