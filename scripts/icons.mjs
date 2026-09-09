import { Resvg } from '@resvg/resvg-js';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export async function buildIcons() {
  await mkdir('assets', { recursive: true });
  const brand = await readFile('assets/brand.svg', 'utf8');
  const symbol = brand.replace(/<svg[^>]+>/, '').replace('</svg>', '');
  const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><defs><linearGradient id="bg" x2=".3" y2="1"><stop stop-color="#292d3b"/><stop offset="1" stop-color="#111216"/></linearGradient><linearGradient id="mark" x2="1" y2="1"><stop stop-color="#d7dfff"/><stop offset="1" stop-color="#8da9ff"/></linearGradient></defs><rect x="32" y="32" width="960" height="960" rx="214" fill="url(#bg)" stroke="#444958" stroke-width="4"/><g transform="translate(226 205) scale(20.4)" fill="none" stroke="url(#mark)" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${symbol}</g></svg>`;
  await writeFile('assets/icon.svg', icon);
  const png = (width) =>
    new Resvg(icon, { fitTo: { mode: 'width', value: width } }).render().asPng();
  await writeFile('assets/icon.png', png(1024));
  await writeFile(
    'assets/trayTemplate.png',
    new Resvg(brand.replace('#a1b8ff', '#000000'), { fitTo: { mode: 'width', value: 44 } })
      .render()
      .asPng(),
  );
  if (process.platform !== 'darwin') return;
  const directory = await mkdtemp(join(tmpdir(), 'openbranches-icons-'));
  try {
    const iconset = join(directory, 'OpenBranches.iconset');
    await mkdir(iconset);
    for (const size of [16, 32, 128, 256, 512]) {
      await writeFile(join(iconset, `icon_${size}x${size}.png`), png(size));
      await writeFile(join(iconset, `icon_${size}x${size}@2x.png`), png(size * 2));
    }
    execFileSync('/usr/bin/iconutil', ['-c', 'icns', '-o', 'assets/icon.icns', iconset]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
