CREATE TABLE IF NOT EXISTS ob_schema_version (version integer PRIMARY KEY, installed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS ob_users (
  id uuid PRIMARY KEY, github_id text NOT NULL UNIQUE, login text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ob_workspaces (
  id uuid PRIMARY KEY, name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  revision bigint NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ob_members (
  workspace_id uuid NOT NULL REFERENCES ob_workspaces(id), user_id uuid NOT NULL REFERENCES ob_users(id),
  role text NOT NULL CHECK (role IN ('owner', 'member')), active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE TABLE IF NOT EXISTS ob_sessions (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES ob_users(id),
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ob_oauth_states (
  state_hash text PRIMARY KEY, browser_hash text NOT NULL, verifier text NOT NULL,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ob_projects (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES ob_workspaces(id), name text NOT NULL,
  github_id text, github_slug text, active boolean NOT NULL DEFAULT true,
  UNIQUE (workspace_id, id), UNIQUE (workspace_id, github_id)
);
CREATE TABLE IF NOT EXISTS ob_project_access (
  workspace_id uuid NOT NULL, project_id uuid NOT NULL, user_id uuid NOT NULL,
  can_share boolean NOT NULL DEFAULT false,
  PRIMARY KEY (workspace_id, project_id, user_id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES ob_projects(workspace_id, id),
  FOREIGN KEY (workspace_id, user_id) REFERENCES ob_members(workspace_id, user_id)
);
CREATE TABLE IF NOT EXISTS ob_devices (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL, user_id uuid NOT NULL, name text NOT NULL,
  token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, user_id) REFERENCES ob_members(workspace_id, user_id)
);
CREATE TABLE IF NOT EXISTS ob_pairings (
  secret_hash text PRIMARY KEY, code_hash text NOT NULL UNIQUE, device_name text NOT NULL,
  expires_at timestamptz NOT NULL, last_poll_at timestamptz,
  device_id uuid REFERENCES ob_devices(id), cancelled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ob_shares (
  workspace_id uuid NOT NULL, device_id uuid NOT NULL, project_id uuid NOT NULL,
  epoch bigint NOT NULL CHECK (epoch > 0), sequence bigint NOT NULL DEFAULT 0 CHECK (sequence >= 0),
  enabled boolean NOT NULL DEFAULT false, consent jsonb NOT NULL,
  snapshot jsonb, observed_at timestamptz, received_at timestamptz,
  PRIMARY KEY (workspace_id, device_id, project_id),
  FOREIGN KEY (workspace_id, device_id) REFERENCES ob_devices(workspace_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES ob_projects(workspace_id, id)
);
CREATE INDEX IF NOT EXISTS ob_shares_workspace ON ob_shares(workspace_id) WHERE enabled;
CREATE INDEX IF NOT EXISTS ob_sessions_expiry ON ob_sessions(expires_at);
CREATE INDEX IF NOT EXISTS ob_pairings_expiry ON ob_pairings(expires_at);
INSERT INTO ob_schema_version(version) VALUES (1) ON CONFLICT DO NOTHING;
