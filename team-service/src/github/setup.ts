import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { TeamDatabase } from '../db';
import { changed, requireOwner, workspaceAccess, type Credential } from '../access';
import { denied, TeamError } from '../errors';
import { secretHash } from '../secrets';
import { upsertIdentity, type GitHubIdentity } from '../identities';
import {
  githubCatalog,
  githubProof,
  githubSelection,
  githubSetupState,
} from '../../../src/team/github';
import { installationIdentity } from './schema';
import type { InstallationBinding } from './schema';
import type { TeamGitHubApp } from './app';

interface Review {
  id: string;
  payload: unknown;
  expiresAt: Date;
  parentId: string | null;
}
const expired = () =>
  new TeamError(
    409,
    'github_review_expired',
    'This GitHub review expired or changed. Verify access again.',
  );

export class TeamGitHubSetup {
  constructor(
    private db: TeamDatabase,
    private app?: TeamGitHubApp,
  ) {}
  private provider() {
    if (!this.app)
      throw new TeamError(
        503,
        'github_not_configured',
        'The host has not configured GitHub repository connections yet.',
      );
    return this.app;
  }
  private async verifiedCatalog(
    binding: InstallationBinding,
    user: { githubId: string; login: string },
  ) {
    const app = this.provider();
    if (!(await app.authority(binding, user))) throw denied();
    const catalog = await app.catalog(binding);
    const authority = await app.authority(binding, user);
    if (!authority) throw denied();
    if (catalog.projects.some((p) => p.accountLogin !== authority.accountLogin)) throw expired();
    return { catalog, authority };
  }
  async owner(credential: Credential, workspace: string) {
    return this.db.transaction(async (client) => {
      const owner = await workspaceAccess(client, credential, workspace);
      requireOwner(owner);
      return owner;
    });
  }
  async start(credential: Credential, workspace: string) {
    this.provider();
    return this.owner(credential, workspace);
  }
  private async review(
    client: PoolClient,
    credential: Credential,
    workspace: string,
    id: string,
    kind: 'authority' | 'catalog',
  ) {
    const owner = await workspaceAccess(client, credential, workspace);
    requireOwner(owner);
    const result = await client.query<Review>(
      `SELECT id,payload,expires_at AS "expiresAt",parent_id AS "parentId"
      FROM ob_github_reviews WHERE id=$1 AND workspace_id=$2 AND user_id=$3 AND session_hash=$4 AND kind=$5 AND expires_at>now()`,
      [id, workspace, owner.userId, secretHash(credential.token), kind],
    );
    if (!result.rows[0]) throw expired();
    return { owner, review: result.rows[0] };
  }
  async verify(credential: Credential, workspace: string, identity: GitHubIdentity, token: string) {
    const owner = await this.owner(credential, workspace);
    if (String(identity.id) !== owner.githubId) throw denied();
    const result = await this.provider().authorizedInstallations(token, {
      githubId: owner.githubId,
      login: identity.login,
    });
    return this.db.transaction(async (client) => {
      const current = await workspaceAccess(client, credential, workspace);
      requireOwner(current);
      if (current.userId !== owner.userId) throw denied();
      await upsertIdentity(client, identity);
      await client.query(
        'DELETE FROM ob_github_reviews WHERE workspace_id=$1 AND (expires_at<=now() OR user_id=$2)',
        [workspace, owner.userId],
      );
      // Persist only verified identities, never the temporary OAuth credential.
      const id = randomUUID();
      const saved = await client.query<{ expiresAt: Date }>(
        `INSERT INTO ob_github_reviews(id,workspace_id,user_id,session_hash,kind,payload,expires_at)
        VALUES($1,$2,$3,$4,'authority',$5,now()+interval '5 minutes') RETURNING expires_at AS "expiresAt"`,
        [id, workspace, owner.userId, secretHash(credential.token), JSON.stringify(result)],
      );
      return githubProof.parse({ ...result, id, expiresAt: saved.rows[0].expiresAt.toISOString() });
    });
  }
  async state(credential: Credential, workspace: string) {
    return this.db.transaction(async (client) => {
      const owner = await workspaceAccess(client, credential, workspace);
      requireOwner(owner);
      const proof = await client.query<Review>(
        `SELECT id,payload,expires_at AS "expiresAt" FROM ob_github_reviews
        WHERE workspace_id=$1 AND user_id=$2 AND session_hash=$3 AND kind='authority' AND expires_at>now() ORDER BY created_at DESC LIMIT 1`,
        [workspace, owner.userId, secretHash(credential.token)],
      );
      const selections = await client.query(
        `SELECT p.id AS "projectId",p.github_id AS "repositoryId",p.github_slug AS "fullName",s.account_login AS "accountLogin",
        s.selected_at AS "selectedAt",s.checked_at AS "lastAttemptAt",s.snapshot->>'checkedAt' AS "snapshotAt",s.last_error AS "lastError",
        CASE WHEN jsonb_typeof(s.snapshot->'branches')='array' THEN jsonb_array_length(s.snapshot->'branches') ELSE 0 END AS "branchCount",
        CASE WHEN jsonb_typeof(s.snapshot->'pulls')='array' THEN jsonb_array_length(s.snapshot->'pulls') ELSE 0 END AS "pullCount",
        CASE WHEN jsonb_typeof(s.snapshot->'pulls')='array' THEN (SELECT count(*)::integer FROM jsonb_array_elements(s.snapshot->'pulls') pull WHERE pull->>'state'='open') ELSE 0 END AS "openPullCount",
        COALESCE((s.snapshot->>'branchesComplete')::boolean,false) AS "branchesComplete",
        COALESCE((s.snapshot->>'pullHistoryComplete')::boolean,false) AS "pullHistoryComplete"
        FROM ob_github_sources s JOIN ob_projects p ON p.workspace_id=s.workspace_id AND p.id=s.project_id AND p.active
        WHERE s.workspace_id=$1 ORDER BY lower(p.github_slug),p.id LIMIT 500`,
        [workspace],
      );
      const row = proof.rows[0];
      return githubSetupState.parse({
        workspaceId: workspace,
        configured: !!this.app,
        ...(row
          ? {
              proof: githubProof.parse({
                ...z
                  .object({ installations: z.unknown(), complete: z.boolean() })
                  .parse(row.payload),
                id: row.id,
                expiresAt: row.expiresAt.toISOString(),
              }),
            }
          : {}),
        selections: selections.rows.map((r) => ({
          projectId: r.projectId,
          repositoryId: r.repositoryId,
          fullName: r.fullName,
          accountLogin: r.accountLogin,
          selectedAt: r.selectedAt.toISOString(),
          lastAttemptAt: r.lastAttemptAt?.toISOString() ?? null,
          snapshotAt: r.snapshotAt ?? null,
          syncState: r.lastError
            ? 'error'
            : !r.snapshotAt
              ? 'waiting'
              : r.branchesComplete && r.pullHistoryComplete
                ? 'current'
                : 'partial',
          branchCount: r.branchCount,
          pullCount: r.pullCount,
          openPullCount: r.openPullCount,
        })),
      });
    });
  }
  async catalog(
    credential: Credential,
    workspace: string,
    proofId: string,
    installationId: string,
  ) {
    const loaded = await this.db.transaction((client) =>
      this.review(client, credential, workspace, proofId, 'authority'),
    );
    const proof = githubProof.omit({ id: true, expiresAt: true }).parse(loaded.review.payload);
    const selected = proof.installations.find((v) => v.installationId === installationId);
    if (!selected) throw expired();
    const { catalog, authority } = await this.verifiedCatalog(
      installationIdentity(selected),
      loaded.owner,
    );
    return this.db.transaction(async (client) => {
      const fresh = await this.review(client, credential, workspace, proofId, 'authority');
      const id = randomUUID(),
        payload = {
          installation: authority,
          projects: catalog.projects,
          complete: catalog.complete,
          total: catalog.total,
        };
      await client.query('DELETE FROM ob_github_reviews WHERE parent_id=$1', [proofId]);
      await client.query(
        `INSERT INTO ob_github_reviews(id,workspace_id,user_id,session_hash,kind,payload,parent_id,expires_at)
        VALUES($1,$2,$3,$4,'catalog',$5,$6,$7)`,
        [
          id,
          workspace,
          fresh.owner.userId,
          secretHash(credential.token),
          JSON.stringify(payload),
          proofId,
          fresh.review.expiresAt,
        ],
      );
      return githubCatalog.parse({
        ...payload,
        id,
        workspaceId: workspace,
        proofId,
        expiresAt: fresh.review.expiresAt.toISOString(),
      });
    });
  }
  async select(credential: Credential, workspace: string, input: unknown) {
    const command = githubSelection.parse(input);
    const loaded = await this.db.transaction((client) =>
      this.review(client, credential, workspace, command.reviewId, 'catalog'),
    );
    const catalog = githubCatalog.parse({
      ...githubCatalog
        .omit({ id: true, workspaceId: true, proofId: true, expiresAt: true })
        .parse(loaded.review.payload),
      id: loaded.review.id,
      workspaceId: workspace,
      proofId: loaded.review.parentId,
      expiresAt: loaded.review.expiresAt.toISOString(),
    });
    const projects = command.repositoryIds.map((id) => {
      const p = catalog.projects.find((p) => p.id === id);
      if (!p) throw expired();
      return p;
    });
    const binding = installationIdentity(catalog.installation);
    const { catalog: current } = await this.verifiedCatalog(binding, loaded.owner);
    if (
      projects.some(
        (p) =>
          !current.projects.some((fresh) => fresh.id === p.id && fresh.fullName === p.fullName),
      )
    )
      throw expired();
    return this.db.transaction(async (client) => {
      const fresh = await this.review(client, credential, workspace, command.reviewId, 'catalog');
      const count = await client.query<{ count: string; existing: string }>(
        `SELECT count(*)::text,count(*) FILTER(WHERE p.github_id=ANY($2::text[]))::text AS existing
        FROM ob_github_sources s JOIN ob_projects p ON p.workspace_id=s.workspace_id AND p.id=s.project_id WHERE s.workspace_id=$1`,
        [workspace, command.repositoryIds],
      );
      if (Number(count.rows[0].count) + projects.length - Number(count.rows[0].existing) > 500)
        throw new TeamError(
          409,
          'github_project_limit',
          'This workspace can select up to 500 GitHub repositories. Remove a selection first.',
        );
      for (const p of projects) {
        const saved = await client.query<{ id: string }>(
          `INSERT INTO ob_projects(id,workspace_id,name,github_id,github_slug) VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(workspace_id,github_id) DO UPDATE SET active=true,github_slug=EXCLUDED.github_slug RETURNING id`,
          [randomUUID(), workspace, p.fullName, p.id, p.fullName],
        );
        await client.query(
          `INSERT INTO ob_github_sources(workspace_id,project_id,installation_id,account_id,account_type,account_login,approved_by,generation)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(workspace_id,project_id) DO UPDATE SET installation_id=EXCLUDED.installation_id,
          account_id=EXCLUDED.account_id,account_type=EXCLUDED.account_type,account_login=EXCLUDED.account_login,approved_by=EXCLUDED.approved_by,
          generation=EXCLUDED.generation,selected_at=now(),snapshot=NULL,attention=NULL,checked_at=NULL,last_error=false`,
          [
            workspace,
            saved.rows[0].id,
            binding.installationId,
            binding.accountId,
            binding.accountType,
            catalog.installation.accountLogin,
            fresh.owner.userId,
            randomUUID(),
          ],
        );
      }
      await client.query('DELETE FROM ob_github_reviews WHERE id=$1', [command.reviewId]);
      return { revision: await changed(client, workspace) };
    });
  }
  async remove(credential: Credential, workspace: string, project: string) {
    return this.db.transaction(async (client) => {
      requireOwner(await workspaceAccess(client, credential, workspace));
      await client.query('DELETE FROM ob_github_sources WHERE workspace_id=$1 AND project_id=$2', [
        workspace,
        project,
      ]);
      await client.query('DELETE FROM ob_github_reviews WHERE workspace_id=$1', [workspace]);
      return { revision: await changed(client, workspace) };
    });
  }
}
