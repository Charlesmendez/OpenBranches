import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { TeamConfig } from '../config';
import type { TeamDatabase } from '../db';
import { TeamGitHubApp } from './app';
import { TeamGitHubSetup } from './setup';
import { TeamGitHubSync } from './sync';

export interface TeamGitHubServices {
  setup: TeamGitHubSetup;
  sync?: TeamGitHubSync;
}

/** A host-provided secret file is read once, into the server process only. */
export async function loadTeamGitHub(
  config: TeamConfig,
  db: TeamDatabase,
): Promise<TeamGitHubServices> {
  if (!config.githubPrivateKeyFile) return { setup: new TeamGitHubSetup(db) };
  if (!isAbsolute(config.githubPrivateKeyFile))
    throw new Error('Use an absolute GitHub App key-file path.');
  const file = await open(config.githubPrivateKeyFile, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 32_000)
      throw new Error('The GitHub App key file is unavailable or too large.');
    const buffer = Buffer.alloc(32_001);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 32_000) throw new Error('The GitHub App key file is too large.');
    try {
      const app = new TeamGitHubApp(
        config.githubClientId,
        buffer.subarray(0, bytesRead).toString('utf8'),
      );
      return { setup: new TeamGitHubSetup(db, app), sync: new TeamGitHubSync(db, app) };
    } finally {
      buffer.fill(0);
    }
  } finally {
    await file.close();
  }
}

export async function loadGitHubSetup(config: TeamConfig, db: TeamDatabase) {
  return (await loadTeamGitHub(config, db)).setup;
}
