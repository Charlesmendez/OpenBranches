import type { CodingTool, ModelIdentity, RuntimeActivitySource } from '../../src/domain/types';

export interface SavedAgentTask {
  id: string;
  tool: CodingTool;
  name?: string | null;
  cwd: string;
  updatedAt: number;
  checkedAt?: string;
  archived?: boolean;
  model?: ModelIdentity;
  runtime?: {
    state: 'active' | 'idle' | 'waiting';
    checkedAt: string;
    source: RuntimeActivitySource;
  };
  gitInfo?: { branch?: string | null; sha?: string | null; originUrl?: string | null } | null;
}
