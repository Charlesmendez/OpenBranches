import { z } from 'zod';
import type { PreparedAnalysis } from './packet';
import { ADVISOR_POLICY } from './policy';

export const advisorOutputSchema = z
  .object({
    findings: z
      .array(
        z
          .object({
            branchId: z.string().max(64),
            category: z.enum(['forgotten', 'cleanup-candidate', 'integration-gap', 'verify']),
            title: z.string().min(1).max(160),
            explanation: z.string().min(1).max(1000),
            uncertainty: z.string().min(1).max(600),
            evidenceIds: z.array(z.string().max(64)).min(1).max(12),
          })
          .strict(),
      )
      .max(ADVISOR_POLICY.maxFindings),
  })
  .strict();

export function validateFindings(output: unknown, prepared: PreparedAnalysis) {
  const result = advisorOutputSchema.parse(output);
  const seen = new Set<string>();
  return result.findings.map((finding) => {
    const branch = prepared.packet.branches.find((record) => record.id === finding.branchId);
    const binding = prepared.bindings.get(finding.branchId);
    if (!branch || !binding) throw new Error('Advisor cited a branch outside this review.');
    const evidence = new Set(branch.facts.map((fact) => fact.id));
    if (
      finding.evidenceIds.some((id) => !evidence.has(id)) ||
      new Set(finding.evidenceIds).size !== finding.evidenceIds.length
    )
      throw new Error('Advisor cited missing, duplicate, or unrelated branch evidence.');
    if (finding.category === 'cleanup-candidate') {
      const fact = (kind: string) => branch.facts.find((entry) => entry.kind === kind);
      const worktrees = z
        .object({
          dirty: z.number(),
          unchecked: z.number(),
          unavailable: z.number(),
          locked: z.number(),
          detached: z.boolean(),
        })
        .parse(fact('worktrees')?.value);
      const integration = z
        .array(
          z.object({
            local: z.string(),
            remote: z.string(),
            tip: z.string().nullable(),
            source: z.string(),
          }),
        )
        .parse(fact('integration')?.value);
      const source = z
        .object({
          localStale: z.boolean(),
          remoteStale: z.boolean(),
          shallow: z.boolean(),
          remoteUnavailable: z.boolean(),
          remotePartial: z.boolean(),
        })
        .parse(fact('source')?.value);
      const remote = fact('remote')?.value;
      const localEvidence = z
        .object({ present: z.boolean(), tip: z.string().nullable() })
        .parse(fact('local')?.value);
      const local = localEvidence.present;
      const pull = fact('pull-request')?.value;
      const tasks = fact('tasks')?.value;
      const remoteIsCurrent =
        !remote ||
        (typeof remote === 'object' &&
          !Array.isArray(remote) &&
          remote.source === 'github' &&
          typeof remote.tip === 'string' &&
          remote.presence === 'present' &&
          !remote.unavailable &&
          !remote.partial &&
          !source.remoteStale);
      const hasOpenPull =
        !!pull && typeof pull === 'object' && !Array.isArray(pull) && pull.state === 'open';
      const activity = fact('task-activity')?.value;
      const hasActiveTask =
        !!activity &&
        typeof activity === 'object' &&
        !Array.isArray(activity) &&
        Number(activity.active) > 0;
      const missingCitations = [
        'worktrees',
        'integration',
        'source',
        ...(remote ? ['remote'] : []),
        ...(pull ? ['pull-request'] : []),
        ...(tasks ? ['tasks', 'task-activity'] : []),
      ].some((kind) => !finding.evidenceIds.includes(fact(kind)!.id));
      if (
        missingCitations ||
        worktrees.dirty ||
        worktrees.unchecked ||
        worktrees.unavailable ||
        worktrees.locked ||
        worktrees.detached ||
        source.localStale ||
        source.shallow ||
        !remoteIsCurrent ||
        hasOpenPull ||
        hasActiveTask ||
        (local && !localEvidence.tip) ||
        (!local && !remote) ||
        !integration.length ||
        integration.some(
          (target) =>
            !target.tip ||
            target.source === 'cached-remote' ||
            (target.source === 'github' &&
              (source.remoteStale || source.remoteUnavailable || source.remotePartial)) ||
            (local && target.local !== 'integrated') ||
            (remote && target.remote !== 'integrated'),
        )
      )
        throw new Error(
          'Cleanup suggestion lacks current integration evidence or conflicts with work that must be preserved.',
        );
    }
    const key = `${finding.branchId}:${finding.category}`;
    if (seen.has(key)) throw new Error('Advisor returned duplicate findings.');
    seen.add(key);
    return {
      ...finding,
      ...binding,
      revision: prepared.revision,
      preparedAt: prepared.packet.preparedAt,
      checkedAt: branch.checkedAt,
    };
  });
}
