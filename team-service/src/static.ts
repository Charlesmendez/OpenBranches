import { readFile } from 'node:fs/promises';
export type TeamAssets = Map<string, { type: string; body: Buffer }>;
/** Load only build-produced, fixed asset names. Request paths never reach fs. */
export async function loadTeamAssets(
  directory = new URL('./public/', import.meta.url),
): Promise<TeamAssets> {
  const files = [
    ['/', 'index.html', 'text/html; charset=utf-8'],
    ['/team.js', 'team.js', 'text/javascript; charset=utf-8'],
    ['/team.css', 'team.css', 'text/css; charset=utf-8'],
  ];
  const entries = await Promise.all(
    files.map(
      async ([path, file, type]) =>
        [path, { type, body: await readFile(new URL(file, directory)) }] as const,
    ),
  );
  return new Map(entries);
}
