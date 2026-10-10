import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allowedSave, chosenKey, isSafePath, safeRealpath } from './savePaths';

// tmpdir() is itself a symlink on macOS (/var → /private/var), which the checks must see through.
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'dg-save-paths-'));
  const userData = join(dir, 'ud');
  mkdirSync(userData);
  const file = join(dir, 'picked.json');
  writeFileSync(file, '{}');
  return { dir, userData, file };
}

describe('allowedSave', () => {
  it('allows a dialog-chosen file and returns its real path', async () => {
    const { userData, file } = setup();
    const chosen = new Set([await chosenKey(file)]);
    expect(await allowedSave(file, chosen, userData)).toBe(realpathSync(file));
  });

  it('allows a chosen file that does not exist yet (Save As to a new name)', async () => {
    const { dir, userData } = setup();
    const fresh = join(dir, 'new.json');
    expect(await allowedSave(fresh, new Set([await chosenKey(fresh)]), userData)).toBe(
      join(realpathSync(dir), 'new.json'),
    );
  });

  it('refuses a path the user never chose', async () => {
    const { dir, userData, file } = setup();
    const chosen = new Set([await chosenKey(file)]);
    expect(await allowedSave(join(dir, 'other.json'), chosen, userData)).toBeNull();
    expect(await allowedSave(join(dir, 'missing', 'x.json'), chosen, userData)).toBeNull();
    expect(await allowedSave(file, new Set(), userData)).toBeNull();
  });

  it('allows a symlink to a chosen file, writing through to the real file', async () => {
    const { dir, userData, file } = setup();
    const link = join(dir, 'link.json');
    symlinkSync(file, link);
    const chosen = new Set([await chosenKey(file)]);
    expect(await allowedSave(link, chosen, userData)).toBe(realpathSync(file));
  });

  it('refuses a symlink chosen by name that now points somewhere else', async () => {
    const { dir, userData, file } = setup();
    const link = join(dir, 'link.json');
    symlinkSync(file, link);
    const chosen = new Set([await chosenKey(join(dir, 'elsewhere.json'))]);
    expect(await allowedSave(link, chosen, userData)).toBeNull();
  });

  it.skipIf(process.platform === 'linux')(
    'treats case variants as the same file on macOS/Windows',
    async () => {
      const { dir, userData, file } = setup();
      const chosen = new Set([await chosenKey(file)]);
      expect(await allowedSave(join(dir, 'PICKED.JSON'), chosen, userData)).not.toBeNull();
    },
  );

  it('refuses anything in the app data folder, even if chosen', async () => {
    const { userData } = setup();
    for (const target of [join(userData, 'settings.json'), join(userData, 'icons', 'x.svg'), userData]) {
      writeFileSync(join(userData, 'settings.json'), '{}');
      mkdirSync(join(userData, 'icons'), { recursive: true });
      expect(await allowedSave(target, new Set([await chosenKey(target)]), userData)).toBeNull();
    }
    const upper = join(userData.toUpperCase(), 'settings.json');
    if (process.platform !== 'linux')
      expect(await allowedSave(upper, new Set([await chosenKey(upper)]), userData)).toBeNull();
  });
});

describe('isSafePath', () => {
  it('needs an absolute path on every platform', () => {
    for (const platform of ['darwin', 'linux', 'win32'] as const) {
      expect(isSafePath('diagram.json', platform)).toBe(false);
      expect(isSafePath('../x.json', platform)).toBe(false);
    }
    expect(isSafePath('/Users/me/d.json', 'darwin')).toBe(true);
    expect(isSafePath('C:\\Users\\me\\d.json', 'win32')).toBe(true);
    expect(isSafePath('C:relative.json', 'win32')).toBe(false);
  });

  it('refuses UNC, NT-prefixed and device paths on Windows', () => {
    for (const p of [
      '\\\\host\\share\\d.json',
      '//host/share/d.json',
      '\\/host/share/d.json',
      '\\\\.\\pipe\\x',
      '\\\\?\\C:\\d.json',
      '\\??\\C:\\d.json',
      'C:\\NUL',
      'C:\\dir\\con.json',
      'C:\\Com1.txt',
      'C:\\lpt9',
      'C:\\aux :',
    ])
      expect(isSafePath(p, 'win32'), p).toBe(false);
    expect(isSafePath('C:\\console.json', 'win32')).toBe(true);
    expect(isSafePath('C:\\com10.json', 'win32')).toBe(true);
  });

  it('refuses autofs network mounts on macOS, also via .. and any case', () => {
    for (const p of [
      '/net/host/d.json',
      '/Network/Servers/x',
      '/NET/host',
      '/tmp/../net/host/x',
      '/net',
      '/System/Volumes/Data/net/host/x',
      '/home/x',
    ])
      expect(isSafePath(p, 'darwin'), p).toBe(false);
    expect(isSafePath('/Users/me/net/d.json', 'darwin')).toBe(true);
    expect(isSafePath('/network-notes.json', 'darwin')).toBe(true);
    expect(isSafePath('/net/host/d.json', 'linux')).toBe(true);
  });
});

describe('safeRealpath', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'safe-real-')));
  mkdirSync(join(root, 'real'));
  symlinkSync(join(root, 'real'), join(root, 'good'));
  symlinkSync('/net/evil-host', join(root, 'evil'));
  symlinkSync(join(root, 'loop'), join(root, 'loop'));

  it('follows local links and stops at a missing part', () => {
    expect(safeRealpath(join(root, 'good', 'claude'), 'darwin')).toBe(join(root, 'real', 'claude'));
    expect(safeRealpath(join(root, 'nope', 'x'), 'darwin')).toBe(join(root, 'nope', 'x'));
  });

  it('refuses a link into /net before following it, and link loops', () => {
    expect(safeRealpath(join(root, 'evil', 'claude'), 'darwin')).toBeNull();
    expect(safeRealpath(join(root, 'loop', 'x'), 'darwin')).toBeNull();
    expect(safeRealpath('bin/claude', 'darwin')).toBeNull();
  });
});
