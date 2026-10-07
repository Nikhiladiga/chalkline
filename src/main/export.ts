import { writeFile } from 'node:fs/promises';
import { BrowserWindow, ClipboardItem, clipboard, ipcMain } from 'electron';
import { askSavePath } from './files';

/** Loads the renderer page into a window; `hash` selects the view. */
type Load = (win: BrowserWindow, hash: string) => void;
type Prefs = Electron.WebPreferences;

/**
 * Render `doc` at natural size in a hidden window running the same engine, then capture
 * `#eraser-scene` with CDP (the same call Playwright's element screenshot makes).
 */
export async function renderPng(
  load: Load,
  prefs: Prefs,
  doc: unknown,
  scale: 1 | 2,
  transparent: boolean,
  theme: 'dark' | 'light',
): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 900,
    webPreferences: { ...prefs, offscreen: true, backgroundThrottling: false },
  });
  let cleanup = () => {};
  try {
    const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('export render timed out'));
      }, 60_000);
      const onReady = (e: Electron.IpcMainEvent, payload: any) => {
        if (e.sender !== win.webContents) return;
        cleanup();
        payload?.error ? reject(new Error(payload.error)) : resolve(payload);
      };
      const onLoad = () => win.webContents.send('export:render', { doc, transparent, theme });
      const onFailure = (
        _event: Electron.Event,
        _code: number,
        description: string,
        _url: string,
        isMainFrame: boolean,
      ) => {
        if (isMainFrame === false) return;
        cleanup();
        reject(new Error(`Could not load the export renderer: ${description}`));
      };
      cleanup = () => {
        clearTimeout(timer);
        ipcMain.removeListener('export:ready', onReady);
        win.webContents.removeListener('did-finish-load', onLoad);
        win.webContents.removeListener('did-fail-load', onFailure);
      };
      ipcMain.on('export:ready', onReady);
      win.webContents.once('did-finish-load', onLoad);
      win.webContents.on('did-fail-load', onFailure);
      load(win, 'export');
    });
    const dbg = win.webContents.debugger;
    dbg.attach('1.3');
    if (transparent) {
      await dbg.sendCommand('Emulation.setDefaultBackgroundColorOverride', {
        color: { r: 0, g: 0, b: 0, a: 0 },
      });
    }
    const shot = (await dbg.sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height), scale },
    })) as { data: string };
    dbg.detach();
    return Buffer.from(shot.data, 'base64');
  } finally {
    cleanup();
    win.destroy();
  }
}

export async function exportPng(
  owner: BrowserWindow,
  load: Load,
  prefs: Prefs,
  arg: { doc: unknown; scale: 1 | 2; transparent: boolean; clipboard: boolean; theme: 'dark' | 'light' },
): Promise<string | null> {
  const png = await renderPng(load, prefs, arg.doc, arg.scale, arg.transparent, arg.theme);
  if (arg.clipboard) {
    await clipboard.write([
      new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) }),
    ]);
    return 'clipboard';
  }
  const path = await askSavePath(owner, 'diagram', 'png');
  if (!path) return null;
  await writeFile(path, png);
  return path;
}

export async function exportText(
  owner: BrowserWindow,
  kind: string,
  content: string,
  name: string,
): Promise<string | null> {
  const path = await askSavePath(owner, name, kind);
  if (!path) return null;
  await writeFile(path, content);
  return path;
}
