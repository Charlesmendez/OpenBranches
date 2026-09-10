import { z } from 'zod';
import { checksSummary } from '../../../src/domain/pullSignals';
import { historyKey, integrationNames, publishedTargets } from '../../../src/github/history';
import { remoteSnapshotSchema, type RemoteSnapshot } from '../../../src/github/reader';
import { githubNumericId, githubWorkPage, type GitHubWorkSource } from '../../../src/team/github';
import { teamId } from '../../../src/team/protocol';
import { workspaceAccess, type Credential } from '../access';
import type { TeamDatabase } from '../db';
import { denied } from '../errors';
import { searchPattern } from '../visible';

const pageSchema = z.strictObject({
  projectId: teamId.optional(),
  memberId: teamId.optional(),
  after: teamId.optional(),
  query: z.string().max(160).optional(),
});
interface SourceRow {
  projectId: string;
  repositoryId: string;
  fullName: string;
  lastAttemptAt: Date | null;
  lastError: boolean;
  snapshot: unknown;
}

/** Presents persisted GitHub evidence through the same workspace/project
 * permissions as local reports. GitHub actors are PR evidence, never inferred
 * branch owners or proof that somebody is working right now. */
export class TeamGitHubView {
  constructor(private db: TeamDatabase) {}

  async view(credential: Credential, workspace: string, options: unknown = {}) {
    const page = pageSchema.parse(options);
    return this.db.transaction(async (client) => {
      const principal = await workspaceAccess(client, credential, workspace);
      if (principal.deviceId) throw denied();
      let memberGitHubId: string | null = null;
      if (page.memberId) {
        const member = await client.query<{ githubId: string }>(
          `SELECT u.github_id AS "githubId" FROM ob_members m JOIN ob_users u ON u.id=m.user_id
          WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.active`,
          [workspace, page.memberId],
        );
        memberGitHubId = member.rows[0]?.githubId ?? '-1';
      }
      const pattern = searchPattern(page.query);
      const rows = await client.query<SourceRow>(
        `SELECT s.project_id AS "projectId",p.github_id AS "repositoryId",p.github_slug AS "fullName",
        s.checked_at AS "lastAttemptAt",s.last_error AS "lastError",s.snapshot
        FROM ob_github_sources s JOIN ob_projects p ON p.workspace_id=s.workspace_id AND p.id=s.project_id AND p.active
        LEFT JOIN ob_project_access access ON access.workspace_id=p.workspace_id AND access.project_id=p.id AND access.user_id=$2
        WHERE s.workspace_id=$1 AND s.snapshot IS NOT NULL AND ($3::boolean OR access.user_id IS NOT NULL)
          AND ($4::uuid IS NULL OR p.id=$4) AND ($5::uuid IS NULL OR p.id>$5)
          AND ($6::text IS NULL OR p.name ILIKE $6 OR p.github_slug ILIKE $6
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(s.snapshot->'branches') branch
              WHERE branch->>'name' ILIKE $6 OR branch->>'sha' ILIKE $6)
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(s.snapshot->'pulls') pull
              WHERE pull->>'title' ILIKE $6 OR pull->>'headName' ILIKE $6 OR pull->>'headSha' ILIKE $6 OR pull->>'base' ILIKE $6
                OR pull->>'number' ILIKE $6 OR ('#' || (pull->>'number')) ILIKE $6 OR pull->'author'->>'login' ILIKE $6
                OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(pull->'requestedReviewers','[]'::jsonb)) reviewer WHERE reviewer->>'login' ILIKE $6)
                OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(pull->'requestedTeams','[]'::jsonb)) team WHERE team->>'name' ILIKE $6 OR team->>'slug' ILIKE $6)))
          AND ($7::text IS NULL OR EXISTS (SELECT 1 FROM jsonb_array_elements(s.snapshot->'pulls') pull
            WHERE pull->'author'->>'id'=$7
              OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(pull->'requestedReviewers','[]'::jsonb)) reviewer WHERE reviewer->>'id'=$7)
              OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(pull->'signals'->'reviews'->'items','[]'::jsonb)) review WHERE review->'actor'->>'id'=$7)))
        ORDER BY p.id LIMIT 11`,
        [
          workspace,
          principal.userId,
          principal.role === 'owner',
          page.projectId ?? null,
          page.after ?? null,
          pattern,
          memberGitHubId,
        ],
      );
      const selected = rows.rows.slice(0, 10),
        last = selected.at(-1);
      return githubWorkPage.parse({
        workspaceId: workspace,
        revision: principal.revision,
        checkedAt: new Date().toISOString(),
        sources: selected.map((row) => this.present(row, page.query, memberGitHubId)),
        nextCursor: rows.rows.length > 10 && last ? last.projectId : null,
      });
    });
  }

