import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TeamDatabase } from '../src/db';
import { TeamStore } from '../src/store';
import { TeamEvents } from '../src/events';
import { secretHash } from '../src/secrets';
import { teamViewSchema, projectAccessSchema } from '../../src/team/responses';
import { searchPattern } from '../src/visible';
import { companionResponse } from '../../src/team/device';
import type { Credential } from '../src/access';
import { sharedWorkStale, type SharedSnapshot } from '../../src/team/protocol';

const url = process.env.OPENBRANCHES_TEAM_TEST_DATABASE_URL;
if (!url)
  throw new Error(
    'Run the isolated PostgreSQL test command; OPENBRANCHES_TEAM_TEST_DATABASE_URL is required.',
  );
const db = new TeamDatabase(url);
const events = new TeamEvents(db);
let nextId = 10_000_000 + Math.floor(Math.random() * 100_000_000);
const consent = { taskTitles: false, taskSummaries: false };
const snapshot = (): SharedSnapshot => ({
  version: 1,
  observedAt: new Date().toISOString(),
  sourceError: false,
  omittedBranches: 0,
  branches: [
    {
      key: 'a'.repeat(64),
      name: 'feat/private-local-work',
      detached: false,
      localSha: 'b'.repeat(40),
      worktrees: { total: 1, available: 1, dirty: 1, changedFiles: 2 },
      integration: [],
      tasks: [],
      omittedTasks: 0,
    },
  ],
});
beforeAll(async () => {
  await db.migrate();
  await db.migrate();
  await events.start();
});
afterAll(async () => {
  await events.close();
  await db.close();
});
async function fixture() {
  const ownerIdentity = { id: nextId++, login: 'fixture-owner-' + nextId, type: 'User' as const };
  const memberIdentity = { id: nextId++, login: 'fixture-member-' + nextId, type: 'User' as const };
  const store = new TeamStore(db, String(ownerIdentity.id));
  const ownerSession = await store.identities.signIn(ownerIdentity),
    memberSession = await store.identities.signIn(memberIdentity);
  const owner: Credential = { kind: 'session', token: ownerSession.token },
    member: Credential = { kind: 'session', token: memberSession.token };
  const workspace = await store.identities.createWorkspace(owner, 'Fictional team ' + randomUUID());
  await store.members.add(owner, workspace.id, memberIdentity);
  const project = await store.members.createProject(owner, workspace.id, 'Fictional project');
  await store.members.grant(owner, workspace.id, project.id, memberSession.user.id, true, true);
  const pair = async (auth: Credential, name: string) => {
    const pending = await store.pairings.start({ deviceName: name });
    const approved = await store.pairings.approve(auth, {
      workspaceId: workspace.id,
      userCode: pending.userCode,
    });
    return {
      ...approved,
      token: pending.pairingSecret,
      credential: { kind: 'device' as const, token: pending.pairingSecret },
    };
  };
  const device = await pair(member, 'Fictional Mac');
  const share = await store.sharing.change(device.credential, workspace.id, project.id, {
    expectedEpoch: 0,
    enabled: true,
    consent,
  });
  return {
    store,
    owner,
    member,
    workspace,
    project,
    device,
    share,
    pair,
    memberId: memberSession.user.id,
    memberIdentity,
    ownerIdentity,
  };
}

