import type { Branch, CodingTool, ModelIdentity, TaskLink } from './types';

export const toolNames: Record<CodingTool, string> = {
  codex: 'Codex',
  'claude-code': 'Claude Code',
  cursor: 'Cursor',
  other: 'Other tool',
  unknown: 'Unknown tool',
};
export const knownTool = (value: unknown): CodingTool =>
  typeof value === 'string' && Object.hasOwn(toolNames, value) ? (value as CodingTool) : 'unknown';
export const taskKey = (task: Pick<TaskLink, 'id' | 'tool'>) =>
  knownTool(task.tool) + ':' + task.id;
export const isGrokModel = (model: ModelIdentity | undefined) =>
  model?.provider === 'xai' && typeof model.id === 'string' && /^grok(?:-|$)/i.test(model.id);

export function branchTools(branch: Pick<Branch, 'tasks'>) {
  const sources = new Map<
    CodingTool,
    { tool: CodingTool; verifiedCount: number; count: number; modelIds: string[]; grok: boolean }
  >();
  for (const task of branch.tasks ?? []) {
    const tool = knownTool(task.tool);
    const previous = sources.get(tool);
    sources.set(tool, {
      tool,
      verifiedCount: (previous?.verifiedCount ?? 0) + (task.association === 'verified' ? 1 : 0),
      count: (previous?.count ?? 0) + 1,
      modelIds: [
        ...new Set([...(previous?.modelIds ?? []), ...(task.model?.id ? [task.model.id] : [])]),
      ],
      grok: !!previous?.grok || isGrokModel(task.model),
    });
  }
  return [...sources.values()].sort((a, b) => toolNames[a.tool].localeCompare(toolNames[b.tool]));
}
export function agentSearchText(branch: Pick<Branch, 'tasks'>): string {
  return (branch.tasks ?? [])
    .map((task) =>
      [toolNames[knownTool(task.tool)], task.title, task.model?.id, task.model?.provider]
        .filter(Boolean)
        .join(' '),
    )
    .join(' ');
}
