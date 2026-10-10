import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';

// macOS and Windows filesystems ignore case by default, so `A.json` and `a.json` are one file.
const fold = (p: string) =>
  process.platform === 'darwin' || process.platform === 'win32' ? p.toLowerCase() : p;

/** Where a write to `path` really lands: symlinks resolved, also for a file that does not exist yet. */
async function realTarget(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return join(await realpath(dirname(path)), basename(path));
  }
}

/** Allow-set key for a path the user picked in a native Open/Save dialog. */
export const chosenKey = async (path: string) => fold(await realTarget(path));

/**
 * The real file to write for a save to `path`, or null when the user never chose it in a dialog
 * or it lies inside the app's own data folder (settings, recovery, icon cache).
 */
export async function allowedSave(
  path: string,
  chosen: ReadonlySet<string>,
  userData: string,
): Promise<string | null> {
  const real = await realTarget(path).catch(() => null);
  if (!real || !chosen.has(fold(real))) return null;
  const rel = relative(fold(await realTarget(userData).catch(() => userData)), fold(real));
  const insideUserData = rel === '' || (rel.split(sep)[0] !== '..' && !isAbsolute(rel));
  return insideUserData ? null : real;
}
