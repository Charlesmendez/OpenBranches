import { z } from 'zod';
import {
  attentionBucket,
  attentionDecisionCommand,
  attentionKind,
  attentionPage,
  storedAttentionProjection,
  storedLocalAttentionProjection,
  type AttentionBucket,
  type AttentionEvidenceItem,
  type AttentionItem,
  type LocalAttentionEvidenceItem,
} from '../../src/team/attention';
import { workspaceAccess, type Credential } from './access';
import type { TeamDatabase } from './db';
import { denied, TeamError } from './errors';

const viewOptions = z.strictObject({
  projectId: z.uuid().optional(),
  bucket: attentionBucket.optional(),
  kind: attentionKind.optional(),
  query: z.string().max(160).optional(),
});
interface GitHubSourceRow {
  projectId: string;
  project: string;
  attention: unknown;
  lastError: boolean;
}
interface LocalSourceRow {
  projectId: string;
  project: string;
  deviceId: string;
  memberId: string;
  device: string;
  person: string;
  deviceExpiresAt: Date;
  observedAt: Date;
  receivedAt: Date;
  sourceError: boolean;
  attention: unknown;
}
interface DecisionRow {
  findingId: string;
  revision: string;
  choice: 'snoozed' | 'dismissed';
  decidedAt: Date;
  until: Date | null;
}

/** A browser-only, permission-scoped inbox over persisted GitHub and opted-in
 * local evidence. Decisions belong to one user and never mutate a repository. */
export class TeamAttention {
  constructor(private db: TeamDatabase) {}

