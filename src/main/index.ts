import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { type Channel, parseArgs } from '../shared/ipc';
import { exportPng } from './export';
import * as files from './files';
import { handleIcons, registerIconScheme } from './icons';
import { chat, deepCwd, friendlyError, installedHarnesses, listModels } from './llm';
import { chooseProject, projectPath, scanSelectedProject } from './projects';
import { deepConsent, getKey, getSettings, publicSettings, setSettings } from './settings';

// The app was called Diagrammer; keep its data folder so settings and the icon cache survive the rename.
app.setPath('userData', process.env.DG_USER_DATA ?? join(app.getPath('appData'), 'diagrammer'));
registerIconScheme();

const prefs: Electron.WebPreferences = {
  preload: join(import.meta.dirname, '../preload/index.cjs'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
};

function load(win: BrowserWindow, hash = ''): void {
  const query = process.env.DG_TEST ? { test: '1' } : undefined;
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL);
    if (query) url.search = 'test=1';
    url.hash = hash;
    win.loadURL(url.toString());
  } else {
    win.loadFile(join(import.meta.dirname, '../renderer/index.html'), { hash, ...(query ? { query } : {}) });
  }
}

let main: BrowserWindow | null = null;
let dirty = false;

// E2E runs set DG_HIDE_WINDOW=1 so test windows never surface.
const hidden = process.env.DG_HIDE_WINDOW === '1';

function createWindow(): BrowserWindow {
  dirty = false;
  let discarding = false;
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#010102',
    title: 'Chalkline',
    // Packaged builds take the icon from the bundle; this covers `pnpm dev` on Windows/Linux.
    ...(app.isPackaged ? {} : { icon: join(app.getAppPath(), 'build/icon.png') }),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: !hidden,
    webPreferences: hidden ? { ...prefs, backgroundThrottling: false } : prefs,
  });
  win.on('close', (e) => {
    if (discarding) {
      e.preventDefault();
      return;
    }
    if (!dirty || process.env.DG_TEST) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Discard changes', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'You have unsaved changes.',
    });
    e.preventDefault();
    if (choice === 0) {
      discarding = true;
      void files
        .clearRecovery()
        .then(() => {
          discarding = false;
          dirty = false;
          win.close();
        })
        .catch((error: Error) => {
          discarding = false;
          dialog.showErrorBox('Could not discard recovery', error.message);
        });
    }
  });
  // Links in markdown text open in the browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  load(win);
  return win;
}

/** Native consent for Deep scan; tests (DG_TEST) skip the dialog. */
async function confirmDeepScan(win: BrowserWindow): Promise<boolean> {
  if (process.env.DG_TEST) return true;
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Turn On Deep Scan', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: 'Turn on Deep scan?',
    detail:
      'Claude Code will read files in the code folder you choose, read-only, and send what it reads to Anthropic without redaction. Common secret files are blocked, but .gitignore is not honoured, so secrets in ordinary files can be sent. It uses your plan’s quota and can take several minutes.',
  });
  return response === 0;
}

const aborts = new Map<string, AbortController>();
const handlers: { [C in Channel]: (arg: any, win: BrowserWindow, sender: Electron.WebContents) => unknown } =
  {
    'file:open': (_a, win) => files.openDialog(win),
    'file:reopen': (path) => files.reopen(path),
    'file:save': (a, win) => files.save(win, a.path, a.content),
    'recovery:write': (content) => files.writeRecovery(content),
    'recovery:read': () => files.readRecovery(),
    'recovery:clear': () => files.clearRecovery(),
    'settings:get': () => publicSettings(),
    'llm:harnesses': () => installedHarnesses(),
    'settings:set': async (patch, win) =>
      setSettings(await deepConsent(patch, getSettings().deepScan, () => confirmDeepScan(win))),
    'llm:models': async () => {
      const s = getSettings();
      try {
        return await listModels(s, getKey());
      } catch (e) {
        throw new Error(friendlyError(e, s));
      }
    },
    'llm:chat': async (a, _w, sender) => {
      const s = getSettings();
      const ac = new AbortController();
      aborts.set(a.id, ac);
      try {
        // Second gate: a projectId only works when Deep scan is on for a CLI provider.
        const cwd = a.projectId ? deepCwd(s, projectPath(a.projectId)) : undefined;
        return await chat(s, getKey(), a, (text) => sender.send('llm:chunk', { id: a.id, text }), ac.signal, {
          cwd,
          onProgress: (text) => !sender.isDestroyed() && sender.send('llm:progress', { id: a.id, text }),
        });
      } catch (e) {
        throw new Error(friendlyError(e, s));
      } finally {
        aborts.delete(a.id);
      }
    },
    'llm:cancel': (id) => aborts.get(id)?.abort(),
    'project:choose': (_a, win) => chooseProject(win),
    'project:scan': async (a) => {
      const ac = new AbortController();
      aborts.set(a.id, ac);
      try {
        return await scanSelectedProject(a.projectId, a.maxChars, ac.signal);
      } finally {
        aborts.delete(a.id);
      }
    },
    'export:png': (a, win) => exportPng(win, load, prefs, a),
    'export:save': (a, win) => files.saveExport(win, a.name, a.kind, a.content),
    'app:dirty': (flag) => {
      dirty = flag;
    },
  };

for (const [channel, handler] of Object.entries(handlers)) {
  ipcMain.handle(channel, (e, arg) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? main!;
    return handler(parseArgs(channel as Channel, arg), win, e.sender);
  });
}

function menu(): void {
  const send = (action: string) => () => main?.webContents.send('menu', action);
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { id: 'new', label: 'New', accelerator: 'CmdOrCtrl+N', click: send('new') },
        { id: 'new-tab', label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: send('newTab') },
        { id: 'open', label: 'Open…', accelerator: 'CmdOrCtrl+O', click: send('open') },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: send('saveAs') },
        { type: 'separator' },
        { label: 'Export PNG…', accelerator: 'CmdOrCtrl+E', click: send('exportPng') },
        { label: 'Export SVG…', accelerator: 'CmdOrCtrl+Shift+E', click: send('exportSvg') },
        { type: 'separator' },
        { id: 'close-tab', label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: send('closeTab') },
        process.platform === 'darwin'
          ? { id: 'close-window', role: 'close', label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W' }
          : { role: 'quit' },
      ],
    },
    // Undo/redo live in the renderer (canvas vs code editor decide), so only clipboard roles here.
    { label: 'Edit', submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'View',
      submenu: [
        // Listed for discoverability; the renderer handles these keys, so they are not registered here.
        {
          id: 'next-tab',
          label: 'Next Tab',
          accelerator: 'Ctrl+Tab',
          registerAccelerator: false,
          click: send('nextTab'),
        },
        {
          id: 'prev-tab',
          label: 'Previous Tab',
          accelerator: 'Ctrl+Shift+Tab',
          registerAccelerator: false,
          click: send('prevTab'),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { role: 'togglefullscreen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  if (hidden) app.dock?.hide();
  else if (!app.isPackaged) app.dock?.setIcon(join(app.getAppPath(), 'build/icon.png'));
  handleIcons(() => getSettings().hostedIcons);
  menu();
  main = createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) main = createWindow();
  });
});
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
