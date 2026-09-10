import {
  FilePenLine,
  GitCommitHorizontal,
  Laptop,
  MessageCircleQuestion,
  Radio,
} from 'lucide-react';
import type { WorkSignal, WorkSignalKind } from '../../domain/workSpotlight';
import { ToolIcon } from './AgentBadges';

const icons = {
  live: Radio,
  waiting: MessageCircleQuestion,
  changes: FilePenLine,
  recent: GitCommitHorizontal,
  checkout: Laptop,
} satisfies Record<WorkSignalKind, typeof Radio>;

export function WorkSignalIcon({ signal, size = 15 }: { signal: WorkSignal; size?: number }) {
  if (signal.tools.length)
    return signal.tools.slice(0, 2).map((tool) => <ToolIcon key={tool} tool={tool} />);
  const Icon = icons[signal.kind];
  return <Icon size={size} aria-hidden="true" />;
}
