import type { Branch, Repository, Snapshot } from '../domain/types';
import { DAY } from '../domain/branches';

const now = Date.now();
const ago = (days: number, referenceTime: number) =>
  new Date(referenceTime - days * DAY).toISOString();
const titles = [
  'Voice integration',
  'Invoice export',
  'Crew profile logo',
  'Billing summary',
  'Job filters',
  'Invoice calculation',
  'Signup welcome email',
  'Account preferences',
  'Search shortcuts',
  'Usage billing',
  'Connection health',
  'Activity timeline',
];

function makeRepository(
  id: string,
  name: string,
  count: number,
  active: number,
  integrated: number,
  quiet: number,
  referenceTime: number,
): Repository {
  const targetNames = id === 'atlas' ? ['develop', 'master'] : ['main'];
  const branches: Branch[] = Array.from({ length: count }, (_, i) => {
    const state =
      i < active
        ? 'active'
        : i < active + integrated
          ? 'integrated'
          : i < active + integrated + quiet
            ? 'quiet'
            : 'unknown';
    const title =
      i < titles.length
        ? titles[i]
        : `${['Invoice', 'Workspace', 'Account', 'Search', 'Billing'][i % 5]} ${['polish', 'reliability', 'improvements', 'follow up'][i % 4]} ${i + 1}`;
    const name = `codex/${title.toLowerCase().replaceAll(' ', '-')}`;
    const sha = (i + 100000).toString(16).padEnd(40, 'a');
    const updatedAt = ago(state === 'active' ? (i + 1) / 8 : 25 + (i % 65), referenceTime);
    const local = {
      name,
      fullName: `refs/heads/${name}`,
      sha,
      updatedAt,
      subject: `Improve ${title.toLowerCase()}`,
    };
    const onlyLocal = i >= 5 && i < 9;
    const integration = Object.fromEntries(
      targetNames.map((target, ti) => [
        target,
        state === 'unknown'
          ? 'unknown'
          : state === 'integrated' || (i === 6 && ti === 0)
            ? 'integrated'
            : 'pending',
      ]),
    ) as Branch['integration'];
    return {
      id: `${id}:${i}`,
      repositoryId: id,
      name,
      title,
      local,
      remote: onlyLocal
        ? undefined
        : { ...local, fullName: `refs/remotes/origin/${name}`, remote: 'origin' },
      worktrees:
        i < 9
          ? [
              {
                path: `/demo/${id}/${name.split('/')[1]}`,
                head: sha,
                branch: local.fullName,
                detached: false,
                available: true,
                dirty: i === 5,
                changedFiles: i === 5 ? 3 : 0,
              },
            ]
          : [],
      updatedAt,
      integration,
      codexNamed: true,
      detached: false,
      pullRequest:
        i < 5
          ? {
              number: 482 - i * 2,
              title,
              url: 'https://github.com',
              state: 'open',
              base: targetNames[0],
              headSha: sha,
              updatedAt,
            }
          : undefined,
      tasks:
        i < active
          ? [
              {
                id: `demo-task-${id}-${i}`,
                tool: i % 3 === 0 ? 'codex' : i % 3 === 1 ? 'claude-code' : 'cursor',
                model:
                  i % 3 === 1
                    ? { id: 'claude-sonnet-4-6', provider: 'anthropic' }
                    : i % 3 === 2
                      ? { id: 'grok-code-fast-1', provider: 'xai' }
                      : undefined,
                title: `Improve ${title.toLowerCase()}`,
                status: i === 0 ? 'active' : 'idle',
                association: i % 3 === 1 ? 'possible' : 'verified',
                summary: `Implement and verify ${title.toLowerCase()}.`,
                updatedAt,
                checkedAt: new Date().toISOString(),
                evidence: [
                  'Saved task folder belongs to this repository.',
                  i % 3 === 1
                    ? 'Saved branch name matches; no commit was recorded.'
                    : 'Saved branch name and local commit match.',
                ],
              },
              ...(i === 0
                ? [
                    {
                      id: `demo-review-${id}`,
                      tool: 'claude-code' as const,
                      model: { id: 'claude-sonnet-4-6', provider: 'anthropic' as const },
                      title: `Review ${title.toLowerCase()}`,
                      status: 'unknown' as const,
                      association: 'possible' as const,
                      updatedAt,
                      evidence: ['Saved folder and branch match; no commit was recorded.'],
                    },
                    {
                      id: `demo-investigate-${id}`,
                      tool: 'codex' as const,
                      title: `Investigate ${title.toLowerCase()}`,
                      status: 'unknown' as const,
                      association: 'possible' as const,
                      archived: true,
                      updatedAt,
                      evidence: [
                        'Saved branch name matches.',
                        'The saved commit predates the current branch tip.',
                      ],
                    },
                    {
                      id: `demo-followup-${id}`,
                      tool: 'cursor' as const,
                      model: { id: 'grok-code-fast-1', provider: 'xai' as const },
                      title: `Follow up on ${title.toLowerCase()}`,
                      status: 'unknown' as const,
                      association: 'possible' as const,
                      updatedAt,
                      evidence: [
                        'Saved repository and branch name match.',
                        'The saved worktree is no longer available.',
                      ],
                    },
                  ]
                : []),
            ]
          : undefined,
    };
  });
  return {
    id,
    name,
    path: `/demo/${name}`,
    commonDir: `/demo/${name}/.git`,
    branches,
    targets: targetNames.map((name) => ({ name, sha: 'a'.repeat(40), source: 'github' })),
    worktrees: branches.flatMap((b) => b.worktrees),
    remotes: [{ name: 'origin', url: `https://github.com/example/${name}.git` }],
    scannedAt: new Date(referenceTime).toISOString(),
    shallow: false,
  };
}
export function createDemoSnapshot(referenceTime = now): Snapshot {
  return {
    repositories: [
      makeRepository('atlas', 'atlas-api', 229, 12, 158, 41, referenceTime),
      makeRepository('studio', 'studio', 37, 4, 23, 7, referenceTime),
      makeRepository('relay', 'relay', 137, 8, 103, 21, referenceTime),
    ],
    events: [
      {
        id: 'e1',
        repositoryId: 'atlas',
        branchId: 'atlas:0',
        kind: 'commit',
        title: 'New commit',
        detail: 'Voice integration',
        at: new Date(referenceTime - 30_000).toISOString(),
      },
      {
        id: 'e2',
        repositoryId: 'atlas',
        branchId: 'atlas:6',
        kind: 'integration',
        title: 'Integrated into develop',
        detail: 'Signup welcome email',
        at: new Date(referenceTime - 160_000).toISOString(),
      },
      {
        id: 'e3',
        repositoryId: 'relay',
        branchId: 'relay:5',
        kind: 'branch',
        title: 'Branch created on this Mac',
        detail: 'Invoice calculation',
        at: new Date(referenceTime - 360_000).toISOString(),
      },
    ],
    updatedAt: new Date(now).toISOString(),
    scanning: false,
  };
}
