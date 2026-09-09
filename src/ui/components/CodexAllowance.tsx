import type { CodexAccount } from '../../domain/types';
import { relativeTime } from '../../domain/branches';

function windowLabel(minutes: number | undefined, fallback: string) {
  if (!minutes) return fallback;
  if (minutes % 1440 === 0) return `${minutes / 1440}-day allowance`;
  if (minutes % 60 === 0) return `${minutes / 60}-hour allowance`;
  return `${minutes}-minute allowance`;
}

export function CodexAllowance({ account }: { account: CodexAccount }) {
  const bucket = account.limits.find((limit) => limit.id === 'codex');
  return (
    <div className="codex-allowance">
      <h4>Codex allowance</h4>
      {account.auth === 'chatgpt' ? (
        <>
          {bucket?.available && !account.error ? (
            <div className="allowance-windows">
              {[
                ['Current allowance', bucket.primary],
                ['Longer allowance', bucket.secondary],
              ].map(([fallback, value]) => {
                if (typeof value !== 'object' || !value) return null;
                const remaining = Math.max(0, Math.min(100, 100 - value.usedPercent));
                const label = windowLabel(value.windowDurationMins, String(fallback));
                return (
                  <div className="allowance-window" key={label}>
                    <div>
                      <span>{label}</span>
                      <strong>{remaining}% left</strong>
                    </div>
                    <meter min={0} max={100} value={remaining} aria-label={`${label} remaining`} />
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="muted-note">Usage is currently unavailable.</p>
          )}
          {bucket?.exhausted && (
            <p className="muted-note">
              Codex reports an account limit. AI reviews will wait for available allowance.
            </p>
          )}
          <p className="muted-note">
            Shared with your other Codex work. Checked{' '}
            {relativeTime(account.checkedAt).toLowerCase()}.
          </p>
        </>
      ) : (
        <p className="muted-note">
          {account.auth === 'signed-out'
            ? 'Sign in to Codex with ChatGPT to use the planned AI advisor.'
            : account.auth === 'other'
              ? 'This Codex installation is using a different sign-in method. The planned advisor uses ChatGPT sign-in.'
              : 'Sign-in status could not be checked.'}{' '}
          Task linking works independently.
        </p>
      )}
      {account.error && <p className="muted-note">{account.error}</p>}
      <p className="muted-note">
        AI reviews are not enabled in this preview. OpenBranches will limit reviews to six per 24
        hours and never redeem reset credits.
      </p>
    </div>
  );
}
