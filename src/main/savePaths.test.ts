import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allowedSave, chosenKey } from './savePaths';

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
