/** Reused by paginated details and aggregate counts so both have exactly the
 * same tenant, person, project, and search permissions. Parameters 1–6 are
 * workspace, user, owner, project, member, escaped search pattern. */
export const visibleShares = `FROM ob_shares s
  JOIN ob_devices d ON d.id=s.device_id AND d.workspace_id=s.workspace_id
  JOIN ob_members m ON m.workspace_id=d.workspace_id AND m.user_id=d.user_id AND m.active
  JOIN ob_users u ON u.id=d.user_id
  JOIN ob_projects p ON p.id=s.project_id AND p.workspace_id=s.workspace_id AND p.active
  LEFT JOIN ob_project_access a ON a.workspace_id=p.workspace_id AND a.project_id=p.id AND a.user_id=$2
  CROSS JOIN LATERAL (SELECT CASE WHEN $6::text IS NULL THEN s.snapshot->'branches' ELSE (
    SELECT COALESCE(jsonb_agg(b.value),'[]'::jsonb) FROM jsonb_array_elements(s.snapshot->'branches') b
    WHERE u.login ILIKE $6 OR p.name ILIKE $6 OR b.value->>'name' ILIKE $6 OR b.value->>'localSha' ILIKE $6 OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(b.value->'tasks') t
      WHERE t->>'tool' ILIKE $6 OR replace(t->>'tool','-',' ') ILIKE $6
        OR t->'model'->>'id' ILIKE $6 OR t->'model'->>'provider' ILIKE $6 OR t->>'title' ILIKE $6
    )
  ) END AS branches) matched
  WHERE s.workspace_id=$1 AND s.enabled AND s.snapshot IS NOT NULL AND d.revoked_at IS NULL
    AND ($3::boolean OR a.user_id IS NOT NULL) AND ($4::uuid IS NULL OR p.id=$4) AND ($5::uuid IS NULL OR d.user_id=$5)
    AND ($6::text IS NULL OR jsonb_array_length(matched.branches)>0)`;
export function searchPattern(query?: string) {
  return query?.trim() ? '%' + query.trim().replace(/[\\%_]/g, '\\$&') + '%' : null;
}