  async view(credential: Credential, workspace: string, options: unknown = {}) {
    const filter = viewOptions.parse(options),
      wantedBucket = filter.bucket ?? 'active',
      now = Date.now();
    return this.db.transaction(async (client) => {
      const principal = await workspaceAccess(client, credential, workspace);
      if (principal.deviceId) throw denied();
      const github = await client.query<GitHubSourceRow>(
          `SELECT s.project_id AS "projectId",p.name AS project,s.attention,s.last_error AS "lastError"
          FROM ob_github_sources s JOIN ob_projects p ON p.workspace_id=s.workspace_id AND p.id=s.project_id AND p.active
          LEFT JOIN ob_project_access access ON access.workspace_id=p.workspace_id AND access.project_id=p.id AND access.user_id=$2
          WHERE s.workspace_id=$1 AND ($3::boolean OR access.user_id IS NOT NULL)
            AND ($4::uuid IS NULL OR p.id=$4)
          ORDER BY p.name,p.id`,
          [workspace, principal.userId, principal.role === 'owner', filter.projectId ?? null],
        ),
        local = await client.query<LocalSourceRow>(
          `SELECT s.project_id AS "projectId",p.name AS project,d.id AS "deviceId",d.user_id AS "memberId",
          d.name AS device,u.login AS person,d.expires_at AS "deviceExpiresAt",s.observed_at AS "observedAt",
          s.received_at AS "receivedAt",(s.snapshot->>'sourceError')::boolean AS "sourceError",s.attention
          FROM ob_shares s JOIN ob_devices d ON d.workspace_id=s.workspace_id AND d.id=s.device_id AND d.revoked_at IS NULL
          JOIN ob_members m ON m.workspace_id=d.workspace_id AND m.user_id=d.user_id AND m.active
          JOIN ob_users u ON u.id=m.user_id
          JOIN ob_projects p ON p.workspace_id=s.workspace_id AND p.id=s.project_id AND p.active
          LEFT JOIN ob_project_access access ON access.workspace_id=p.workspace_id AND access.project_id=p.id AND access.user_id=$2
          WHERE s.workspace_id=$1 AND s.enabled AND s.snapshot IS NOT NULL
            AND ($3::boolean OR access.user_id IS NOT NULL) AND ($4::uuid IS NULL OR p.id=$4)
          ORDER BY p.name,p.id,d.id`,
          [workspace, principal.userId, principal.role === 'owner', filter.projectId ?? null],
        ),
        githubDecisions = await decisions(
          client,
          'ob_attention_decisions',
          workspace,
          principal.userId,
          principal.role === 'owner',
          filter.projectId,
        ),
        localDecisions = await decisions(
          client,
          'ob_local_attention_decisions',
          workspace,
          principal.userId,
          principal.role === 'owner',
          filter.projectId,
        ),
        choices = new Map([
          ...githubDecisions.rows.map((row) => ['github:' + row.findingId, row] as const),
          ...localDecisions.rows.map((row) => ['local:' + row.findingId, row] as const),
        ]),
        query = filter.query?.trim().toLowerCase() ?? '',
        presented: AttentionItem[] = [],
        queue = { active: 0, snoozed: 0, dismissed: 0 },
        signals = emptySignals();
      let unindexed = 0,
        pendingSources = 0,
        staleSources = 0;
      const include = (item: AttentionItem, decision?: DecisionRow) => {
        if (query && !matches(item, query)) return;
        if (filter.kind && !kindMatches(item, filter.kind)) return;
        const result = decisionState(decision, item.revision, now);
        queue[result.state]++;
        if (result.state === wantedBucket) presented.push({ ...item, ...result });
      };
      for (const source of github.rows) {
        if (source.attention === null) {
          pendingSources++;
          continue;
        }
        const projection = storedAttentionProjection.parse(source.attention);
        unindexed += projection.omitted;
        if (!query) addGitHubCounts(signals, projection.counts);
        for (const item of projection.items) {
          const presentedItem: AttentionItem = {
            ...item,
            source: 'github',
            projectId: source.projectId,
            project: source.project,
            state: 'active',
            changed: false,
            forYou: item.requestedReviewerIds.includes(principal.githubId),
            decidedAt: null,
            until: null,
          };
          if (query && matches(presentedItem, query)) addSignals(signals, presentedItem);
          include(presentedItem, choices.get('github:' + item.id));
        }
      }
      for (const source of local.rows) {
        if (localSourceStale(source, now)) {
          staleSources++;
          continue;
        }
        if (source.attention === null) {
          pendingSources++;
          continue;
        }
        const projection = storedLocalAttentionProjection.parse(source.attention);
        unindexed += projection.omitted;
        if (!query) {
          signals.localOnly += projection.counts.localOnly;
          signals.forgottenWork += projection.counts.forgottenWork;
        }
        for (const item of projection.items) {
          const presentedItem: AttentionItem = {
            ...item,
            source: 'local',
            projectId: source.projectId,
            project: source.project,
            memberId: source.memberId,
            person: source.person,
            device: source.device,
            state: 'active',
            changed: false,
            forYou: source.memberId === principal.userId,
            decidedAt: null,
            until: null,
          };
          if (query && matches(presentedItem, query)) addSignals(signals, presentedItem);
          include(presentedItem, choices.get('local:' + item.id));
        }
      }
      presented.sort(compare);
      return attentionPage.parse({
        workspaceId: workspace,
        revision: principal.revision,
        checkedAt: new Date().toISOString(),
        bucket: wantedBucket,
        queue,
        signals,
        sources: github.rows.length + local.rows.length,
        pendingSources,
        failedSources: github.rows.filter((source) => source.lastError).length,
        staleSources,
        items: presented.slice(0, 100),
        omitted: unindexed + Math.max(0, presented.length - 100),
      });
    });
  }

