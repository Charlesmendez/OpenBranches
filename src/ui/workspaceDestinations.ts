import type { TeamConnectionStatus } from '../team/device';

export function workspaceTeamName(connection: TeamConnectionStatus) {
  if (connection.identity?.workspaceName) return connection.identity.workspaceName;
  try {
    return new URL(connection.origin).hostname;
  } catch {
    return 'Team workspace';
  }
}

/** Present a team once even if an old connection attempt for the same origin
 * still exists, preferring a usable connection over recovery states. */
export function workspaceConnections(connections: TeamConnectionStatus[]) {
  const ordered = [...connections].sort(
    (left, right) =>
      Number(right.state === 'connected') - Number(left.state === 'connected') ||
      workspaceTeamName(left).localeCompare(workspaceTeamName(right)),
  );
  const seen = new Set<string>();
  return ordered.filter((connection) => {
    const keys = [connection.origin, connection.identity?.workspaceId].filter(
      (value): value is string => !!value,
    );
    if (keys.some((key) => seen.has(key))) return false;
    keys.forEach((key) => seen.add(key));
    return true;
  });
}
