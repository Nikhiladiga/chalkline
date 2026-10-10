import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dialog } from 'electron';
import { expect, it, vi } from 'vitest';
import { saveExport } from './files';

const dir = mkdtempSync(join(tmpdir(), 'dg-files-'));
const userData = join(dir, 'ud');
mkdirSync(userData);
vi.mock('electron', () => ({
  app: { getPath: () => userData, addRecentDocument: vi.fn() },
  dialog: { showSaveDialog: vi.fn() },
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
