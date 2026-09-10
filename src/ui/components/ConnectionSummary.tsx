import { Cloud, History, Laptop, Radio, type LucideIcon } from 'lucide-react';
import type { GitStatus, ProviderStatus } from '../../domain/types';
import { connectionSummaries, type ConnectionSummaryId } from '../settingsStatus';

const icons: Record<ConnectionSummaryId, LucideIcon> = {
  mac: Laptop,
  github: Cloud,
  history: History,
  live: Radio,
};

export function ConnectionSummary({
  git,
  providers,
  demo,
}: {
  git?: GitStatus;
  providers: ProviderStatus;
  demo: boolean;
}) {
  const sources = connectionSummaries(git, providers, demo);
  return (
    <div className="connection-summary" aria-label="Connection status">
      {sources.map((source) => {
        const Icon = icons[source.id];
        return (
          <div className={`connection-summary-item ${source.tone}`} key={source.id}>
            <Icon size={16} />
            <span>
              <small>{source.label}</small>
              <strong>{source.value}</strong>
            </span>
            <i aria-hidden="true" />
          </div>
        );
      })}
    </div>
  );
}
