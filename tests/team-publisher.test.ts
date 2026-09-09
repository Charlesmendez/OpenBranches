import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TeamPublisher } from '../electron/team/publisher';
import type { SecretVault } from '../electron/services/secretVault';
import { AppStore } from '../electron/services/store';
import { publishSchema, sharingChangeSchema, type SharedSnapshot } from '../src/team/protocol';
import { teamDeviceFixture } from './helpers/teamDeviceFixture';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.useRealTimers();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function fixture(suppliedVault?: SecretVault) {
  const f = teamDeviceFixture();
  let publisher: TeamPublisher;
  const connection = await f.connect(f.service((id) => publisher?.confirmedRevocation(id)));
  cleanup.push(() => connection.close());
  const base = f.request.getMockImplementation()!;
  const uploads: { projectId: string; sequence: number; snapshot: SharedSnapshot }[] = [];
  const mutations: { method: string; projectId: string; enabled?: boolean; epoch: number }[] = [];
  const request: typeof fetch = async (url, options) => {
    const parts = new URL(String(url)).pathname.split('/');
    if (!parts.includes('shares')) return base(url, options);
    const projectId = parts[5];
    const remote = f.profile.shares.find((s) => s.projectId === projectId);
    if (options?.method === 'PUT') {
      const command = sharingChangeSchema.parse(JSON.parse(String(options.body)));
      if ((remote?.epoch ?? 0) !== command.expectedEpoch) return Response.json({}, { status: 409 });
      if (command.enabled && !f.profile.projects.some((p) => p.id === projectId && p.canShare))
        return Response.json({}, { status: 403 });
      const next = {
        projectId,
        epoch: command.expectedEpoch + 1,
        sequence: 0,
        enabled: command.enabled,
        consent: command.enabled ? command.consent : { taskTitles: false, taskSummaries: false },
        receivedAt: null,
      };
      f.profile.shares = [...f.profile.shares.filter((s) => s.projectId !== projectId), next];
      mutations.push({ method: 'PUT', projectId, epoch: next.epoch, enabled: command.enabled });
      const { receivedAt: _received, ...response } = next;
      return Response.json({ ...response, revision: '2' });
    }
    const command = publishSchema.parse(JSON.parse(String(options?.body)));
    if (!remote?.enabled || remote.epoch !== command.epoch || remote.sequence >= command.sequence)
      return Response.json({}, { status: 409 });
    remote.sequence = command.sequence;
    remote.receivedAt = new Date().toISOString();
    mutations.push({ method: 'POST', projectId, epoch: remote.epoch });
    uploads.push({ projectId, sequence: command.sequence, snapshot: command.snapshot });
    return Response.json({ sequence: command.sequence, revision: '3' });
  };
  f.request.mockImplementation(request);
  let saved: string | undefined;
  const vault = suppliedVault ?? {
    read: () => saved,
    write: (text: string | undefined) => {
      saved = text;
    },
  };
  const make = () => {
    const instance = new TeamPublisher(
      vault,
      connection,
      () => f.snapshot,
      () => {},
    );
    publisher = instance;
    cleanup.push(() => instance.close());
    return publisher;
  };
  publisher = make();
  const preview = () =>
    connection.preview({
      connectionId: connection.state().connections[0].id,
      repositoryId: f.snapshot.repositories[0].id,
      projectId: f.profile.projects[0].id,
      consent: { taskTitles: false, taskSummaries: false },
    });
  const share = async () => {
    const review = await preview();
    await publisher.approve(review.id);
    await publisher.refresh();
    return publisher.state().shares[0];
  };
  return {
    ...f,
    connection,
    publisher,
    vault,
    make,
    preview,
    share,
    fetchMock: f.request,
    request,
    uploads,
    mutations,
  };
}

