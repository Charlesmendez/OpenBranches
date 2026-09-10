import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const noticeName = 'THIRD_PARTY_NOTICES.md';
const licensePattern = /^(license|licence|copying|notice)(\..*|-.*)?$/i;

function packageName(key) {
  const path = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
  const parts = path.split('/');
  return parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}

function dependencyKey(packages, parent, name) {
  let cursor = parent;
  while (true) {
    const candidate = cursor ? `${cursor}/node_modules/${name}` : `node_modules/${name}`;
    if (packages[candidate]?.version) return candidate;
    if (!cursor) break;
    const marker = cursor.lastIndexOf('/node_modules/');
    cursor = marker < 0 ? '' : cursor.slice(0, marker);
  }
  throw new Error(`package-lock.json does not resolve ${name} from ${parent || 'the app'}.`);
}

export function productionPackages(lock) {
  const packages = lock?.packages;
  const rootDependencies = packages?.['']?.dependencies;
  if (!packages || !rootDependencies)
    throw new Error('package-lock.json does not contain a production dependency graph.');
  const pending = Object.keys(rootDependencies).map((name) => dependencyKey(packages, '', name));
  const visited = new Set();
  const result = [];
  while (pending.length) {
    const key = pending.shift();
    if (visited.has(key)) continue;
    visited.add(key);
    const entry = packages[key];
    if (!entry?.version || !entry.license)
      throw new Error(`Dependency metadata is incomplete for ${key}.`);
    result.push({ key, name: packageName(key), version: entry.version, license: entry.license });
    for (const name of Object.keys({
      ...entry.dependencies,
      ...entry.optionalDependencies,
    }))
      pending.push(dependencyKey(packages, key, name));
  }
  return result.sort(
    (left, right) =>
      left.name.localeCompare(right.name, 'en') || left.version.localeCompare(right.version, 'en'),
  );
}

async function packageLicense(root, dependency) {
  const folder = join(root, dependency.key);
  const files = (await readdir(folder, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && licensePattern.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, 'en'));
  if (!files.length) {
    const safeName = dependency.name.replaceAll('/', '--');
    files.push(join(root, 'legal', 'overrides', `${safeName}-${dependency.version}.txt`));
  }
  const texts = [];
  for (const file of files) {
    const path = file.startsWith(root) ? file : join(folder, file);
    texts.push((await readFile(path, 'utf8')).trim());
  }
  return texts.join('\n\n');
}

function markdownLicense(text) {
  return `\`\`\`text\n${text}\n\`\`\``;
}

export async function thirdPartyNotices(root = moduleRoot) {
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  const dependencies = await Promise.all(
    productionPackages(lock).map(async (dependency) => ({
      ...dependency,
      text: await packageLicense(root, dependency),
    })),
  );
  dependencies.push({
    key: 'electron',
    name: 'Electron',
    version: lock.packages['node_modules/electron'].version,
    license: 'MIT',
    text: (await readFile(join(root, 'node_modules', 'electron', 'LICENSE'), 'utf8')).trim(),
  });
  dependencies.push({
    key: 'provider-icons',
    name: 'LobeHub Icons',
    version: '1.95.0',
    license: 'MIT',
    text: (await readFile(join(root, 'assets', 'providers', 'LICENSE.txt'), 'utf8')).trim(),
  });
  dependencies.sort(
    (left, right) =>
      left.name.localeCompare(right.name, 'en') || left.version.localeCompare(right.version, 'en'),
  );

  const groups = new Map();
  for (const dependency of dependencies) {
    const packages = groups.get(dependency.text) ?? [];
    packages.push(`${dependency.name} ${dependency.version} (${dependency.license})`);
    groups.set(dependency.text, packages);
  }
  const lines = [
    '# OpenBranches third-party notices',
    '',
    'This file is generated from the locked production dependency graph. It also covers Electron and the bundled coding-tool icons.',
    '',
    'Electron includes Chromium and Node.js. Their complete generated notices are distributed beside this file as `LICENSES.chromium.html`.',
    '',
    '## Bundled components',
    '',
    ...dependencies.map(
      (dependency) => `- ${dependency.name} ${dependency.version} — ${dependency.license}`,
    ),
    '',
    '## License texts',
    '',
  ];
  let index = 0;
  for (const [text, packages] of groups) {
    index++;
    lines.push(
      `### License ${index}`,
      '',
      `Applies to: ${packages.join(', ')}`,
      '',
      markdownLicense(text),
      '',
    );
  }
  return `${lines.join('\n').trim()}\n`;
}

export async function writeThirdPartyNotices(root = moduleRoot) {
  const notices = await thirdPartyNotices(root);
  await writeFile(join(root, noticeName), notices, 'utf8');
}

export async function checkThirdPartyNotices(root = moduleRoot) {
  const expected = await thirdPartyNotices(root);
  const actual = await readFile(join(root, noticeName), 'utf8').catch(() => '');
  if (actual !== expected)
    throw new Error('THIRD_PARTY_NOTICES.md is stale. Run npm run notices:generate.');
}

export async function prepareLegalResources(root = moduleRoot) {
  await checkThirdPartyNotices(root);
  const destination = join(root, 'dist-legal');
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await Promise.all([
    copyFile(join(root, 'LICENSE'), join(destination, 'OPENBRANCHES_LICENSE.txt')),
    copyFile(join(root, noticeName), join(destination, 'THIRD_PARTY_NOTICES.txt')),
    copyFile(
      join(root, 'node_modules', 'electron', 'dist', 'LICENSES.chromium.html'),
      join(destination, 'LICENSES.chromium.html'),
    ),
  ]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (command === '--write') {
    await writeThirdPartyNotices();
    console.log(`Updated ${noticeName}.`);
  } else if (command === '--check') {
    await checkThirdPartyNotices();
    console.log(`${noticeName} is current.`);
  } else {
    throw new Error('Use --write or --check.');
  }
}
