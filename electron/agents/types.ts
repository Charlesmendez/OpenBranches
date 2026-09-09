import type { CodingTool, ModelIdentity } from '../../src/domain/types';

export interface SavedAgentTask {
  id: string;
  tool: CodingTool;
  name?: string | null;
  cwd: string;
  updatedAt: number;
  checkedAt?: string;
  archived?: boolean;
  model?: ModelIdentity;
  runtime?: { state: 'active' | 'idle' | 'waiting'; checkedAt: string };
  gitInfo?: { branch?: string | null; sha?: string | null; originUrl?: string | null } | null;
}
