import { build as bundle } from 'esbuild';
import { build } from 'vite';
import { buildIcons } from './icons.mjs';
import { prepareLegalResources } from './notices.mjs';
export async function buildElectron() {
  await bundle({
    entryPoints: {
      main: 'electron/main.ts',
      preload: 'electron/preload.ts',
      'git-worker': 'electron/git/worker.ts',
    },
    outdir: 'dist-electron',
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    external: ['electron'],
    sourcemap: true,
    define: { __GITHUB_APP_CLIENT_ID__: JSON.stringify(process.env.GITHUB_APP_CLIENT_ID ?? '') },
  });
}
if (process.argv[1]?.endsWith('build.mjs')) {
  await prepareLegalResources();
  await buildIcons();
  await buildElectron();
  await build();
}
