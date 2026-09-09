/** Separate native fixture entry. It is bundled into an owned temporary folder,
 * never dist-electron or the release app. Only fictional repositories are read. */
import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { AppStore } from '../../electron/services/store';
import { createSecretVault } from '../../electron/services/secretVault';
import { TeamConnections } from '../../electron/team/connections';
import { registerTeamHandlers } from '../../electron/team/ipc';
import { TeamPublisher } from '../../electron/team/publisher';
import { createDemoSnapshot } from '../../src/data/demo';
import type { Snapshot } from '../../src/domain/types';

if (app.isPackaged || process.env.OPENBRANCHES_NATIVE_TEAM_FIXTURE !== '1')
  throw new Error('Use the isolated native fixture script.');
const data = join(__dirname, 'userdata');
const address = new URL(process.env.OPENBRANCHES_NATIVE_TEAM_UI!);
if (
  address.protocol !== 'http:' ||
  address.hostname !== '127.0.0.1' ||
  address.pathname !== '/tests/ui/team-native.html'
)
  throw new Error('The fixture UI must use the selected loopback server.');
app.setPath('userData', data);
app.setName('OpenBranches Team Preview');
let store: AppStore, teams: TeamConnections, publisher: TeamPublisher;
let closed = false;
const shutdown = () => {
  if (closed) return;
  closed = true;
  teams?.close();
  publisher?.close();
  store?.close();
};
app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1220,
    height: 950,
    minWidth: 1000,
    minHeight: 700,
    title: 'OpenBranches · Fictional Mac team preview',
    backgroundColor: '#131517',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, 'preload.cjs'),
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== address.origin) event.preventDefault();
  });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  window.webContents.session.setPermissionCheckHandler(() => false);
  store = new AppStore(data);
  let snapshot = store.read<Snapshot>('fixture.snapshot', createDemoSnapshot());
  store.write('fixture.snapshot', snapshot);
  teams = new TeamConnections(
    createSecretVault(store, 'team.credentials', safeStorage),
    () => snapshot,
    (state) => window.webContents.send('team:updated', state),
    { allowLoopback: true, onRevoked: (id) => publisher?.confirmedRevocation(id) },
  );
  publisher = new TeamPublisher(
    createSecretVault(store, 'team.sharing', safeStorage),
    teams,
    () => snapshot,
    (state) => window.webContents.send('team:sharing-updated', state),
  );
  const handle = (channel: string, run: (...args: any[]) => unknown) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
        throw new Error('Invalid fixture sender');
      return run(...args);
    });
  registerTeamHandlers(handle, teams, (url) => shell.openExternal(url), publisher);
  handle('fixture:snapshot', () => snapshot);
  handle('fixture:change', () => {
    const now = new Date().toISOString();
    snapshot = structuredClone(snapshot);
    const repository = snapshot.repositories[0];
    repository.scannedAt = now;
    repository.branches[0].local!.sha = randomBytes(20).toString('hex');
    snapshot.updatedAt = now;
    store.write('fixture.snapshot', snapshot);
    return snapshot;
  });
  handle('fixture:restart', () => {
    setTimeout(() => {
      shutdown();
      app.exit(75);
    }, 100);
  });
  void window.loadURL(address.href);
  teams.start();
  publisher.start();
});
app.on('before-quit', shutdown);
app.on('window-all-closed', () => app.quit());
process.once('SIGTERM', () => app.quit());
