import { open, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { DiscoveredProject } from '../../src/domain/types';

const pathSchema = z
  .string()
  .min(1)
  .max(16_384)
  .refine((value) => isAbsolute(value) && !value.includes('\0'));
const stateSchema = z.object({
  'electron-saved-workspace-roots': z.array(z.unknown()).max(5000).optional(),
  'electron-workspace-root-labels': z.record(z.string(), z.unknown()).optional(),
  'local-projects': z
    .record(z.string(), z.unknown())
    .refine((value) => Object.keys(value).length <= 5000)
    .optional(),
});
const projectSchema = z.object({
  name: z.string().max(4096),
  rootPaths: z.array(z.unknown()).max(5000),
});
const MAX_BYTES = 16 * 1024 * 1024;

// These are observed desktop formats, not a public Codex API. Read only the
// explicit saved-project fields; never retain task hints, prompts, or settings.
export function savedCodexProjects(value: unknown): { path: string; name: string }[] {
  const parsed = stateSchema.safeParse(value);
  if (!parsed.success) throw new Error('Codex projects could not be read. Try again shortly.');
  const state = parsed.data;
  if (!state['electron-saved-workspace-roots'] && !state['local-projects'])
    throw new Error('This Codex project format is not supported yet. You can still add folders.');
  const paths = new Map<string, string>();
  const add = (value: unknown, label: unknown) => {
    const path = pathSchema.safeParse(value);
    if (!path.success) return;
    if (paths.size >= 5000 && !paths.has(path.data))
      throw new Error('Too many saved project roots.');
    const name = typeof label === 'string' ? label.trim().slice(0, 4096) : '';
    paths.set(path.data, name || basename(path.data) || path.data);
  };
  for (const path of state['electron-saved-workspace-roots'] ?? [])
    add(
      path,
      typeof path === 'string' ? state['electron-workspace-root-labels']?.[path] : undefined,
    );
  for (const value of Object.values(state['local-projects'] ?? {})) {
    const project = projectSchema.safeParse(value);
    if (project.success) for (const path of project.data.rootPaths) add(path, project.data.name);
  }
  return [...paths].map(([path, name]) => ({ path, name }));
}

export async function readCodexProjects(
  directory = process.env.CODEX_HOME && isAbsolute(process.env.CODEX_HOME)
    ? process.env.CODEX_HOME
    : join(homedir(), '.codex'),
): Promise<DiscoveredProject[]> {
  let file;
  try {
    file = await open(
      join(directory, '.codex-global-state.json'),
      constants.O_RDONLY | constants.O_NONBLOCK,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error('Codex project folders are unavailable. Check access and try again.');
  }
  let saved: { path: string; name: string }[];
  try {
    if (!(await file.stat()).isFile()) throw new Error('Not a file');
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_BYTES) throw new Error('Too large');
    saved = savedCodexProjects(JSON.parse(buffer.subarray(0, length).toString('utf8')));
  } catch {
    throw new Error('Codex projects could not be read. Try again shortly or add a folder.');
  } finally {
    await file.close();
  }
  const projects = new Map<string, DiscoveredProject>();
  // Resolve only saved roots, without walking the disk or reading repository contents.
  for (const project of saved) {
    let path = project.path;
    let available = false;
    try {
      path = await realpath(path);
      available = (await stat(path)).isDirectory();
    } catch {
      /* Missing folders remain visible as unavailable suggestions. */
    }
    if (projects.has(path)) continue;
    projects.set(path, {
      id: createHash('sha256').update(path).digest('hex').slice(0, 24),
      path,
      name: project.name,
      source: 'codex',
      available,
    });
  }
  return [...projects.values()];
}
