import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch } from './launch';

test('window opens with the app title', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chalkline-branding-'));
  const { app, page } = await launch({ DG_USER_DATA: join(dir, 'diagrammer') });
  try {
    await expect(page.getByText('Chalkline', { exact: true }).first()).toBeVisible();
    await expect(page).toHaveTitle(/Chalkline$/);
    if (process.env.DG_HIDE_WINDOW !== '0') {
      expect(
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((w) => !w.isVisible())),
      ).toBe(true);
    }
    expect(await app.evaluate(({ app }) => app.getName())).toBe('Chalkline');
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toMatch(/[/\\]diagrammer$/);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
