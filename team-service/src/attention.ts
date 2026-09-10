import { z } from 'zod';
import {
  attentionBucket,
  attentionDecisionCommand,
  attentionKind,
  attentionPage,
  storedAttentionProjection,
  type AttentionBucket,
  type AttentionEvidenceItem,
  type AttentionItem,
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
interface SourceRow {
  projectId: string;
  project: string;
  attention: unknown;
  lastError: boolean;
}
interface DecisionRow {
  findingId: string;
  revision: string;
  choice: 'snoozed' | 'dismissed';
  decidedAt: Date;
  until: Date | null;
}

/** A browser-only, permission-scoped inbox over persisted GitHub evidence.
 * Decisions belong to the signed-in user and never mutate Git or GitHub. */
export class TeamAttention {
  constructor(private db: TeamDatabase) {}

  async view(credential: Credential, workspace: string, options: unknown = {}) {
    const filter = viewOptions.parse(options),
      wantedBucket = filter.bucket ?? 'active',
      now = Date.now();
    return this.db.transaction(async (client) => {
      const principal = await workspaceAccess(client, credential, workspace);
      if (principal.deviceId) throw denied();
      const sources = await client.query<SourceRow>(
        `SELECT s.project_id AS "projectId",p.name AS project,s.attention,s.last_error AS "lastError"
        FROM ob_github_sources s JOIN ob_projects p ON p.workspace_id=s.workspace_id AND p.id=s.project_id AND p.active
        LEFT JOIN ob_project_access access ON access.workspace_id=p.workspace_id AND access.project_id=p.id AND access.user_id=$2
        WHERE s.workspace_id=$1 AND ($3::boolean OR access.user_id IS NOT NULL)
          AND ($4::uuid IS NULL OR p.id=$4)
        ORDER BY p.name,p.id`,
        [workspace, principal.userId, principal.role === 'owner', filter.projectId ?? null],
      );
      const decisions = await client.query<DecisionRow>(
        `SELECT d.finding_id AS "findingId",d.revision,d.choice,d.decided_at AS "decidedAt",d.until_at AS until
        FROM ob_attention_decisions d JOIN ob_github_sources s ON s.workspace_id=d.workspace_id AND s.project_id=d.project_id
        JOIN ob_projects p ON p.workspace_id=s.workspace_id AND p.id=s.project_id AND p.active
        LEFT JOIN ob_project_access access ON access.workspace_id=p.workspace_id AND access.project_id=p.id AND access.user_id=$2
        WHERE d.workspace_id=$1 AND d.user_id=$2 AND ($3::boolean OR access.user_id IS NOT NULL)
          AND ($4::uuid IS NULL OR p.id=$4)`,
        [workspace, principal.userId, principal.role === 'owner', filter.projectId ?? null],
      );
      const choice = new Map(decisions.rows.map((row) => [row.findingId, row])),
        query = filter.query?.trim().toLowerCase() ?? '',
        presented: AttentionItem[] = [],
        queue = { active: 0, snoozed: 0, dismissed: 0 },
        signals = { failingChecks: 0, reviewRequested: 0, staleDrafts: 0, mergedBranches: 0 };
      let unindexed = 0;
      for (const source of sources.rows) {
        if (source.attention === null) continue;
        const projection = storedAttentionProjection.parse(source.attention);
        unindexed += projection.omitted;
        if (!query) {
          signals.failingChecks += projection.counts.failingChecks;
          signals.reviewRequested += projection.counts.reviewRequested;
          signals.staleDrafts += projection.counts.staleDrafts;
          signals.mergedBranches += projection.counts.mergedBranches;
        }
        for (const item of projection.items) {
          if (query && !matches(item, source.project, query)) continue;
          if (query) {
            if (item.signals.failingChecks) signals.failingChecks++;
            if (item.signals.reviewRequested) signals.reviewRequested++;
            if (item.signals.staleDraft) signals.staleDrafts++;
            if (item.signals.mergedBranch) signals.mergedBranches++;
          }
          if (filter.kind && !kindMatches(item, filter.kind)) continue;
          const previous = choice.get(item.id),
            current = previous?.revision === item.revision && previous.decidedAt.getTime() <= now,
            state: AttentionBucket =
              current && previous.choice === 'dismissed'
                ? 'dismissed'
                : current && previous.choice === 'snoozed' && (previous.until?.getTime() ?? 0) > now
                  ? 'snoozed'
                  : 'active';
          queue[state]++;
          if (state !== wantedBucket) continue;
          presented.push({
            ...item,
            projectId: source.projectId,
            project: source.project,
            state,
            changed: !!previous && previous.revision !== item.revision,
            forYou: item.requestedReviewerIds.includes(principal.githubId),
            decidedAt: state === 'active' ? null : previous!.decidedAt.toISOString(),
            until: state === 'snoozed' ? previous!.until!.toISOString() : null,
          });
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
        sources: sources.rows.length,
        pendingSources: sources.rows.filter((source) => source.attention === null).length,
        failedSources: sources.rows.filter((source) => source.lastError).length,
        items: presented.slice(0, 100),
        omitted: unindexed + Math.max(0, presented.length - 100),
      });
    });
  }

  async decide(credential: Credential, workspace: string, command: unknown) {
    const input = attentionDecisionCommand.parse(command);
    return this.db.transaction(async (client) => {
      const principal = await workspaceAccess(client, credential, workspace);
      if (principal.deviceId) throw denied();
      const sources = await client.query<SourceRow>(
        `SELECT s.project_id AS "projectId",p.name AS project,s.attention,s.last_error AS "lastError"
        FROM ob_github_sources s JOIN ob_projects p ON p.workspace_id=s.workspace_id AND p.id=s.project_id AND p.active
        LEFT JOIN ob_project_access access ON access.workspace_id=p.workspace_id AND access.project_id=p.id AND access.user_id=$2
        WHERE s.workspace_id=$1 AND s.attention IS NOT NULL AND ($3::boolean OR access.user_id IS NOT NULL)`,
        [workspace, principal.userId, principal.role === 'owner'],
      );
      const current = new Map<string, { item: AttentionEvidenceItem; projectId: string }>();
      for (const source of sources.rows)
        for (const item of storedAttentionProjection.parse(source.attention).items)
          current.set(item.id, { item, projectId: source.projectId });
      const resolved = input.items.map((requested) => {
        const found = current.get(requested.id);
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
          found = resolved[index];
        if (input.choice === 'restore') {
          await client.query(
            'DELETE FROM ob_attention_decisions WHERE workspace_id=$1 AND user_id=$2 AND finding_id=$3',
            [workspace, principal.userId, requested.id],
          );
          continue;
        }
        await client.query(
          `INSERT INTO ob_attention_decisions(workspace_id,user_id,project_id,finding_id,revision,choice,decided_at,until_at)
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

function kindMatches(item: AttentionEvidenceItem, kind: z.infer<typeof attentionKind>) {
  return kind === 'checks-failing'
    ? item.signals.failingChecks
    : kind === 'review-requested'
      ? item.signals.reviewRequested
      : kind === 'stale-draft'
        ? item.signals.staleDraft
        : item.signals.mergedBranch;
}
function matches(item: AttentionEvidenceItem, project: string, query: string) {
  return [
    project,
    item.title,
    item.pullTitle,
    String(item.pullNumber),
    '#' + item.pullNumber,
    item.branch,
    item.base,
    item.author,
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
          : item.signals.staleDraft
            ? 3
            : 4;
  return (
    rank(a) - rank(b) ||
    a.updatedAt.localeCompare(b.updatedAt) ||
    a.project.localeCompare(b.project) ||
    a.pullNumber - b.pullNumber
  );
}
