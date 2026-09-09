import { teamConfig } from './config';
import { TeamDatabase } from './db';
import { TeamStore } from './store';
import { TeamOAuth } from './oauth';
import { TeamEvents } from './events';
import { createTeamServer } from './http';
import { loadTeamAssets } from './static';

async function main() {
  const config = teamConfig(process.env);
  const db = new TeamDatabase(config.databaseUrl);
  const store = new TeamStore(db, config.ownerGitHubId);
  const events = new TeamEvents(db);
  const server = createTeamServer(
    config,
    store,
    new TeamOAuth(db, config, store.identities),
    events,
    await loadTeamAssets(),
  );
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await events.close();
      await db.close();
    })());
  try {
    await db.migrate();
    await events.start();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, () => {
        server.off('error', reject);
        resolve();
      });
    });
  } catch (error) {
    await close();
    throw error;
  }
  const failed = () => {
    process.stderr.write(
      'The team service is unavailable. Check its database and listener configuration.\n',
    );
    process.exitCode = 1;
    void close().catch(() => {
      process.exitCode = 1;
    });
  };
  server.on('error', failed);
  process.stdout.write('OpenBranches team API is listening.\n');
  for (const signal of ['SIGTERM', 'SIGINT'] as const)
    process.once(signal, () => {
      void close().catch(failed);
    });
}
void main().catch(() => {
  process.stderr.write(
    'The team service could not start. Check its configuration and database connection.\n',
  );
  process.exitCode = 1;
});