describe('PostgreSQL team authorization and sharing', () => {
  it('fences a canceled first enable after access removal without permitting a late enable or crossing tenants', async () => {
    const f = await fixture();
    const project = await f.store.members.createProject(
      f.owner,
      f.workspace.id,
      'Uncertain first share',
    );
    await f.store.members.grant(f.owner, f.workspace.id, project.id, f.memberId, true, true);
    // The member approved an enable at epoch zero, then stopped before knowing
    // whether that request reached the service. Access was also removed.
    await f.store.members.grant(f.owner, f.workspace.id, project.id, f.memberId, false, false);
    const stopped = await f.store.sharing.change(f.device.credential, f.workspace.id, project.id, {
      expectedEpoch: 0,
      enabled: false,
      consent,
    });
    expect(stopped).toMatchObject({ epoch: 1, enabled: false, sequence: 0 });
    await f.store.members.grant(f.owner, f.workspace.id, project.id, f.memberId, true, true);
    await expect(
      f.store.sharing.change(f.device.credential, f.workspace.id, project.id, {
        expectedEpoch: 0,
        enabled: true,
        consent,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await f.store.views.view(f.owner, f.workspace.id)).work).toEqual([]);
    const other = await fixture();
    await expect(
      f.store.sharing.change(f.device.credential, f.workspace.id, other.project.id, {
        expectedEpoch: 0,
        enabled: false,
        consent,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('gives a companion only its account, device, permitted projects and own sharing settings', async () => {
    const f = await fixture();
    const profile = await f.store.views.companion(f.device.credential, f.workspace.id);
    expect(companionResponse.safeParse(profile).success).toBe(true);
    expect(profile.member.id).toBe(f.memberId);
    expect(profile.device.id).toBe(f.device.deviceId);
    expect(profile.projects.map((p) => p.id)).toEqual([f.project.id]);
    expect(profile.shares).toHaveLength(1);
    expect(JSON.stringify(profile)).not.toContain('snapshot');
    await f.store.members.createProject(f.owner, f.workspace.id, 'Hidden project');
    expect(
      (await f.store.views.companion(f.device.credential, f.workspace.id)).projects,
    ).toHaveLength(1);
    await expect(f.store.views.companion(f.owner, f.workspace.id)).rejects.toMatchObject({
      status: 403,
    });
    await f.store.members.grant(f.owner, f.workspace.id, f.project.id, f.memberId, false, false);
    const removed = await f.store.views.companion(f.device.credential, f.workspace.id);
    expect(removed.projects).toEqual([]);
    expect(removed.shares[0].enabled).toBe(false);
    await f.store.sharing.revokeDevice(f.member, f.workspace.id, f.device.deviceId);
    await expect(
      f.store.views.companion(f.device.credential, f.workspace.id),
    ).rejects.toMatchObject({ status: 401 });
  });
  it('pairs a member account to a specific device and shares only into an authorized project', async () => {
    const f = await fixture();
    await f.store.sharing.publish(f.device.credential, f.workspace.id, f.project.id, {
      epoch: f.share.epoch,
      sequence: 1,
      snapshot: snapshot(),
    });
    const view = await f.store.views.view(f.owner, f.workspace.id);
    expect(view.work).toHaveLength(1);
    expect(view.work[0]).toMatchObject({
      deviceId: f.device.deviceId,
      memberId: f.memberId,
      projectId: f.project.id,
      sequence: 1,
    });
    expect(view.people).toHaveLength(2);
    expect(sharedWorkStale(view.work[0])).toBe(false);
    const raw = await db.pool.query('SELECT token_hash FROM ob_devices WHERE id=$1', [
      f.device.deviceId,
    ]);
    expect(raw.rows[0].token_hash).toBe(secretHash(f.device.token));
    expect(JSON.stringify(view)).not.toContain(f.device.token);
  });
  it('starts with no shared snapshots and keeps signing in separate from device approval', async () => {
    const f = await fixture(),
      pending = await f.store.pairings.start({ deviceName: 'Second Mac' });
    expect((await f.store.views.view(f.owner, f.workspace.id)).work).toEqual([]);
    expect(await f.store.pairings.poll(pending.pairingSecret)).toEqual({ state: 'pending' });
    await expect(
      f.store.views.view({ kind: 'device', token: pending.pairingSecret }, f.workspace.id),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      f.store.pairings.approve(f.device.credential, {
        workspaceId: f.workspace.id,
        userCode: pending.userCode,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('enforces workspace boundaries for browser sessions and paired device tokens', async () => {
    const a = await fixture(),
      b = await fixture();
    await expect(a.store.views.view(a.owner, b.workspace.id)).rejects.toMatchObject({
      status: 401,
    });
    await expect(a.store.views.view(a.device.credential, b.workspace.id)).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      a.store.sharing.change(a.device.credential, a.workspace.id, b.project.id, {
        expectedEpoch: 0,
        enabled: true,
        consent,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      a.store.members.add(a.device.credential, a.workspace.id, b.ownerIdentity),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('checks per-project read and share permissions on every request', async () => {
    const f = await fixture(),
      privateProject = await f.store.members.createProject(
        f.owner,
        f.workspace.id,
        'Owner-only project',
      );
    const ownerDevice = await f.pair(f.owner, 'Owner Mac');
    const share = await f.store.sharing.change(
      ownerDevice.credential,
      f.workspace.id,
      privateProject.id,
      { expectedEpoch: 0, enabled: true, consent },
    );
    await f.store.sharing.publish(ownerDevice.credential, f.workspace.id, privateProject.id, {
      epoch: share.epoch,
      sequence: 1,
      snapshot: snapshot(),
    });
    const memberView = await f.store.views.view(f.member, f.workspace.id);
    expect(memberView.projects.map((project) => project.id)).not.toContain(privateProject.id);
    expect(memberView.work).toHaveLength(0);
    await f.store.members.grant(
      f.owner,
      f.workspace.id,
      privateProject.id,
      f.memberId,
      true,
      false,
    );
    expect((await f.store.views.view(f.member, f.workspace.id)).work).toHaveLength(1);
    await expect(
      f.store.sharing.change(f.device.credential, f.workspace.id, privateProject.id, {
        expectedEpoch: 0,
        enabled: true,
        consent,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('rejects task text outside the stored consent and rejects extra fields', async () => {
    const f = await fixture(),
      value = snapshot();
    value.branches[0].tasks = [
      { key: 'c'.repeat(64), tool: 'codex', association: 'verified', title: 'Unapproved title' },
    ];
    await expect(
      f.store.sharing.publish(f.device.credential, f.workspace.id, f.project.id, {
        epoch: f.share.epoch,
        sequence: 1,
        snapshot: value,
      }),
    ).rejects.toMatchObject({ code: 'consent_mismatch' });
    await expect(
      f.store.sharing.publish(f.device.credential, f.workspace.id, f.project.id, {
        epoch: f.share.epoch,
        sequence: 1,
        snapshot: { ...snapshot(), path: '/Users/private' },
      }),
    ).rejects.toHaveProperty('issues');
    expect((await f.store.views.view(f.owner, f.workspace.id)).work).toHaveLength(0);
  });
  it('invalidates snapshots when consent changes and rejects uploads from the previous epoch', async () => {
    const f = await fixture();
    await f.store.sharing.publish(f.device.credential, f.workspace.id, f.project.id, {
      epoch: 1,
      sequence: 1,
      snapshot: snapshot(),
    });
    const next = await f.store.sharing.change(f.device.credential, f.workspace.id, f.project.id, {
      expectedEpoch: 1,
      enabled: true,
      consent: { taskTitles: true, taskSummaries: false },
    });
    expect(next.epoch).toBe(2);
    expect((await f.store.views.view(f.owner, f.workspace.id)).work).toHaveLength(0);
    await expect(
      f.store.sharing.publish(f.device.credential, f.workspace.id, f.project.id, {
        epoch: 1,
        sequence: 2,
        snapshot: snapshot(),
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      f.store.sharing.change(f.device.credential, f.workspace.id, f.project.id, {
        expectedEpoch: 1,
        enabled: true,
        consent,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('cannot resurrect unpublished work when stopping sharing races an upload', async () => {
    const f = await fixture();
    const result = await Promise.allSettled([
      f.store.sharing.publish(f.device.credential, f.workspace.id, f.project.id, {
        epoch: 1,
        sequence: 1,
        snapshot: snapshot(),
      }),
      f.store.sharing.change(f.device.credential, f.workspace.id, f.project.id, {
        expectedEpoch: 1,
        enabled: false,
        consent,
      }),
    ]);
    expect(result[1].status).toBe('fulfilled');
    expect((await f.store.views.view(f.owner, f.workspace.id)).work).toHaveLength(0);
    const state = await f.store.sharing.state(f.device.credential, f.workspace.id);
    expect(state[0]).toMatchObject({ epoch: 2, enabled: false, sequence: 0 });
    await expect(
      f.store.sharing.publish(f.device.credential, f.workspace.id, f.project.id, {
        epoch: 1,
        sequence: 2,
        snapshot: snapshot(),
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (
        await db.pool.query('SELECT snapshot FROM ob_shares WHERE device_id=$1', [
          f.device.deviceId,
        ])
      ).rows[0].snapshot,
    ).toBeNull();
  });
  it('orders concurrent snapshots monotonically and rejects duplicate or older sequences', async () => {
    const f = await fixture();
    await Promise.allSettled(
      [2, 3].map((sequence) =>
        f.store.sharing.publish(f.device.credential, f.workspace.id, f.project.id, {
          epoch: 1,
          sequence,
          snapshot: snapshot(),
        }),
      ),
    );
    expect((await f.store.views.view(f.owner, f.workspace.id)).work[0].sequence).toBe(3);
    await expect(
      f.store.sharing.publish(f.device.credential, f.workspace.id, f.project.id, {
        epoch: 1,
        sequence: 3,
        snapshot: snapshot(),
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('withdraws work on project access removal and does not restore it by regranting access', async () => {
    const f = await fixture();
    await f.store.sharing.publish(f.device.credential, f.workspace.id, f.project.id, {
      epoch: 1,
      sequence: 1,
      snapshot: snapshot(),
    });
    await f.store.members.grant(f.owner, f.workspace.id, f.project.id, f.memberId, false, false);
    expect((await f.store.views.view(f.owner, f.workspace.id)).work).toHaveLength(0);
    await expect(
      f.store.sharing.publish(f.device.credential, f.workspace.id, f.project.id, {
        epoch: 1,
        sequence: 2,
        snapshot: snapshot(),
      }),
    ).rejects.toMatchObject({ status: 403 });
    await f.store.members.grant(f.owner, f.workspace.id, f.project.id, f.memberId, true, true);
    await expect(
      f.store.sharing.publish(f.device.credential, f.workspace.id, f.project.id, {
        epoch: 1,
        sequence: 2,
        snapshot: snapshot(),
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('revokes a device atomically with its data and keeps an expired device as stale history', async () => {
    const f = await fixture();
    await f.store.sharing.publish(f.device.credential, f.workspace.id, f.project.id, {
      epoch: 1,
      sequence: 1,
      snapshot: snapshot(),
    });
    await db.pool.query("UPDATE ob_devices SET expires_at=now()-interval '1 second' WHERE id=$1", [
      f.device.deviceId,
    ]);
    const work = (await f.store.views.view(f.owner, f.workspace.id)).work;
    expect(work).toHaveLength(1);
    expect(sharedWorkStale(work[0])).toBe(true);
    await expect(f.store.views.view(f.device.credential, f.workspace.id)).rejects.toMatchObject({
      status: 401,
    });
    await f.store.sharing.revokeDevice(f.member, f.workspace.id, f.device.deviceId);
    expect((await f.store.views.view(f.owner, f.workspace.id)).work).toHaveLength(0);
  });
  it('does not revive old device tokens or grants when a removed member is added again', async () => {
    const f = await fixture();
    await f.store.sharing.publish(f.device.credential, f.workspace.id, f.project.id, {
      epoch: 1,
      sequence: 1,
      snapshot: snapshot(),
    });
    await f.store.members.remove(f.owner, f.workspace.id, f.memberId);
    await expect(f.store.views.view(f.member, f.workspace.id)).rejects.toMatchObject({
      status: 401,
    });
    await f.store.members.add(f.owner, f.workspace.id, f.memberIdentity);
    expect((await f.store.views.view(f.member, f.workspace.id)).projects).toHaveLength(0);
    await expect(f.store.views.view(f.device.credential, f.workspace.id)).rejects.toMatchObject({
      status: 401,
    });
    expect((await f.store.views.view(f.owner, f.workspace.id)).work).toHaveLength(0);
  });
  it('preserves revocation when a restarted service receives a late upload', async () => {
    const f = await fixture();
    await f.store.sharing.revokeDevice(f.owner, f.workspace.id, f.device.deviceId);
    const restarted = new TeamStore(db, String(f.ownerIdentity.id));
    await expect(
      restarted.sharing.publish(f.device.credential, f.workspace.id, f.project.id, {
        epoch: 1,
        sequence: 99,
        snapshot: snapshot(),
      }),
    ).rejects.toMatchObject({ status: 401 });
  });
  it('makes pairing single-use, cancellable, and rate-limited without issuing another credential', async () => {
    const f = await fixture(),
      pending = await f.store.pairings.start({ deviceName: 'Pending Mac' });
    await f.store.pairings.poll(pending.pairingSecret);
    await expect(f.store.pairings.poll(pending.pairingSecret)).rejects.toMatchObject({
      status: 429,
    });
    await f.store.pairings.cancel(pending.pairingSecret);
    await expect(
      f.store.pairings.approve(f.member, {
        workspaceId: f.workspace.id,
        userCode: pending.userCode,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const approved = await f.store.pairings.start({ deviceName: 'Approved Mac' });
    await f.store.pairings.approve(f.member, {
      workspaceId: f.workspace.id,
      userCode: approved.userCode,
    });
    const polled = await f.store.pairings.poll(approved.pairingSecret);
    expect(polled.state).toBe('paired');
    expect(JSON.stringify(polled)).not.toContain(approved.pairingSecret);
    await expect(
      f.store.pairings.approve(f.member, {
        workspaceId: f.workspace.id,
        userCode: approved.userCode,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await f.store.pairings.cancel(approved.pairingSecret);
    await expect(
      f.store.views.view({ kind: 'device', token: approved.pairingSecret }, f.workspace.id),
    ).rejects.toMatchObject({ status: 401 });
  });
  it('notifies subscribers only after a sharing transaction commits', async () => {
    const f = await fixture();
    let notify!: () => void;
    const notified = new Promise<void>((resolve) => {
      notify = resolve;
    });
    const unsubscribe = events.subscribe(f.workspace.id, notify);
    try {
      await f.store.sharing.publish(f.device.credential, f.workspace.id, f.project.id, {
        epoch: 1,
        sequence: 1,
        snapshot: snapshot(),
      });
      await notified;
      expect((await f.store.views.view(f.member, f.workspace.id)).work[0].sequence).toBe(1);
    } finally {
      unsubscribe();
    }
  });
  it('rechecks device authorization after an upload waits behind a revocation lock', async () => {
    const f = await fixture(),
      blocker = await db.pool.connect();
    let upload: Promise<unknown> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM ob_workspaces WHERE id=$1 FOR UPDATE', [f.workspace.id]);
      await blocker.query('UPDATE ob_devices SET revoked_at=now() WHERE id=$1', [
        f.device.deviceId,
      ]);
      const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      upload = f.store.sharing
        .publish(f.device.credential, f.workspace.id, f.project.id, {
          epoch: 1,
          sequence: 1,
          snapshot: snapshot(),
        })
        .then(
          () => ({ accepted: true }),
          (error: unknown) => error,
        );
      let waiting = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        waiting = (
          await db.pool.query(
            'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1::integer = ANY(pg_blocking_pids(pid))) AS waiting',
            [pid],
          )
        ).rows[0].waiting;
        if (waiting) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await blocker.query('COMMIT');
      expect(await upload).toMatchObject({ status: 401 });
      expect((await f.store.views.view(f.owner, f.workspace.id)).work).toHaveLength(0);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await upload;
    }
  });
  it('keeps two members and devices independent when one stops sharing', async () => {
    const f = await fixture(),
      ownerDevice = await f.pair(f.owner, 'Fictional owner Mac');
    await f.store.sharing.change(ownerDevice.credential, f.workspace.id, f.project.id, {
      expectedEpoch: 0,
      enabled: true,
      consent,
    });
    for (const device of [f.device, ownerDevice])
      await f.store.sharing.publish(device.credential, f.workspace.id, f.project.id, {
        epoch: 1,
        sequence: 1,
        snapshot: snapshot(),
      });
    const before = (await f.store.views.view(f.member, f.workspace.id)).work;
    expect(new Set(before.map((item) => item.memberId)).size).toBe(2);
    expect(new Set(before.map((item) => item.deviceId)).size).toBe(2);
    await expect(
      f.store.sharing.revokeDevice(f.device.credential, f.workspace.id, ownerDevice.deviceId),
    ).rejects.toMatchObject({ status: 403 });
    await f.store.sharing.change(f.device.credential, f.workspace.id, f.project.id, {
      expectedEpoch: 1,
      enabled: false,
      consent,
    });
    expect((await f.store.views.view(f.member, f.workspace.id)).work).toMatchObject([
      { deviceId: ownerDevice.deviceId },
    ]);
  });
  it('paginates shared work without duplicates and reports bounded project coverage', async () => {
    const f = await fixture();
    await f.store.sharing.publish(f.device.credential, f.workspace.id, f.project.id, {
      epoch: 1,
      sequence: 1,
      snapshot: snapshot(),
    });
    for (let index = 0; index < 10; index++) {
      const device = await f.pair(f.member, 'Fictional pagination Mac ' + index);
      await f.store.sharing.change(device.credential, f.workspace.id, f.project.id, {
        expectedEpoch: 0,
        enabled: true,
        consent,
      });
      await f.store.sharing.publish(device.credential, f.workspace.id, f.project.id, {
        epoch: 1,
        sequence: 1,
        snapshot: snapshot(),
      });
    }
    const first = await f.store.views.view(f.member, f.workspace.id);
    expect(first.work).toHaveLength(10);
    expect(first.nextCursor).not.toBeNull();
    const second = await f.store.views.view(f.member, f.workspace.id, {
      after: first.nextCursor!.split(':'),
    });
    expect(second.work).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.work, ...second.work].map((item) => item.deviceId)).size).toBe(11);
    expect(first.workspace.revision).toBe(second.workspace.revision);
    await db.pool.query(
      "INSERT INTO ob_projects(id,workspace_id,name) SELECT gen_random_uuid(),$1,'Fictional coverage project ' || n FROM generate_series(1,1000) n",
      [f.workspace.id],
    );
    const owner = await f.store.views.view(f.owner, f.workspace.id);
    expect(owner.projects).toHaveLength(1000);
    expect(owner.coverage).toEqual({ people: true, projects: false });
    expect((await f.store.views.view(f.member, f.workspace.id)).coverage.projects).toBe(true);
  });
  it('searches authorized branch metadata and counts only matching reports', async () => {
    const f = await fixture(),
      value = snapshot();
    value.branches.push({ ...value.branches[0], key: 'c'.repeat(64), name: 'fix/billing_100%' });
    value.branches[0].tasks = [
      {
        key: 'd'.repeat(64),
        tool: 'claude-code',
        association: 'verified',
        checkedAt: value.observedAt,
      },
    ];
    await f.store.sharing.publish(f.device.credential, f.workspace.id, f.project.id, {
      epoch: 1,
      sequence: 1,
      snapshot: value,
    });
    const found = await f.store.views.view(f.member, f.workspace.id, { query: 'billing_100%' });
    expect(teamViewSchema.safeParse(found).success).toBe(true);
    expect(found.totals.reports).toBe(1);
    expect(found.work[0].snapshot.branches.map((branch) => branch.name)).toEqual([
      'fix/billing_100%',
    ]);
    expect(
      (await f.store.views.view(f.member, f.workspace.id, { query: '100_' })).totals.reports,
    ).toBe(0);
    expect(searchPattern('100%_')).toBe('%100\\%\\_%');
    expect(
      (await f.store.views.view(f.member, f.workspace.id, { query: 'Claude Code' })).totals.reports,
    ).toBe(1);
    const privateProject = await f.store.members.createProject(
        f.owner,
        f.workspace.id,
        'Private billing project',
      ),
      ownerDevice = await f.pair(f.owner, 'Fictional private Mac');
    await f.store.sharing.change(ownerDevice.credential, f.workspace.id, privateProject.id, {
      expectedEpoch: 0,
      enabled: true,
      consent,
    });
    await f.store.sharing.publish(ownerDevice.credential, f.workspace.id, privateProject.id, {
      epoch: 1,
      sequence: 1,
      snapshot: snapshot(),
    });
    expect(
      (await f.store.views.view(f.member, f.workspace.id, { query: 'Private billing project' }))
        .totals.reports,
    ).toBe(0);
    expect(
      (await f.store.views.view(f.owner, f.workspace.id, { query: 'Private billing project' }))
        .totals.reports,
    ).toBe(1);
  });
  it('exposes project permission settings only to the workspace owner browser', async () => {
    const f = await fixture();
    const access = await f.store.views.projectAccess(f.owner, f.workspace.id, f.project.id);
    expect(projectAccessSchema.safeParse(access).success).toBe(true);
    expect(access.members).toEqual([{ memberId: f.memberId, enabled: true, canShare: true }]);
    await expect(
      f.store.views.projectAccess(f.member, f.workspace.id, f.project.id),
    ).rejects.toMatchObject({ status: 403 });
    const ownerDevice = await f.pair(f.owner, 'Fictional owner device');
    await expect(
      f.store.views.projectAccess(ownerDevice.credential, f.workspace.id, f.project.id),
    ).rejects.toMatchObject({ status: 403 });
    const other = await fixture();
    await expect(
      f.store.views.projectAccess(f.owner, f.workspace.id, other.project.id),
    ).rejects.toMatchObject({ status: 403 });
  });
});
