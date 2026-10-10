import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dialog } from 'electron';
import { afterAll, expect, it, vi } from 'vitest';
import { openDialog, saveExport } from './files';
import { chosenKey } from './savePaths';

const dir = mkdtempSync(join(tmpdir(), 'dg-files-'));
const userData = join(dir, 'ud');
mkdirSync(userData);
afterAll(() => rmSync(dir, { recursive: true, force: true }));
vi.mock('electron', () => ({
  app: { getPath: () => userData, addRecentDocument: vi.fn() },
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() },
}));
const pick = (filePath: string) =>
  vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: false, filePath } as never);
const win = {} as never;

it('pre-fills the export dialog with a bare file name, never a renderer-supplied path', async () => {
  pick(join(dir, 'out.svg'));
  expect(await saveExport(win, '../../.zshrc', 'svg', '<svg/>')).toBe(join(dir, 'out.svg'));
  const [, options] = vi.mocked(dialog.showSaveDialog).mock.lastCall as unknown as [
    unknown,
    { defaultPath: string },
  ];
  expect(options.defaultPath).toBe('.zshrc.svg');
  expect(readFileSync(join(dir, 'out.svg'), 'utf8')).toBe('<svg/>');
});

it('refuses an export into the app data folder', async () => {
  pick(join(userData, 'settings.json'));
  await expect(saveExport(win, 'diagram', 'json', '{}')).rejects.toThrow('app data folder');
  expect(existsSync(join(userData, 'settings.json'))).toBe(false);
});

it.skipIf(process.platform === 'win32')('writes exports with normal, shareable permissions', async () => {
  pick(join(dir, 'shared.png'));
  await saveExport(win, 'diagram', 'png', new Uint8Array([1, 2, 3]));
  expect(statSync(join(dir, 'shared.png')).mode & 0o777).not.toBe(0o600);
});

it('keys an opened file by its real path, so a symlink and its target are one file', async () => {
  writeFileSync(join(dir, 'Orders.json'), '{}');
  symlinkSync(join(dir, 'Orders.json'), join(dir, 'alias.json'));
  const open = async (p: string) => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [p] } as never);
    return (await openDialog(win))?.key;
  };
  expect(await open(join(dir, 'alias.json'))).toBe(await open(join(dir, 'Orders.json')));
  expect(await open(join(dir, 'Orders.json'))).toBe(await chosenKey(join(dir, 'Orders.json')));
});
