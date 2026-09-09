import { parentPort } from 'node:worker_threads';
import { scanRepository } from './scanner';

parentPort?.on(
  'message',
  async ({ id, path, executable }: { id: number; path: string; executable: string }) => {
    try {
      parentPort?.postMessage({ id, repository: await scanRepository(path, executable) });
    } catch (error) {
      parentPort?.postMessage({
        id,
        error: error instanceof Error ? error.message : 'Could not inspect repository',
      });
    }
  },
);
