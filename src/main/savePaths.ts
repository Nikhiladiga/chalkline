import { lstatSync, readlinkSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, posix, relative, sep, win32 } from 'node:path';

/**
 * Whether main may hand a renderer-supplied path to the filesystem at all. Checked before any realpath:
 * merely resolving a UNC/device path on Windows opens an SMB connection (leaking NTLM hashes) or a device,
 * and resolving `/net/<host>` on macOS makes autofs mount a remote host.
 */
export function isSafePath(path: string, platform: NodeJS.Platform = process.platform): boolean {
  const p = platform === 'win32' ? win32 : posix;
  if (!p.isAbsolute(path)) return false;
  const norm = p.normalize(path);
  if (platform === 'win32')
    // `?` is never in a file name, only in `\\?\` and `\??\` NT prefixes; device names stay devices
    // with an extension, trailing spaces or a colon (`NUL.json`, `CON :`).
    return (
      ![path, norm].some((x) => /^[\\/]{2}/.test(x) || x.includes('?')) &&
      !norm
        .split(/[\\/]/)
        .some((seg) => /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$) *([.:].*)?$/i.test(seg))
    );
  // macOS paths are case-insensitive by default, so /NET is /net. The Data volume is the same tree again.
  return platform !== 'darwin' || !/^(\/system\/volumes\/data)?\/(net|network|home)(\/|$)/i.test(norm);
}

/**
 * Like realpath, but every symlink target is checked with `isSafePath` before it is followed, so a local
 * link (`/Volumes/Macintosh HD` → `/`) cannot lead into `/net`. Null when unsafe; a missing part ends the walk.
 */
export function safeRealpath(path: string, platform: NodeJS.Platform = process.platform): string | null {
  const p = platform === 'win32' ? win32 : posix;
  let todo = path;
  for (let hops = 0; hops < 40; hops++) {
    if (!isSafePath(todo, platform)) return null;
    todo = p.normalize(todo);
    const { root } = p.parse(todo);
    const parts = todo.slice(root.length).split(/[\\/]/).filter(Boolean);
    let cur = root;
    let next: string | null = null;
    for (const [i, part] of parts.entries()) {
      cur = p.join(cur, part);
      const st = lstatSync(cur, { throwIfNoEntry: false });
      if (!st) return todo;
      if (st.isSymbolicLink()) {
        next = p.resolve(p.dirname(cur), readlinkSync(cur), ...parts.slice(i + 1));
        break;
      }
    }
    if (next === null) return todo;
    todo = next;
  }
  return null;
}

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

/** The real file a write to `path` lands on, or null if that is inside the app's own data folder. */
export async function outsideAppData(path: string, userData: string): Promise<string | null> {
  const real = await realTarget(path).catch(() => null);
  if (!real) return null;
  const rel = relative(fold(await realTarget(userData).catch(() => userData)), fold(real));
  return rel === '' || (rel.split(sep)[0] !== '..' && !isAbsolute(rel)) ? null : real;
}

/**
 * The real file to write for a save to `path`, or null when the user never chose it in a dialog
 * or it lies inside the app's own data folder (settings, recovery, icon cache).
 */
export async function allowedSave(
  path: string,
  chosen: ReadonlySet<string>,
  userData: string,
): Promise<string | null> {
  const real = await outsideAppData(path, userData);
  return real && chosen.has(fold(real)) ? real : null;
}
