export function githubRepository(remoteUrl: string): string | undefined {
  const scp = /^(?:git@)?github\.com:([^/]+\/[^/]+?)\/?$/.exec(remoteUrl);
  let path = scp?.[1];
  if (!path) {
    try {
      const url = new URL(remoteUrl);
      if (url.hostname !== 'github.com' || !['https:', 'ssh:'].includes(url.protocol)) return;
      path = url.pathname.slice(1).replace(/\/$/, '');
    } catch {
      return;
    }
  }
  path = path.replace(/\.git$/, '');
  return /^[\w.-]+\/[\w.-]+$/.test(path) ? path : undefined;
}