describe('explicit native project publication', () => {
  it('uploads only after approving a live main-process preview and keeps text choices independent', async () => {
    const f = await fixture();
    await f.publisher.refresh();
    const review = await f.preview();
    expect(f.mutations).toEqual([]);
    await expect(f.publisher.approve(randomUUID())).rejects.toThrow('new metadata preview');
    const rendererCopy = structuredClone(review);
    rendererCopy.consent.taskTitles = true;
    await f.publisher.approve(rendererCopy.id);
    await f.publisher.refresh();
    expect(f.publisher.state().shares[0]).toMatchObject({
      state: 'sharing',
      consent: { taskTitles: false, taskSummaries: false },
    });
    expect(f.uploads).toHaveLength(1);
    expect(f.uploads[0].projectId).toBe(f.profile.projects[0].id);
    expect(
      f.uploads[0].snapshot.branches
        .flatMap((b) => b.tasks)
        .every((t) => t.title === undefined && t.summary === undefined),
    ).toBe(true);
    const text = JSON.stringify(f.uploads);
    expect(text).not.toContain(f.snapshot.repositories[0].path);
    expect(text).not.toContain(f.token);
    await expect(f.publisher.approve(review.id)).rejects.toThrow('new metadata preview');
  });
  it('rejects expired, changed, or unmonitored previews and cannot replace an active destination', async () => {
    const f = await fixture();
    const stale = await f.preview();
    vi.setSystemTime(Date.now() + 300001);
    await expect(f.publisher.approve(stale.id)).rejects.toThrow('new metadata preview');
    const changed = await f.preview();
    f.profile.shares.push({
      projectId: changed.projectId,
      epoch: 1,
      sequence: 0,
      enabled: false,
      consent: { taskTitles: false, taskSummaries: false },
      receivedAt: null,
    });
    await expect(f.publisher.approve(changed.id)).rejects.toThrow('sharing changed');
    const removed = await f.preview();
    const repository = f.snapshot.repositories.shift()!;
    await expect(f.publisher.approve(removed.id)).rejects.toThrow('no longer monitored');
    f.snapshot.repositories.unshift(repository);
    await f.share();
    const duplicate = await f.preview();
    await expect(f.publisher.approve(duplicate.id)).rejects.toThrow('Stop the current sharing');
  });
  it('never enables sharing if the approval could not be saved', async () => {
    const f = await fixture(),
      review = await f.preview();
    f.vault.write = () => {
      throw new Error('Storage unavailable');
    };
    await expect(f.publisher.approve(review.id)).rejects.toThrow('Storage unavailable');
    expect(f.mutations).toEqual([]);
    expect(f.publisher.state().shares).toEqual([]);
  });
  it('recovers an enable whose reply was lost without enabling it twice', async () => {
    const f = await fixture();
    let lost = false;
    const transport = f.fetchMock;
    transport.mockImplementation(
      async (url: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]) => {
        const result = await f.request(url, options);
        if (!lost && options?.method === 'PUT' && JSON.parse(String(options.body)).enabled) {
          lost = true;
          throw new Error('Reply lost after commit');
        }
        return result;
      },
    );
    await f.share();
    expect(f.publisher.state().shares[0].state).toBe('starting');
    f.publisher.close();
    const restarted = f.make();
    await restarted.refresh();
    expect(restarted.state().shares[0].state).toBe('sharing');
    expect(f.mutations.filter((m) => m.method === 'PUT' && m.enabled)).toHaveLength(1);
    expect(f.uploads).toHaveLength(1);
  });
  it('reserves upload order before sending and recovers a lost acknowledgment after restart', async () => {
    const f = await fixture();
    let lost = false;
    f.fetchMock.mockImplementation(async (url, options) => {
      const response = await f.request(url, options);
      if (!lost && String(url).endsWith('/snapshots')) {
        lost = true;
        throw new Error('Reply lost');
      }
      return response;
    });
    await f.share();
    expect(f.publisher.state().shares[0].lastUploadedAt).toBeUndefined();
    f.publisher.close();
    const restarted = f.make();
    await restarted.refresh();
    expect(f.uploads.map((u) => u.sequence)).toEqual([1, 2]);
    expect(restarted.state().shares[0].lastUploadedAt).toBeDefined();
    expect(f.uploads[1].snapshot.branches.map((b) => b.key)).toEqual(
      f.uploads[0].snapshot.branches.map((b) => b.key),
    );
  });
  it('fences a late enable after Stop sharing and never follows it with an upload', async () => {
    const f = await fixture(),
      delayed = deferred<Response>();
    let enabled: Response | undefined;
    f.fetchMock.mockImplementation(async (url, options) => {
      const response = await f.request(url, options);
      if (options?.method === 'PUT' && JSON.parse(String(options.body)).enabled) {
        enabled = response;
        return delayed.promise;
      }
      return response;
    });
    await f.publisher.approve((await f.preview()).id);
    const running = f.publisher.refresh();
    await vi.waitFor(() => expect(enabled).toBeDefined());
    const id = f.publisher.state().shares[0].id;
    f.publisher.stop(id);
    expect(f.publisher.state().shares[0]).toMatchObject({ state: 'stopping', stopSaved: true });
    delayed.resolve(enabled!);
    await running;
    await f.publisher.refresh();
    expect(f.uploads).toEqual([]);
    expect(f.profile.shares[0]).toMatchObject({ enabled: false, epoch: 2 });
    expect(f.publisher.state().shares[0].state).toBe('stopped');
  });
  it('persists an offline withdrawal and ignores a late upload reply after restart', async () => {
    const f = await fixture(),
      delayed = deferred<Response>();
    let uploaded: Response | undefined;
    f.fetchMock.mockImplementation(async (url, options) => {
      const response = await f.request(url, options);
      if (String(url).endsWith('/snapshots')) {
        uploaded = response;
        return delayed.promise;
      }
      return response;
    });
    await f.publisher.approve((await f.preview()).id);
    const running = f.publisher.refresh();
    await vi.waitFor(() => expect(uploaded).toBeDefined());
    f.publisher.stop(f.publisher.state().shares[0].id);
    f.publisher.close();
    f.fetchMock.mockRejectedValue(new Error('Offline'));
    const restarted = f.make();
    await restarted.refresh();
    expect(restarted.state().shares[0].state).toBe('stopping');
    delayed.resolve(uploaded!);
    await running;
    f.fetchMock.mockImplementation(f.request);
    vi.setSystemTime(Date.now() + 31000);
    await restarted.refresh();
    expect(restarted.state().shares[0].state).toBe('stopped');
    expect(f.profile.shares[0].enabled).toBe(false);
    expect(f.uploads).toHaveLength(1);
  });
  it('writes a withdrawal fence even when a canceled enable has not reached the service yet', async () => {
    const f = await fixture();
    let lateEnable: (() => Promise<Response>) | undefined;
    f.fetchMock.mockImplementation(async (url, options) => {
      if (options?.method === 'PUT' && JSON.parse(String(options.body)).enabled) {
        lateEnable = () => f.request(url, options);
        return new Promise((_resolve, reject) =>
          options.signal!.addEventListener('abort', () => reject(new Error('Canceled locally')), {
            once: true,
          }),
        );
      }
      return f.request(url, options);
    });
    await f.publisher.approve((await f.preview()).id);
    const running = f.publisher.refresh();
    await vi.waitFor(() => expect(lateEnable).toBeDefined());
    f.publisher.stop(f.publisher.state().shares[0].id);
    await running;
    await f.publisher.refresh();
    expect(f.publisher.state().shares[0].state).toBe('stopped');
    expect(f.profile.shares[0]).toMatchObject({ enabled: false, epoch: 1 });
    expect((await lateEnable!()).status).toBe(409);
    expect(f.uploads).toEqual([]);
  });
  it('does not claim withdrawal when the reply identifies a different project', async () => {
    const f = await fixture(),
      shared = await f.share();
    f.fetchMock.mockImplementation(async (url, options) => {
      const response = await f.request(url, options);
      if (options?.method === 'PUT' && !JSON.parse(String(options.body)).enabled)
        return Response.json({ ...(await response.json()), projectId: randomUUID() });
      return response;
    });
    f.publisher.stop(shared.id);
    await f.publisher.refresh();
    expect(f.publisher.state().shares[0].state).toBe('stopping');
    expect(f.publisher.state().shares[0].error).toContain('did not confirm');
    f.fetchMock.mockImplementation(f.request);
    vi.setSystemTime(Date.now() + 31000);
    await f.publisher.refresh();
    expect(f.publisher.state().shares[0].state).toBe('stopped');
  });
  it('does not re-enable a revoked share when project access is restored', async () => {
    const f = await fixture();
    await f.share();
    f.profile.projects[0].canShare = false;
    f.profile.shares[0] = {
      ...f.profile.shares[0],
      epoch: 2,
      enabled: false,
      sequence: 0,
      receivedAt: null,
    };
    vi.setSystemTime(Date.now() + 31000);
    await f.publisher.refresh();
    expect(f.publisher.state().shares[0].state).toBe('paused');
    f.profile.projects[0].canShare = true;
    vi.setSystemTime(Date.now() + 31000);
    await f.publisher.refresh();
    expect(f.mutations.filter((m) => m.enabled)).toHaveLength(1);
    expect(f.uploads).toHaveLength(1);
  });
  it('allows an explicit retry after an outage and follows renamed labels without changing project identity', async () => {
    const f = await fixture(),
      shared = await f.share();
    f.fetchMock.mockRejectedValue(new Error('Offline'));
    f.publisher.stop(shared.id);
    await f.publisher.refresh();
    expect(f.publisher.state().shares[0].state).toBe('stopping');
    f.fetchMock.mockImplementation(f.request);
    await f.publisher.refresh(true);
    expect(f.publisher.state().shares[0].state).toBe('stopped');
    await f.share();
    f.profile.projects[0].name = 'Renamed team project';
    f.snapshot.repositories[0].name = 'Renamed local project';
    await f.publisher.refresh(true);
    expect(f.publisher.state().shares[0]).toMatchObject({
      projectId: shared.projectId,
      projectName: 'Renamed team project',
      repositoryName: 'Renamed local project',
      state: 'sharing',
    });
  });
  it('pauses uploads on an unsaved Stop and retries persistence before any further network work', async () => {
    const f = await fixture(),
      shared = await f.share();
    const write = f.vault.write;
    f.vault.write = () => {
      throw new Error('Disk full');
    };
    expect(() => f.publisher.stop(shared.id)).toThrow('Could not save');
    expect(f.publisher.state().shares[0]).toMatchObject({ state: 'stopping', stopSaved: false });
    const count = f.mutations.length;
    vi.setSystemTime(Date.now() + 31000);
    await f.publisher.refresh();
    expect(f.mutations).toHaveLength(count);
    f.vault.write = write;
    await f.publisher.refresh();
    expect(f.publisher.state().shares[0]).toMatchObject({ state: 'stopped', stopSaved: true });
  });
  it('joins project removal storage atomically and only adopts the stop after commit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openbranches-publisher-test-'));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const store = new AppStore(directory);
    cleanup.push(() => store.close());
    const f = await fixture({
      read: () => store.readStrict('fixture.sharing') as string | undefined,
      write: (value) => store.write('fixture.sharing', value ?? null),
    });
    await f.share();
    const before = store.readStrict('fixture.sharing');
    const empty = { ...f.snapshot, repositories: [] };
    expect(() =>
      store.transaction(() => {
        f.publisher.prepareStopUnselected(empty);
        throw new Error('Rollback');
      }),
    ).toThrow('Rollback');
    expect(store.readStrict('fixture.sharing')).toBe(before);
    expect(f.publisher.state().shares[0].state).toBe('sharing');
    const adopt = store.transaction(() => f.publisher.prepareStopUnselected(empty));
    expect(f.publisher.state().shares[0].state).toBe('sharing');
    f.snapshot.repositories = [];
    adopt();
    await f.publisher.refresh();
    expect(f.publisher.state().shares[0].state).toBe('stopped');
    expect(f.uploads).toHaveLength(1);
  });
  it('marks shares withdrawn when device revocation is acknowledged and fails closed on corrupt choices', async () => {
    const f = await fixture(),
      shared = await f.share();
    await f.connection.disconnect(shared.connectionId);
    expect(f.publisher.state().shares[0].state).toBe('stopped');
    f.publisher.forget(shared.id);
    expect(f.publisher.state().shares).toEqual([]);
    f.publisher.close();
    f.vault.write('broken');
    const restarted = f.make();
    const count = f.mutations.length;
    await restarted.refresh();
    expect(restarted.state().error).toContain('could not be opened');
    expect(f.mutations).toHaveLength(count);
    expect(() => restarted.prepareStopUnselected({ ...f.snapshot, repositories: [] })).toThrow(
      'before removing',
    );
  });
  it('coalesces refreshes, bounds each pass, and reaches every approved project fairly', async () => {
    const f = await fixture();
    const first = await f.share();
    const template = JSON.parse(f.vault.read()!).shares[0];
    f.publisher.close();
    const records = Array.from({ length: 10 }, (_, i) => {
      const projectId = randomUUID();
      f.profile.projects.push({ ...f.profile.projects[0], id: projectId, name: 'Project ' + i });
      f.profile.shares.push({ ...f.profile.shares[0], projectId, sequence: 0, receivedAt: null });
      return {
        ...template,
        id: randomUUID(),
        projectId,
        sequence: 0,
        digest: undefined,
        lastUploadedAt: undefined,
      };
    });
    f.vault.write(JSON.stringify({ version: 1, shares: records }));
    const restarted = f.make();
    const before = f.uploads.length;
    const a = restarted.refresh(),
      b = restarted.refresh();
    expect(a).toBe(b);
    await a;
    expect(f.uploads.length - before).toBe(4);
    await restarted.refresh();
    expect(f.uploads.length - before).toBe(8);
    await restarted.refresh();
    expect(f.uploads.length - before).toBe(10);
    expect(new Set(f.uploads.slice(before).map((u) => u.projectId)).size).toBe(10);
    expect(f.uploads.slice(before).some((u) => u.projectId === first.projectId)).toBe(false);
  });
});
