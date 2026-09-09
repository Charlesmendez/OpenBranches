/** A person supplies the service origin. Repository metadata never chooses it. */
export function teamOrigin(input: string, allowLoopback = false): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Enter the team service address, such as https://team.example.com.');
  }
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if (
    input.length > 2048 ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' && !(allowLoopback && loopback && url.protocol === 'http:'))
  )
    throw new Error('Use an HTTPS team address without a path, account details, or query.');
  return url.origin;
}
