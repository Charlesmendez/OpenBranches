ALTER TABLE ob_github_sources ADD COLUMN IF NOT EXISTS last_error boolean NOT NULL DEFAULT false;
INSERT INTO ob_schema_version(version) VALUES (3) ON CONFLICT DO NOTHING;
