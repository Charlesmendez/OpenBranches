import type { Repository } from './types';
import type { ReviewedFinding } from './reviews';

export const triageQueues = {
  unpublished: {
    title: 'Check unpublished work',
    description: 'Review local work without a tracked remote copy.',
  },
  idle: {
    title: 'Revisit idle work',
    description: 'Decide what to resume, keep for later, or investigate.',
  },
  promotion: {
    title: 'Check integration gaps',
    description: 'Work appears in one target’s history but not another.',
  },
} as const;
export type TriageQueue = keyof typeof triageQueues;
export interface TriageItem {
  id: string;
  repositoryId: string;
  queue: TriageQueue;
  findings: ReviewedFinding[];
  updatedAt: number;
  score: number;
}
const rank = { 'local-only': 3, forgotten: 2, 'integration-gap': 1, verify: 0 };

/** One decision row per branch, regardless of how many rules matched it. */
export function triageFindings(
  findings: ReviewedFinding[],
  repositories: Repository[],
): TriageItem[] {
  const branches = new Map(
    repositories.flatMap((repo) => repo.branches.map((branch) => [branch.id, branch] as const)),
  );
  const grouped = new Map<string, ReviewedFinding[]>();
  for (const item of findings) {
    const group = grouped.get(item.finding.branchId) ?? [];
    group.push(item);
    grouped.set(item.finding.branchId, group);
  }
  return [...grouped]
    .map(([id, items]) => {
      items.sort(
        (a, b) =>
          rank[b.finding.category] - rank[a.finding.category] ||
          a.finding.id.localeCompare(b.finding.id),
      );
      const branch = branches.get(id);
      const category = items[0].finding.category;
      const queue: TriageQueue =
        category === 'local-only' ? 'unpublished' : category === 'forgotten' ? 'idle' : 'promotion';
      return {
        id,
        repositoryId: items[0].finding.repositoryId,
        queue,
        findings: items,
        updatedAt: Date.parse(branch?.updatedAt ?? '') || 0,
        score:
          rank[category] * 10 +
          (branch?.worktrees.some((tree) => tree.dirty) ? 5 : 0) +
          (branch?.tasks?.some((task) => task.association === 'verified' && !task.archived)
            ? 2
            : 0),
      };
    })
    .sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}

/** Keep a busy project from taking every spot in the starting list. */
export function triageHighlights(items: TriageItem[], limit = 5): TriageItem[] {
  const chosen: TriageItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!seen.has(item.repositoryId)) {
      chosen.push(item);
      seen.add(item.repositoryId);
      if (chosen.length === limit) return chosen;
    }
  }
  const ids = new Set(chosen.map((item) => item.id));
  return chosen.concat(items.filter((item) => !ids.has(item.id))).slice(0, limit);
}
