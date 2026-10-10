import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { app, type BrowserWindow, dialog } from 'electron';
import type { OpenedFile } from '../shared/ipc';
import { allowedSave, chosenKey, outsideAppData } from './savePaths';

const userFile = (name: string) => join(app.getPath('userData'), name);
const FILTERS = [{ name: 'Diagram', extensions: ['json'] }];

/** Write beside the destination, then atomically replace it; never truncate a user's last good file. */
async function atomicWrite(path: string, content: string | Uint8Array, mode = 0o600): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, content, { flag: 'wx', mode });
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}

/**
 * Documents the user picked in a native Open/Save dialog this session, or that `reopen` restored this
 * session: the only paths `file:save` may overwrite silently.
 */
const chosen = new Set<string>();

/**
 * `known-files.json`: keys of files the user picked in a native Open or Save dialog, most recent first.
 * Only main writes it, from dialog picks, never with a path the renderer sent, so crash recovery may re-read these.
 */
const KNOWN_MAX = 200;
let knownP: Promise<string[]> | undefined;
let knownQueue: Promise<unknown> = Promise.resolve();

// One shared load: a reopen reading the file can never overwrite a list `choose` just extended.
const loadKnown = () =>
  (knownP ??= readFile(userFile('known-files.json'), 'utf8')
    .then((text) => {
      const v = JSON.parse(text);
      return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : [];
    })
    .catch(() => []));

/** Record a dialog-chosen path: allowed to save silently now, and to reopen after a crash. */
async function choose(path: string): Promise<void> {
  const key = await chosenKey(path);
  chosen.add(key);
  // Never rejects: a bookkeeping failure must not fail an open or save.
  knownQueue = knownQueue
    .then(async () => {
      // ponytail: LRU cap; a stale key only re-allows reopening a file the user once chose in a dialog.
      const list = [key, ...(await loadKnown()).filter((k) => k !== key)].slice(0, KNOWN_MAX);
      knownP = Promise.resolve(list);
      await atomicWrite(userFile('known-files.json'), JSON.stringify(list));
    })
    .catch(() => {});
  await knownQueue;
}

/**
 * Crash recovery: re-read a file, but only one the user picked in an Open/Save dialog and never one in the
 * app data folder; else null. A reopened file may then be saved silently, like a dialog pick.
 */
export async function reopen(path: string): Promise<OpenedFile | null> {
  await knownQueue;
  const real = await outsideAppData(path, app.getPath('userData'));
  const key = real && (await chosenKey(real).catch(() => null));
  if (!real || !key || !(await loadKnown()).includes(key)) return null;
  const content = await readFile(real, 'utf8').catch(() => null);
  if (content === null) return null;
  chosen.add(key);
  return { path, content, key };
}

async function openPath(path: string): Promise<OpenedFile> {
  const content = await readFile(path, 'utf8');
  app.addRecentDocument(path);
  return { path, content, key: await chosenKey(path) };
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
  // Exports are meant to be shared: normal permissions (0o666 less the umask), unlike diagrams.
  await atomicWrite(target, content, 0o666);
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