  private present(row: SourceRow, query?: string, memberGitHubId: string | null = null) {
    const snapshot = remoteSnapshotSchema.parse(row.snapshot),
      q = query?.trim().toLowerCase() ?? '',
      sourceMatches = !q || row.fullName.toLowerCase().includes(q),
      targets = publishedTargets(snapshot.branches),
      targetNames = new Set(integrationNames),
      pulls = snapshot.pulls
        .filter((pull) => validSha(pull.headSha) && validDate(pull.updatedAt))
        .filter(
          (pull) =>
            (!memberGitHubId || personMatches(pull, memberGitHubId)) &&
            (sourceMatches || pullMatches(pull, q)),
        )
        .sort(
          (a, b) =>
            Number(b.state === 'open') - Number(a.state === 'open') ||
            b.updatedAt.localeCompare(a.updatedAt) ||
            b.number - a.number,
        ),
      branches = snapshot.branches
        .filter((branch) => validSha(branch.sha) && !targetNames.has(branch.name as never))
        .map((branch) => {
          const related = pulls.filter(
            (pull) =>
              pull.headRepository === snapshot.repository &&
              pull.headName === branch.name &&
              pull.headSha === branch.sha,
          );
          const integration = targets.map((target) => {
            const check = snapshot.history?.checks.find(
              (value) =>
                historyKey(branch.sha, target.sha) === historyKey(value.branchSha, value.targetSha),
            );
            return {
              name: target.name,
              sha: target.sha,
              state: check?.state ?? ('unknown' as const),
              checkedAt: check && validDate(check.checkedAt) ? check.checkedAt : null,
            };
          });
          return {
            name: branch.name,
            sha: branch.sha,
            targets: integration,
            pullNumbers: related.slice(0, 100).map((pull) => pull.number),
            matches:
              sourceMatches ||
              branch.name.toLowerCase().includes(q) ||
              branch.sha.includes(q) ||
              integration.some((target) => target.name.toLowerCase().includes(q)) ||
              related.length > 0,
            hasOpenPull: related.some((pull) => pull.state === 'open'),
          };
        })
        .filter((branch) => branch.matches && (!memberGitHubId || branch.pullNumbers.length))
        .sort(
          (a, b) => Number(b.hasOpenPull) - Number(a.hasOpenPull) || a.name.localeCompare(b.name),
        );
    const presented: GitHubWorkSource = {
      projectId: row.projectId,
      repositoryId: row.repositoryId,
      fullName: row.fullName,
      lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
      snapshotAt: normalizedDate(snapshot.checkedAt, row.lastAttemptAt),
      syncState: row.lastError
        ? 'error'
        : snapshot.branchesComplete && snapshot.pullHistoryComplete
          ? 'current'
          : 'partial',
      branchesComplete: snapshot.branchesComplete,
      pullHistoryComplete: snapshot.pullHistoryComplete,
      branchCount: snapshot.branches.length,
      pullCount: snapshot.pulls.length,
      openPullCount: snapshot.pulls.filter((pull) => pull.state === 'open').length,
      branches: branches
        .slice(0, 200)
        .map(({ matches: _matches, hasOpenPull: _open, ...branch }) => branch),
      pulls: pulls.slice(0, 200).map((pull) => ({
        number: pull.number,
        title: pull.title,
        url: pull.url,
        state: pull.state,
        draft: pull.draft ?? false,
        retained: pull.retained ?? false,
        base: pull.base,
        headName: pull.headName,
        headSha: pull.headSha,
        updatedAt: new Date(pull.updatedAt).toISOString(),
        ...(pull.author && githubNumericId.safeParse(pull.author.id).success
          ? { author: pull.author }
          : {}),
        requestedReviewers: (pull.requestedReviewers ?? []).filter(
          (actor) => githubNumericId.safeParse(actor.id).success,
        ),
        requestedTeams: (pull.requestedTeams ?? []).filter(
          (team) => githubNumericId.safeParse(team.id).success,
        ),
        checks: checksSummary(pull.headSha, pull.signals),
      })),
      omittedBranches: Math.max(0, branches.length - 200),
      omittedPulls: Math.max(0, pulls.length - 200),
    };
    return presented;
  }
}

function pullMatches(pull: RemoteSnapshot['pulls'][number], query: string) {
  const fields = [
    pull.title,
    pull.headName,
    pull.headSha,
    pull.base,
    String(pull.number),
    '#' + pull.number,
    pull.author?.login,
    ...(pull.requestedReviewers ?? []).map((actor) => actor.login),
    ...(pull.requestedTeams ?? []).flatMap((team) => [team.name, team.slug]),
  ];
  return fields.some((value) => value?.toLowerCase().includes(query));
}

function personMatches(pull: RemoteSnapshot['pulls'][number], githubId: string) {
  return (
    pull.author?.id === githubId ||
    pull.requestedReviewers?.some((actor) => actor.id === githubId) ||
    pull.signals?.reviews?.items.some((review) => review.actor?.id === githubId)
  );
}

const validSha = (value: string) => /^[a-f\d]{40,64}$/.test(value);
const validDate = (value: string) => Number.isFinite(Date.parse(value));
const normalizedDate = (value: string, fallback: Date | null) =>
  validDate(value) ? new Date(value).toISOString() : (fallback ?? new Date(0)).toISOString();
