/** An observation's clock is independent of its most recent attempted refresh. */
export function sourceStale(value: { observedAt: string; error?: string }, now = Date.now()) {
  const at = Date.parse(value.observedAt);
  return !!value.error || !Number.isFinite(at) || at > now + 60_000 || now - at > 10 * 60_000;
}

export function pullSourceStale(
  pull: { observedAt: string; retained?: boolean; sourceError?: string },
  now = Date.now(),
) {
  return (
    !!pull.retained || sourceStale({ observedAt: pull.observedAt, error: pull.sourceError }, now)
  );
}
