import { parentPort } from 'node:worker_threads';
import { scanRepository } from './scanner';

parentPort?.on('message', async ({ id, path }: { id: number; path: string }) => {
  try {
    parentPort?.postMessage({ id, repository: await scanRepository(path) });
  } catch (error) {
    parentPort?.postMessage({
      id,
      error: error instanceof Error ? error.message : 'Could not inspect repository',
    });
  }
});
