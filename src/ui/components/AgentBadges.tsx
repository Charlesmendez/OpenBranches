import { CircleHelp, CodeXml } from 'lucide-react';
import type { Branch, CodingTool, ModelIdentity } from '../../domain/types';
import { branchTools, isGrokModel, toolNames } from '../../domain/agents';
import codex from '../../../assets/providers/codex.svg';
import claude from '../../../assets/providers/claude.svg';
import cursor from '../../../assets/providers/cursor.svg';
import grok from '../../../assets/providers/grok.svg';

const icons: Partial<Record<CodingTool, string>> = { codex, 'claude-code': claude, cursor };
function GrokIcon() {
  return (
    <span
      className="tool-icon"
      style={{ maskImage: 'url(' + JSON.stringify(grok) + ')' }}
      aria-hidden="true"
    />
  );
}
export function ToolIcon({ tool }: { tool: CodingTool }) {
  const icon = icons[tool];
  return icon ? (
    <span
      className={'tool-icon ' + tool}
      style={{ maskImage: 'url(' + JSON.stringify(icon) + ')' }}
      aria-hidden="true"
    />
  ) : tool === 'unknown' ? (
    <CircleHelp size={16} aria-hidden="true" />
  ) : (
    <CodeXml size={16} aria-hidden="true" />
  );
}
export function AgentBadges({
  branch,
  compact = false,
}: {
  branch: Pick<Branch, 'tasks'>;
  compact?: boolean;
}) {
  const tools = branchTools(branch);
  if (!tools.length)
    return (
      <span
        className="agent-badges unknown"
        title="No coding tool is linked to this branch"
        aria-label="Coding tool unknown"
      >
        <ToolIcon tool="unknown" />
        {!compact && 'Tool unknown'}
      </span>
    );
  return (
    <span className={'agent-badges' + (compact ? ' compact' : '')}>
      {tools.slice(0, 3).map(({ tool, verifiedCount, count, modelIds, grok }) => {
        const possibleCount = count - verifiedCount;
        const label =
          toolNames[tool] +
          ' · ' +
          count +
          (count === 1 ? ' saved session' : ' saved sessions') +
          (verifiedCount
            ? ' · ' +
              verifiedCount +
              ' branch and commit ' +
              (verifiedCount === 1 ? 'match' : 'matches')
            : '') +
          (possibleCount
            ? ' · ' +
              possibleCount +
              ' possible ' +
              (possibleCount === 1 ? 'association' : 'associations')
            : '') +
          (modelIds.length ? ' · Recorded models: ' + modelIds.slice(0, 3).join(', ') : '');
        return (
          <span
            key={tool}
            className={'agent-badge ' + (possibleCount ? 'possible' : 'matched')}
            title={label}
            aria-label={label}
          >
            <ToolIcon tool={tool} />
            {grok && <GrokIcon />}
            {!compact && toolNames[tool] + (grok ? ' · Grok' : '')}
            {!!possibleCount && <i aria-hidden="true">?</i>}
          </span>
        );
      })}
      {tools.length > 3 && (
        <span
          title={tools
            .slice(3)
            .map(({ tool }) => toolNames[tool])
            .join(', ')}
        >
          +{tools.length - 3}
        </span>
      )}
    </span>
  );
}
export function ReportedModel({ model }: { model: ModelIdentity }) {
  return (
    <span className="reported-model" title="Model reported in saved session metadata">
      {isGrokModel(model) && <GrokIcon />}
      <span>Recorded model · {model.id}</span>
    </span>
  );
}
