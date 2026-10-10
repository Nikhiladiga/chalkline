import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { app, type BrowserWindow, dialog } from 'electron';
import type { OpenedFile } from '../shared/ipc';
import { allowedSave, chosenKey, outsideAppData } from './savePaths';

const userFile = (name: string) => join(app.getPath('userData'), name);
const FILTERS = [{ name: 'Diagram', extensions: ['json'] }];

/** Write beside the destination, then atomically replace it; never truncate a user's last good file. */
async function atomicWrite(path: string, content: string | Uint8Array): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, content, { flag: 'wx', mode: 0o600 });
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}

/** Documents the user picked in a native Open/Save dialog: the only paths `file:save` may overwrite silently. */
const chosen = new Set<string>();
const choose = async (path: string) => chosen.add(await chosenKey(path));

async function openPath(path: string): Promise<OpenedFile> {
  const content = await readFile(path, 'utf8');
  app.addRecentDocument(path);
  return { path, content };
}

export async function openDialog(win: BrowserWindow): Promise<OpenedFile | null> {
  const r = await dialog.showOpenDialog(win, { filters: FILTERS, properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const opened = await openPath(r.filePaths[0]);
  await choose(opened.path);
  return opened;
}

/** Ask where to save (tests set DG_SAVE_DIR to skip the dialog). `name` is only ever a file name. */
async function askSavePath(win: BrowserWindow, name: string, ext: string): Promise<string | null> {
  const file = `${basename(name)}.${ext}`;
  if (process.env.DG_SAVE_DIR) return join(process.env.DG_SAVE_DIR, file);
  const r = await dialog.showSaveDialog(win, {
    defaultPath: file,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  return r.canceled || !r.filePath ? null : r.filePath;
}

/** The renderer only names a path; main writes there only if the user chose it, else asks with the Save dialog. */
export async function save(win: BrowserWindow, path: string | null, content: string): Promise<string | null> {
  const userData = app.getPath('userData');
  let target = path && (await allowedSave(path, chosen, userData));
  if (!path || !target) {
    path = await askSavePath(win, 'diagram', 'json');
    if (!path) return null;
    await choose(path);
    target = await allowedSave(path, chosen, userData);
    if (!target) throw new Error('Diagrams cannot be saved inside the Chalkline app data folder.');
  }
  await atomicWrite(target, content);
  app.addRecentDocument(path);
  return path;
}

/** Export to wherever the user picks, except the app data folder; written atomically. */
export async function saveExport(
  win: BrowserWindow,
  name: string,
  ext: string,
  content: string | Uint8Array,
): Promise<string | null> {
  const path = await askSavePath(win, name, ext);
  if (!path) return null;
  const target = await outsideAppData(path, app.getPath('userData'));
  if (!target) throw new Error('Exports cannot be saved inside the Chalkline app data folder.');
  await atomicWrite(target, content);
  return path;
}

let recoveryQueue: Promise<unknown> = Promise.resolve();
function queueRecovery<T>(run: () => Promise<T>): Promise<T> {
  const result = recoveryQueue.then(run);
  recoveryQueue = result.catch(() => {});
  return result;
}
export const writeRecovery = (content: string) =>
  queueRecovery(() => atomicWrite(userFile('recovery.json'), content));
export const readRecovery = () =>
  queueRecovery(() => readFile(userFile('recovery.json'), 'utf8').catch(() => null));
export const clearRecovery = () => queueRecovery(() => rm(userFile('recovery.json'), { force: true }));
