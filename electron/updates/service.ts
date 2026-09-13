import type { UpdateStatus } from '../../src/domain/types';

export interface NativeUpdater {
  setFeedURL(options: { url: string }): void;
  checkForUpdates(): void;
  quitAndInstall(): void;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener(event: string, listener: (...args: unknown[]) => void): unknown;
}

interface UpdateServiceOptions {
  enabled: boolean;
  owner?: string;
  repository?: string;
  platform?: string;
  architecture?: string;
  initialDelayMs?: number;
  intervalMs?: number;
  checkTimeoutMs?: number;
  now?: () => Date;
}

const releaseVersion = (name: string) =>
  name.match(/(?:^|\s)v?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/)?.[1];

const cleanText = (value: unknown, limit: number) => {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().slice(0, limit);
  return text || undefined;
};

export class UpdateService {
  private status: UpdateStatus;
  private readonly listeners: Array<[string, (...args: unknown[]) => void]> = [];
  private initialTimer?: ReturnType<typeof setTimeout>;
  private intervalTimer?: ReturnType<typeof setInterval>;
  private checkTimer?: ReturnType<typeof setTimeout>;
  private checkPromise?: Promise<UpdateStatus>;
  private finishCheck?: (status: UpdateStatus) => void;
  private readonly now: () => Date;
  private readonly timeoutMs: number;

  constructor(
    private readonly updater: NativeUpdater,
    currentVersion: string,
    private readonly publish: (status: UpdateStatus) => void,
    private readonly options: UpdateServiceOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.checkTimeoutMs ?? 30_000;
    this.status = {
      currentVersion,
      state: options.enabled ? 'idle' : 'unavailable',
    };
    if (!options.enabled) return;

    const owner = options.owner ?? 'Charlesmendez';
    const repository = options.repository ?? 'OpenBranches';
    const platform = options.platform ?? process.platform;
    const architecture = options.architecture ?? process.arch;
    const feed = `https://update.electronjs.org/${owner}/${repository}/${platform}-${architecture}/${currentVersion}`;
    updater.setFeedURL({ url: feed });
    this.listen('checking-for-update', () =>
      this.transition({ state: 'checking', error: undefined }),
    );
    this.listen('update-available', () => {
      const status = this.transition({ state: 'downloading', error: undefined });
      this.resolveCheck(status);
    });
    this.listen('update-not-available', () => {
      const status = this.transition({ state: 'current', checkedAt: this.now().toISOString() });
      this.resolveCheck(status);
    });
    this.listen('update-downloaded', (_event, notes, name, date) => {
      const releaseName = cleanText(name, 160);
      const releaseNotes = cleanText(notes, 8_000);
      const releaseDate =
        date instanceof Date && !Number.isNaN(date.valueOf()) ? date.toISOString() : undefined;
      const status = this.transition({
        state: 'ready',
        availableVersion: releaseName ? releaseVersion(releaseName) : undefined,
        releaseName,
        releaseNotes,
        releaseDate,
        checkedAt: this.now().toISOString(),
        error: undefined,
      });
      this.resolveCheck(status);
    });
    this.listen('error', (first, second) => {
      const error = second ?? first;
      const message = error instanceof Error ? error.message : cleanText(error, 500);
      const status = this.transition({
        state: 'error',
        checkedAt: this.now().toISOString(),
        error: message ?? 'OpenBranches could not check for updates.',
      });
      this.resolveCheck(status);
    });
  }

  current() {
    return { ...this.status };
  }

  start() {
    if (!this.options.enabled || this.initialTimer || this.intervalTimer) return;
    this.initialTimer = setTimeout(() => void this.check(), this.options.initialDelayMs ?? 12_000);
    this.initialTimer.unref?.();
    this.intervalTimer = setInterval(
      () => void this.check(),
      this.options.intervalMs ?? 4 * 60 * 60 * 1_000,
    );
    this.intervalTimer.unref?.();
  }

  check() {
    if (!this.options.enabled) return Promise.resolve(this.current());
    if (this.status.state === 'downloading' || this.status.state === 'ready')
      return Promise.resolve(this.current());
    if (this.checkPromise) return this.checkPromise;

    this.transition({ state: 'checking', error: undefined });
    this.checkPromise = new Promise<UpdateStatus>((resolve) => {
      this.finishCheck = resolve;
      this.checkTimer = setTimeout(() => {
        const status = this.transition({
          state: 'error',
          checkedAt: this.now().toISOString(),
          error: 'The update check timed out. Try again in a moment.',
        });
        this.resolveCheck(status);
      }, this.timeoutMs);
      this.checkTimer.unref?.();
      try {
        this.updater.checkForUpdates();
      } catch (error) {
        const status = this.transition({
          state: 'error',
          checkedAt: this.now().toISOString(),
          error:
            error instanceof Error ? error.message : 'OpenBranches could not check for updates.',
        });
        this.resolveCheck(status);
      }
    });
    return this.checkPromise.finally(() => {
      this.checkPromise = undefined;
    });
  }

  install() {
    if (this.status.state !== 'ready') throw new Error('No downloaded update is ready to install.');
    this.updater.quitAndInstall();
  }

  close() {
    if (this.initialTimer) clearTimeout(this.initialTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    if (this.checkTimer) clearTimeout(this.checkTimer);
    for (const [event, listener] of this.listeners) this.updater.removeListener(event, listener);
    this.listeners.length = 0;
    this.resolveCheck(this.current());
  }

  private listen(event: string, listener: (...args: unknown[]) => void) {
    this.listeners.push([event, listener]);
    this.updater.on(event, listener);
  }

  private transition(next: Partial<UpdateStatus> & Pick<UpdateStatus, 'state'>) {
    this.status = { ...this.status, ...next };
    const status = this.current();
    this.publish(status);
    return status;
  }

  private resolveCheck(status: UpdateStatus) {
    if (this.checkTimer) clearTimeout(this.checkTimer);
    this.checkTimer = undefined;
    const finish = this.finishCheck;
    this.finishCheck = undefined;
    finish?.(status);
  }
}
