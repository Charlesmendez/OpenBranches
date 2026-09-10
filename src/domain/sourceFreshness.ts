export function validObservationTime(value: string | undefined, now = Date.now()) {
  const at = Date.parse(value ?? '');
  return Number.isFinite(at) && at <= now + 60_000 ? at : undefined;
}

export function observationStale(value: string | undefined, maxAge: number, now = Date.now()) {
  const at = validObservationTime(value, now);
  return at === undefined || now - at > maxAge;
}

/** An observation's clock is independent of its most recent attempted refresh. */
export function sourceStale(value: { observedAt: string; error?: string }, now = Date.now()) {
  return !!value.error || observationStale(value.observedAt, 10 * 60_000, now);
}

export function pullSourceStale(
  pull: { observedAt: string; retained?: boolean; sourceError?: string },
  now = Date.now(),
) {
  return (
    !!pull.retained || sourceStale({ observedAt: pull.observedAt, error: pull.sourceError }, now)
  );
}
