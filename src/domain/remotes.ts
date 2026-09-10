import type { Branch, Repository } from './types';

export type RemoteEvidenceState = 'published' | 'tracking' | 'missing';

export interface RemoteIdentity {
  name: string;
  url?: string;
  host?: string;
  destination?: string;
  state: RemoteEvidenceState;
}

function destinationFromUrl(value?: string): { host?: string; destination?: string } {
  if (!value) return {};
  try {
    const url = new URL(value);
    if (url.protocol === 'file:') return { destination: url.pathname };
    const path = url.pathname.replace(/^\/+/, '').replace(/\.git$/, '');
    return {
      host: url.hostname || undefined,
      destination: [url.hostname, path].filter(Boolean).join('/'),
    };
  } catch {
    const scp = value.match(/^(?:[^@\s]+@)?([^:\s]+):(.+)$/);
    if (!scp) return { destination: value.replace(/\.git$/, '') };
    const path = scp[2].replace(/^\/+/, '').replace(/\.git$/, '');
    return { host: scp[1], destination: `${scp[1]}/${path}` };
  }
}

export function remoteIdentity(
  repository: Pick<Repository, 'remotes'>,
  branch: Pick<Branch, 'remote' | 'publishedHistory'>,
): RemoteIdentity | undefined {
  if (!branch.remote) return undefined;
  const name = branch.remote.remote ?? branch.publishedHistory?.remoteName ?? 'remote';
  const configured = repository.remotes.find((remote) => remote.name === name);
  const { host, destination } = destinationFromUrl(configured?.url);
  const state: RemoteEvidenceState =
    branch.remote.presence === 'missing'
      ? 'missing'
      : branch.remote.source === 'github' && branch.remote.presence === 'present'
        ? 'published'
        : 'tracking';
  return { name, url: configured?.url, host, destination, state };
}

export function remoteEvidenceLabel(remote: RemoteIdentity, includeHost = false): string {
  const status =
    remote.state === 'published'
      ? `Published to ${remote.name}`
      : remote.state === 'missing'
        ? `${remote.name} copy no longer on GitHub`
        : `Tracking ${remote.name}`;
  return includeHost && remote.host ? `${status} · ${remote.host}` : status;
}

export function remoteDestinationLabel(remote: RemoteIdentity): string {
  return remote.destination ? `${remote.name} · ${remote.destination}` : remote.name;
}
