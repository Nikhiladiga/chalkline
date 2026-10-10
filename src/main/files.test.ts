import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { chosenKey } from './savePaths';

const dir = mkdtempSync(join(tmpdir(), 'dg-files-'));
const userData = join(dir, 'ud');
mkdirSync(userData);
afterAll(() => rmSync(dir, { recursive: true, force: true }));
// Hoisted so the mocks survive `restart()` re-importing the module graph.
const dialog = vi.hoisted(() => ({ showSaveDialog: vi.fn(), showOpenDialog: vi.fn() }));
vi.mock('electron', () => ({ app: { getPath: () => userData, addRecentDocument: vi.fn() }, dialog }));
type Files = typeof import('./files');
let files: Files = await import('./files');
/** A fresh main process: module state gone, only userData on disk survives. */
const restart = async () => {
  vi.resetModules();
  files = await import('./files');
};
const pick = (filePath: string) => dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath });
const win = {} as never;
const file = (name: string, content = '{}') => {
  const p = join(dir, name);
  writeFileSync(p, content);
  return p;
};
const openViaDialog = async (path: string) => {
  dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] });
  return files.openDialog(win);
};

describe('saveExport', () => {
  it('pre-fills the export dialog with a bare file name, never a renderer-supplied path', async () => {
    pick(join(dir, 'out.svg'));
    expect(await files.saveExport(win, '../../.zshrc', 'svg', '<svg/>')).toBe(join(dir, 'out.svg'));
    const [, options] = dialog.showSaveDialog.mock.lastCall as unknown as [unknown, { defaultPath: string }];
    expect(options.defaultPath).toBe('.zshrc.svg');
    expect(readFileSync(join(dir, 'out.svg'), 'utf8')).toBe('<svg/>');
  });

  it('refuses an export into the app data folder', async () => {
    pick(join(userData, 'settings.json'));
    await expect(files.saveExport(win, 'diagram', 'json', '{}')).rejects.toThrow('app data folder');
    expect(existsSync(join(userData, 'settings.json'))).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('writes exports with normal, shareable permissions', async () => {
    pick(join(dir, 'shared.png'));
    await files.saveExport(win, 'diagram', 'png', new Uint8Array([1, 2, 3]));
    expect(statSync(join(dir, 'shared.png')).mode & 0o777).not.toBe(0o600);
  });
});

it('keys an opened file by its real path, so a symlink and its target are one file', async () => {
  file('Orders.json');
  symlinkSync(join(dir, 'Orders.json'), join(dir, 'alias.json'));
  const key = async (p: string) => (await openViaDialog(p))?.key;
  expect(await key(join(dir, 'alias.json'))).toBe(await key(join(dir, 'Orders.json')));
  expect(await key(join(dir, 'Orders.json'))).toBe(await chosenKey(join(dir, 'Orders.json')));
});

describe('reopen: only files chosen in an Open or Save dialog', () => {
  beforeEach(async () => {
    rmSync(join(userData, 'known-files.json'), { force: true });
    process.env.DG_SAVE_DIR = dir;
    await restart();
  });

  it('refuses an existing file that was never chosen', async () => {
    expect(await files.reopen(file('stranger.json', '{"x":1}'))).toBeNull();
  });

  it('reads a file chosen in the Open dialog, also after a restart', async () => {
    const p = file('opened.json', '{"a":1}');
    await openViaDialog(p);
    expect(await files.reopen(p)).toEqual({ path: p, content: '{"a":1}', key: await chosenKey(p) });
    await restart();
    expect((await files.reopen(p))?.content).toBe('{"a":1}');
  });

  it('remembers a Save-dialog target; a path the renderer sent goes to the dialog instead', async () => {
    const chosen = await files.save(win, null, '{"s":1}');
    expect(chosen).toEqual({
      path: join(dir, 'diagram.json'),
      key: await chosenKey(join(dir, 'diagram.json')),
    });
    expect((await files.reopen(chosen!.path))?.content).toBe('{"s":1}');
    const sent = file('sent.json', '{"untouched":1}');
    await restart();
    expect((await files.save(win, sent, '{"t":1}'))?.path).toBe(join(dir, 'diagram.json'));
    expect(readFileSync(sent, 'utf8')).toBe('{"untouched":1}');
    expect(await files.reopen(sent)).toBeNull();
  });

  it('saves silently only to files picked this session; a reopened file asks with the Save dialog', async () => {
    const p = file('restored.json', '{"r":1}');
    await openViaDialog(p);
    expect((await files.save(win, p, '{"r":2}'))?.path).toBe(p);
    await restart();
    expect((await files.reopen(p))?.content).toBe('{"r":2}');
    expect((await files.save(win, p, '{"r":3}'))?.path).toBe(join(dir, 'diagram.json'));
    expect(readFileSync(p, 'utf8')).toBe('{"r":2}');
    // The dialog's answer is a pick like any other: saving there again is silent.
    delete process.env.DG_SAVE_DIR;
    pick(p);
    expect((await files.save(win, p, '{"r":4}'))?.path).toBe(p);
    expect((await files.save(win, p, '{"r":5}'))?.path).toBe(p);
    expect(readFileSync(p, 'utf8')).toBe('{"r":5}');
  });

  it('refuses relative and remote-mount paths before touching the filesystem', async () => {
    const p = file('rel.json');
    await openViaDialog(p);
    expect(await files.reopen('rel.json')).toBeNull();
    expect(await files.reopen('/net/evil-host/x.json')).toBeNull();
    expect((await files.save(win, '/net/evil-host/x.json', '{}'))?.path).toBe(join(dir, 'diagram.json'));
  });

  it('never reopens, saves into or remembers the app data folder, even a file picked there', async () => {
    const settings = join(userData, 'settings.json');
    writeFileSync(settings, '{}');
    await openViaDialog(settings);
    expect(await files.reopen(settings)).toBeNull();
    expect((await files.save(win, join(userData, 'known-files.json'), '[]'))?.path).toBe(
      join(dir, 'diagram.json'),
    );
    delete process.env.DG_SAVE_DIR;
    pick(join(userData, 'recovery.json'));
    await expect(files.save(win, null, '{}')).rejects.toThrow('app data folder');
    const known = JSON.parse(readFileSync(join(userData, 'known-files.json'), 'utf8'));
    expect(known).toEqual([await chosenKey(join(dir, 'diagram.json'))]);
  });

  it('follows the file through a symlink until the link points elsewhere', async () => {
    const target = file('target.json', '{"t":1}');
    const other = file('other.json');
    const link = join(dir, 'link.json');
    symlinkSync(target, link);
    await openViaDialog(target);
    expect((await files.reopen(link))?.content).toBe('{"t":1}');
    unlinkSync(link);
    symlinkSync(other, link);
    expect(await files.reopen(link)).toBeNull();
  });

  it.runIf(process.platform === 'darwin')('accepts a different-case path to a known file', async () => {
    const p = file('Cased.json', '{"c":1}');
    await openViaDialog(p);
    expect((await files.reopen(join(dir, 'CASED.JSON')))?.content).toBe('{"c":1}');
  });

  it('is null for a known file that is gone', async () => {
    const p = file('soon-gone.json');
    await openViaDialog(p);
    rmSync(p);
    expect(await files.reopen(p)).toBeNull();
  });

  it('reads a corrupt known-files list as empty, and replaces it on the next pick', async () => {
    writeFileSync(join(userData, 'known-files.json'), '{"not": "a list"');
    await restart();
    const p = file('after-corrupt.json');
    expect(await files.reopen(p)).toBeNull();
    await openViaDialog(p);
    expect(JSON.parse(readFileSync(join(userData, 'known-files.json'), 'utf8'))).toEqual([
      await chosenKey(p),
    ]);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'retries an unreadable known-files list instead of replacing it with the next pick',
    async () => {
      const known = join(userData, 'known-files.json');
      const p = file('kept.json', '{"k":1}');
      await openViaDialog(p);
      await restart();
      chmodSync(known, 0);
      try {
        expect(await files.reopen(p)).toBeNull();
        await openViaDialog(file('while-locked.json'));
      } finally {
        chmodSync(known, 0o600);
      }
      expect((await files.reopen(p))?.content).toBe('{"k":1}');
      expect(JSON.parse(readFileSync(known, 'utf8'))).toContain(await chosenKey(p));
    },
  );

  it('keeps a pick made while a reopen is loading the list', async () => {
    writeFileSync(join(userData, 'known-files.json'), '[]');
    await restart();
    const p = file('raced.json');
    const reopening = files.reopen(file('raced-other.json'));
    await openViaDialog(p);
    await reopening;
    await openViaDialog(file('raced-later.json'));
    expect(JSON.parse(readFileSync(join(userData, 'known-files.json'), 'utf8'))).toContain(
      await chosenKey(p),
    );
  });

  it('keeps the 200 most recent picks, deduplicated, newest first', async () => {
    const paths = Array.from({ length: 201 }, (_, i) => file(`n${i}.json`));
    for (const p of paths) await openViaDialog(p);
    await openViaDialog(paths[1]!); // re-picking moves it to the front
    const list = JSON.parse(readFileSync(join(userData, 'known-files.json'), 'utf8'));
    expect(list).toHaveLength(200);
    expect(list[0]).toBe(await chosenKey(paths[1]!));
    expect(await files.reopen(paths[0]!)).toBeNull();
    expect(await files.reopen(paths[2]!)).not.toBeNull();
  });
});
