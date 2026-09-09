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
