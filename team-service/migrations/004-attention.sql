ALTER TABLE ob_github_sources ADD COLUMN IF NOT EXISTS attention jsonb;

CREATE TABLE IF NOT EXISTS ob_attention_decisions (
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  project_id uuid NOT NULL,
  finding_id text NOT NULL CHECK (finding_id ~ '^[a-f0-9]{64}$'),
  revision text NOT NULL CHECK (revision ~ '^[a-f0-9]{64}$'),
  choice text NOT NULL CHECK (choice IN ('snoozed','dismissed')),
  decided_at timestamptz NOT NULL,
  until_at timestamptz,
  PRIMARY KEY(workspace_id,user_id,finding_id),
  FOREIGN KEY(workspace_id,user_id) REFERENCES ob_members(workspace_id,user_id),
  FOREIGN KEY(workspace_id,project_id) REFERENCES ob_github_sources(workspace_id,project_id) ON DELETE CASCADE,
  CHECK (
    (choice='snoozed' AND until_at=decided_at+interval '7 days') OR
    (choice='dismissed' AND until_at IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS ob_attention_decisions_user
  ON ob_attention_decisions(workspace_id,user_id,choice);

INSERT INTO ob_schema_version(version) VALUES (4) ON CONFLICT DO NOTHING;
