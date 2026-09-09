import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
await build({
  entryPoints: ['team-service/src/main.ts'],
  outdir: 'team-service/dist',
  platform: 'node',
  format: 'esm',
  bundle: true,
  target: 'node24',
  external: ['pg'],
  sourcemap: true,
});

await build({
  entryPoints: ['team-service/ui/main.tsx'],
  outdir: 'team-service/dist/public',
  entryNames: 'team',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2023',
  minify: true,
  jsx: 'automatic',
  loader: { '.svg': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"' },
});
await mkdir('team-service/dist/public', { recursive: true });
await writeFile(
  'team-service/dist/public/index.html',
  '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><title>OpenBranches · Team workspace</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/team.css"></head><body><div id="root"></div><script type="module" src="/team.js"></script></body></html>',
);
