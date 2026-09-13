import { Download, X } from 'lucide-react';
import type { UpdateController } from '../hooks/useUpdates';

export function UpdateNotice({
  updates,
  onLater,
}: {
  updates: UpdateController;
  onLater: () => void;
}) {
  const status = updates.status;
  if (status?.state !== 'ready') return null;
  const release = status.availableVersion
    ? `Version ${status.availableVersion}`
    : status.releaseName || 'A new version';
  return (
    <aside className="update-notice" role="status" aria-label="OpenBranches update ready">
      <span className="update-notice-icon">
        <Download size={17} />
      </span>
      <span>
        <strong>{release} is ready.</strong>
        <small>Restart OpenBranches to finish the update.</small>
      </span>
      <button className="primary-button" onClick={() => void updates.install()}>
        Restart and update
      </button>
      <button className="icon-button" aria-label="Remind me later" onClick={onLater}>
        <X size={15} />
      </button>
    </aside>
  );
}