  async decide(credential: Credential, workspace: string, command: unknown) {
    const input = attentionDecisionCommand.parse(command),
      now = Date.now();
    return this.db.transaction(async (client) => {
      const principal = await workspaceAccess(client, credential, workspace);
      if (principal.deviceId) throw denied();
      const github = await client.query<GitHubSourceRow>(
          `SELECT s.project_id AS "projectId",p.name AS project,s.attention,s.last_error AS "lastError"
          FROM ob_github_sources s JOIN ob_projects p ON p.workspace_id=s.workspace_id AND p.id=s.project_id AND p.active
          LEFT JOIN ob_project_access access ON access.workspace_id=p.workspace_id AND access.project_id=p.id AND access.user_id=$2
          WHERE s.workspace_id=$1 AND s.attention IS NOT NULL AND ($3::boolean OR access.user_id IS NOT NULL)`,
          [workspace, principal.userId, principal.role === 'owner'],
        ),
        local = await client.query<LocalSourceRow>(
          `SELECT s.project_id AS "projectId",p.name AS project,d.id AS "deviceId",d.user_id AS "memberId",
          d.name AS device,u.login AS person,d.expires_at AS "deviceExpiresAt",s.observed_at AS "observedAt",
          s.received_at AS "receivedAt",(s.snapshot->>'sourceError')::boolean AS "sourceError",s.attention
          FROM ob_shares s JOIN ob_devices d ON d.workspace_id=s.workspace_id AND d.id=s.device_id AND d.revoked_at IS NULL
          JOIN ob_members m ON m.workspace_id=d.workspace_id AND m.user_id=d.user_id AND m.active
          JOIN ob_users u ON u.id=m.user_id JOIN ob_projects p ON p.workspace_id=s.workspace_id AND p.id=s.project_id AND p.active
          LEFT JOIN ob_project_access access ON access.workspace_id=p.workspace_id AND access.project_id=p.id AND access.user_id=$2
          WHERE s.workspace_id=$1 AND s.enabled AND s.snapshot IS NOT NULL AND s.attention IS NOT NULL
            AND ($3::boolean OR access.user_id IS NOT NULL)`,
          [workspace, principal.userId, principal.role === 'owner'],
        ),
        current = new Map<
          string,
          { item: AttentionEvidenceItem | LocalAttentionEvidenceItem; projectId: string }
        >();
      for (const source of github.rows)
        for (const item of storedAttentionProjection.parse(source.attention).items)
          current.set('github:' + item.id, { item, projectId: source.projectId });
      for (const source of local.rows) {
        if (localSourceStale(source, now)) continue;
        for (const item of storedLocalAttentionProjection.parse(source.attention).items)
          current.set('local:' + item.id, { item, projectId: source.projectId });
      }
      const resolved = input.items.map((requested) => {
        const found = current.get(requested.source + ':' + requested.id);
        if (!found || found.item.revision !== requested.revision)
          throw new TeamError(
            409,
            'attention_changed',
            'One of these findings changed. Refresh its evidence before choosing again.',
          );
        return found;
      });
      for (let index = 0; index < input.items.length; index++) {
        const requested = input.items[index],
          found = resolved[index],
          table =
            requested.source === 'github'
              ? 'ob_attention_decisions'
              : 'ob_local_attention_decisions';
        if (input.choice === 'restore') {
          await client.query(
            `DELETE FROM ${table} WHERE workspace_id=$1 AND user_id=$2 AND finding_id=$3`,
            [workspace, principal.userId, requested.id],
          );
          continue;
        }
        await client.query(
          `INSERT INTO ${table}(workspace_id,user_id,project_id,finding_id,revision,choice,decided_at,until_at)
          VALUES($1,$2,$3,$4,$5,$6,now(),CASE WHEN $6='snoozed' THEN now()+interval '7 days' ELSE NULL END)
          ON CONFLICT(workspace_id,user_id,finding_id) DO UPDATE SET project_id=EXCLUDED.project_id,
            revision=EXCLUDED.revision,choice=EXCLUDED.choice,decided_at=EXCLUDED.decided_at,until_at=EXCLUDED.until_at`,
          [
            workspace,
            principal.userId,
            found.projectId,
            requested.id,
            requested.revision,
            input.choice,
          ],
        );
      }
      return { revision: principal.revision };
    });
  }
}

