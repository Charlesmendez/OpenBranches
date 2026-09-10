ALTER TABLE ob_oauth_states ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES ob_workspaces(id);
ALTER TABLE ob_oauth_states ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES ob_users(id);
ALTER TABLE ob_oauth_states ADD COLUMN IF NOT EXISTS session_hash text;
CREATE TABLE IF NOT EXISTS ob_github_reviews (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES ob_workspaces(id),
  user_id uuid NOT NULL REFERENCES ob_users(id), session_hash text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('authority','catalog')), payload jsonb NOT NULL,
  parent_id uuid REFERENCES ob_github_reviews(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ob_github_reviews_expiry ON ob_github_reviews(expires_at);
CREATE TABLE IF NOT EXISTS ob_github_sources (
  workspace_id uuid NOT NULL, project_id uuid NOT NULL,
  installation_id text NOT NULL, account_id text NOT NULL,
  account_type text NOT NULL CHECK(account_type IN ('User','Organization')), account_login text NOT NULL,
  approved_by uuid NOT NULL REFERENCES ob_users(id), selected_at timestamptz NOT NULL DEFAULT now(),
  generation uuid NOT NULL, snapshot jsonb, checked_at timestamptz,
  PRIMARY KEY(workspace_id,project_id),
  FOREIGN KEY(workspace_id,project_id) REFERENCES ob_projects(workspace_id,id)
);
INSERT INTO ob_schema_version(version) VALUES (2) ON CONFLICT DO NOTHING;
