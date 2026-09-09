import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  protocol,
  shell,
  Tray,
} from 'electron';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { access } from 'node:fs/promises';
import { z } from 'zod';
import { AppStore } from './services/store';
import { RepositoryService } from './services/repositories';
import { GitHubAuth } from './github/auth';
import { GitHubService } from './github/service';
import { createTokenVault } from './github/vault';
import { CodexService } from './codex/service';
import { GitInstallation, GIT_SETUP_GUIDE } from './git/installation';
declare const __GITHUB_APP_CLIENT_ID__: string;

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'openbranches',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);
const ownsLock = app.requestSingleInstanceLock();
if (!ownsLock) app.quit();
let window: BrowserWindow | null = null;
let tray: Tray | undefined;
let quitting = false;
let service: RepositoryService;
let store: AppStore;
let github: GitHubService | undefined;
let codex: CodexService | undefined;
let githubAuth: GitHubAuth;
let authTimer: ReturnType<typeof setInterval> | undefined;
const devUrl = !app.isPackaged ? process.env.OPENBRANCHES_DEV_URL : undefined;
function showWindow() {
  window?.show();
  window?.focus();
}

function createWindow() {
  window = new BrowserWindow({
    width: 1512,
    height: 982,
    minWidth: 1060,
    minHeight: 700,
    backgroundColor: '#131517',
    title: 'OpenBranches',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 23 },
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (
      !url.startsWith('openbranches://app/') &&
      !(devUrl && new URL(url).origin === new URL(devUrl).origin)
    )
      event.preventDefault();
  });
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.on('close', (event) => {
    if (!quitting && tray) {
      event.preventDefault();
      window?.hide();
    }
  });
  window.on('closed', () => {
    window = null;
  });
  void window.loadURL(devUrl ?? 'openbranches://app/index.html');
}
function handle(channel: string, listener: (...args: any[]) => unknown) {
  ipcMain.handle(channel, (event, ...args) => {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame)
      throw new Error('Invalid IPC sender');
    return listener(...args);
  });
}
app.whenReady().then(() => {
  if (!ownsLock) return;
  const dist = resolve(__dirname, '../dist');
  protocol.handle('openbranches', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== 'app' || request.method !== 'GET')
        return new Response('Not found', { status: 404 });
      const path = resolve(dist, `.${decodeURIComponent(url.pathname)}`);
      if (!path.startsWith(dist + sep)) return new Response('Forbidden', { status: 403 });
      const response = await net.fetch(pathToFileURL(path).href);
      const headers = new Headers(response.headers);
      headers.set(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      );
      headers.set('X-Content-Type-Options', 'nosniff');
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
  store = new AppStore(app.getPath('userData'));
  const snapshot = () => {
    const source = github?.enrich(service.current()) ?? service.current();
    return codex?.enrich(source) ?? source;
  };
  const publish = () => {
    window?.webContents.send('snapshot:updated', snapshot());
    if (codex) window?.webContents.send('codex:updated', codex.status());
  };
  const git = new GitInstallation((status) => window?.webContents.send('git:updated', status));
  service = new RepositoryService(store, publish, git);
  githubAuth = new GitHubAuth(__GITHUB_APP_CLIENT_ID__, createTokenVault(store));
  github = new GitHubService(store, githubAuth, () => service.current(), publish);
  codex = new CodexService(
    store,
    join(app.getPath('userData'), 'codex-inspection'),
    () => github!.enrich(service.current()),
    publish,
  );
  const githubStatus = () => ({ ...githubAuth.status(), enabled: github!.isEnabled() });
  const pollGitHub = async () => {
    const wasConnected = githubAuth.status().connected;
    await githubAuth.poll();
    if (!wasConnected && githubAuth.status().connected) {
      github!.setEnabled(true);
      void github!.refresh();
    }
    const status = githubStatus();
    window?.webContents.send('github:updated', status);
    return status;
  };
  authTimer = setInterval(() => {
    if (githubAuth.status().device) void pollGitHub();
  }, 5000);
  handle('snapshot:get', snapshot);
  handle('git:check', async () => {
    const before = git.status().state;
    const status = await git.check(true);
    if (before !== 'ready' && status.state === 'ready') void service.refresh();
    return status;
  });
  handle('git:install', () => git.requestInstall());
  handle('git:guide', () => shell.openExternal(GIT_SETUP_GUIDE));
  handle('snapshot:refresh', async () => {
    await service.refresh();
    await Promise.all([github!.refresh(), codex!.refresh()]);
  });
  handle('repository:add', async () => {
    await git.executable();
    const result = await dialog.showOpenDialog(window!, {
      title: 'Choose a Git repository',
      properties: ['openDirectory'],
    });
    if (result.canceled) return null;
    const repository = await service.add(result.filePaths[0]);
    void github!.refresh();
    void codex!.refresh();
    return repository;
  });
  handle('repository:remove', (id: unknown) => {
    service.remove(z.string().parse(id));
    codex!.forgetUnselected();
  });
  handle('worktree:reveal', async (id: unknown, branchId: unknown) => {
    const repository = service.current().repositories.find((r) => r.id === z.string().parse(id));
    if (!repository) throw new Error('Repository not found');
    const branch = branchId
      ? repository.branches.find((b) => b.id === z.string().parse(branchId))
      : undefined;
    if (branchId && !branch) throw new Error('Branch no longer exists. Refresh the repository.');
    const path = branch?.worktrees.find((w) => w.available)?.path ?? repository.path;
    await access(path);
    shell.showItemInFolder(path);
  });
  handle('external:open', (input: unknown) => {
    const url = new URL(z.string().parse(input));
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'github.com' ||
      url.port ||
      url.username ||
      url.password
    )
      throw new Error('Unsupported external link');
    return shell.openExternal(url.toString());
  });
  handle('providers:status', async () => {
    await codex!.detect();
    return { codex: codex!.status(), github: githubStatus() };
  });
  handle('codex:connect', () => codex!.connect());
  handle('codex:disconnect', () => codex!.disconnect());
  handle('github:connect', async () => {
    await githubAuth.begin();
    return githubStatus();
  });
  handle('github:poll', pollGitHub);
  handle('github:disconnect', () => {
    githubAuth.disconnect();
    github!.setEnabled(false);
    window?.webContents.send('github:updated', githubStatus());
  });
  handle('github:public', () => {
    github!.setEnabled(true);
    window?.webContents.send('github:updated', githubStatus());
    return github!.refresh();
  });
  createWindow();
  // A monochrome template icon adapts to the system menu bar appearance.
  const icon = nativeImage
    .createFromPath(join(__dirname, '../assets/trayTemplate.png'))
    .resize({ width: 22, height: 22 });
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('OpenBranches');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open OpenBranches', click: showWindow },
      {
        label: 'Refresh repositories',
        click: () => {
          void service.refresh();
        },
      },
      { type: 'separator' },
      { label: 'Quit OpenBranches', click: () => app.quit() },
    ]),
  );
  tray.on('click', showWindow);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'OpenBranches',
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]),
  );
  void service.refresh();
  void github.refresh();
  void codex.refresh();
});
app.on('activate', () => {
  if (!window) createWindow();
  else showWindow();
});
app.on('second-instance', showWindow);
app.on('before-quit', () => {
  quitting = true;
  if (authTimer) clearInterval(authTimer);
  github?.close();
  codex?.close();
  service?.close();
  store?.close();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