async function decisions(
  client: import('pg').PoolClient,
  table: 'ob_attention_decisions' | 'ob_local_attention_decisions',
  workspace: string,
  user: string,
  owner: boolean,
  project?: string,
) {
  return client.query<DecisionRow>(
    `SELECT d.finding_id AS "findingId",d.revision,d.choice,d.decided_at AS "decidedAt",d.until_at AS until
    FROM ${table} d JOIN ob_projects p ON p.workspace_id=d.workspace_id AND p.id=d.project_id AND p.active
    LEFT JOIN ob_project_access access ON access.workspace_id=p.workspace_id AND access.project_id=p.id AND access.user_id=$2
    WHERE d.workspace_id=$1 AND d.user_id=$2 AND ($3::boolean OR access.user_id IS NOT NULL)
      AND ($4::uuid IS NULL OR p.id=$4)`,
    [workspace, user, owner, project ?? null],
  );
}
function decisionState(decision: DecisionRow | undefined, revision: string, now: number) {
  const current = decision?.revision === revision && decision.decidedAt.getTime() <= now,
    state: AttentionBucket =
      current && decision.choice === 'dismissed'
        ? 'dismissed'
        : current && decision.choice === 'snoozed' && (decision.until?.getTime() ?? 0) > now
          ? 'snoozed'
          : 'active';
  return {
    state,
    changed: !!decision && decision.revision !== revision,
    decidedAt: state === 'active' ? null : decision!.decidedAt.toISOString(),
    until: state === 'snoozed' ? decision!.until!.toISOString() : null,
  };
}
function emptySignals() {
  return {
    failingChecks: 0,
    reviewRequested: 0,
    staleDrafts: 0,
    mergedBranches: 0,
    localOnly: 0,
    forgottenWork: 0,
  };
}
function addGitHubCounts(
  target: ReturnType<typeof emptySignals>,
  value: z.infer<typeof storedAttentionProjection>['counts'],
) {
  target.failingChecks += value.failingChecks;
  target.reviewRequested += value.reviewRequested;
  target.staleDrafts += value.staleDrafts;
  target.mergedBranches += value.mergedBranches;
}
function addSignals(
  target: ReturnType<typeof emptySignals>,
  item: AttentionEvidenceItem | LocalAttentionEvidenceItem,
) {
  if (item.signals.failingChecks) target.failingChecks++;
  if (item.signals.reviewRequested) target.reviewRequested++;
  if (item.signals.staleDraft) target.staleDrafts++;
  if (item.signals.mergedBranch) target.mergedBranches++;
  if (item.signals.localOnly) target.localOnly++;
  if (item.signals.forgottenWork) target.forgottenWork++;
}
function kindMatches(item: AttentionItem, kind: z.infer<typeof attentionKind>) {
  return kind === 'checks-failing'
    ? item.signals.failingChecks
    : kind === 'review-requested'
      ? item.signals.reviewRequested
      : kind === 'stale-draft'
        ? item.signals.staleDraft
        : kind === 'merged-branch'
          ? item.signals.mergedBranch
          : kind === 'local-only'
            ? item.signals.localOnly
            : item.signals.forgottenWork;
}
function matches(item: AttentionItem, query: string) {
  return [
    item.project,
    item.title,
    item.branch,
    item.source === 'github' ? item.pullTitle : item.person,
    item.source === 'github' ? String(item.pullNumber) : item.device,
    item.source === 'github' ? '#' + item.pullNumber : item.localSha,
    item.source === 'github' ? item.base : item.tools.join(' '),
    item.source === 'github' ? item.author : item.memberId,
    ...item.evidence,
  ].some((value) => value?.toLowerCase().includes(query));
}
function compare(a: AttentionItem, b: AttentionItem) {
  const rank = (item: AttentionItem) =>
    item.priority === 'urgent'
      ? 0
      : item.forYou
        ? 1
        : item.signals.reviewRequested
          ? 2
          : item.signals.localOnly
            ? 3
            : item.signals.staleDraft || item.signals.forgottenWork
              ? 4
              : 5;
  return (
    rank(a) - rank(b) ||
    (a.updatedAt ?? a.observedAt).localeCompare(b.updatedAt ?? b.observedAt) ||
    a.project.localeCompare(b.project) ||
    a.title.localeCompare(b.title)
  );
}
function localSourceStale(source: LocalSourceRow, now: number) {
  const received = dateTime(source.receivedAt),
    observed = dateTime(source.observedAt),
    expires = dateTime(source.deviceExpiresAt);
  return (
    source.sourceError ||
    received === undefined ||
    observed === undefined ||
    expires === undefined ||
    expires <= now ||
    received > now + 60_000 ||
    observed > now + 60_000 ||
    now - received > 5 * 60_000 ||
    now - observed > 5 * 60_000
  );
}
function dateTime(value: unknown) {
  if (!(value instanceof Date)) return undefined;
  const time = value.getTime();
  return Number.isFinite(time) ? time : undefined;
}
