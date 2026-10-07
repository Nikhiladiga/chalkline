import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, type BrowserWindow, dialog } from 'electron';
import type { OpenedFile } from '../shared/ipc';

const userFile = (name: string) => join(app.getPath('userData'), name);
const FILTERS = [{ name: 'Diagram', extensions: ['json'] }];

/** Write beside the destination, then atomically replace it; never truncate a user's last good file. */
async function atomicWrite(path: string, content: string): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, content, { flag: 'wx', mode: 0o600 });
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}

async function readRecent(): Promise<string[]> {
  try {
    return JSON.parse(await readFile(userFile('recent.json'), 'utf8'));
  } catch {
    return [];
  }
}

async function pushRecent(path: string): Promise<void> {
  const list = [path, ...(await readRecent()).filter((p) => p !== path)].slice(0, 10);
  await writeFile(userFile('recent.json'), JSON.stringify(list));
  app.addRecentDocument(path);
}

export const recent = readRecent;

export async function openPath(path: string): Promise<OpenedFile> {
  const content = await readFile(path, 'utf8');
  await pushRecent(path);
  return { path, content };
}

export async function openDialog(win: BrowserWindow): Promise<OpenedFile | null> {
  const r = await dialog.showOpenDialog(win, { filters: FILTERS, properties: ['openFile'] });
  return r.canceled || !r.filePaths[0] ? null : openPath(r.filePaths[0]);
}

/** Ask where to save (tests set DG_SAVE_DIR to skip the dialog). */
export async function askSavePath(win: BrowserWindow, name: string, ext: string): Promise<string | null> {
  if (process.env.DG_SAVE_DIR) return join(process.env.DG_SAVE_DIR, `${name}.${ext}`);
  const r = await dialog.showSaveDialog(win, {
    defaultPath: `${name}.${ext}`,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  return r.canceled || !r.filePath ? null : r.filePath;
}

export async function save(win: BrowserWindow, path: string | null, content: string): Promise<string | null> {
  const target = path ?? (await askSavePath(win, 'diagram', 'json'));
  if (!target) return null;
  await atomicWrite(target, content);
  // A recent-list failure must not turn an already successful save into a failed one.
  await pushRecent(target).catch(() => {});
  return target;
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
