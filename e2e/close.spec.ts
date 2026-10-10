import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

test('a window with unsaved changes closes after choosing "Discard changes"', async () => {
  const userData = join(mkdtempSync(join(tmpdir(), 'dg-close-')), 'ud');
  const env = {
    ...process.env,
    DG_USER_DATA: userData,
    DG_HIDE_WINDOW: process.env.DG_HIDE_WINDOW ?? '1',
  } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.DG_TEST; // real close guards, not test mode
  const app = await electron.launch({ args: ['.'], env });
  const page = await app.firstWindow();
  // Type a one-shape diagram into the code pane.
  await page.getByRole('tab', { name: 'Code', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText('{"entities":[{"tag":"Shape","id":"a","x":0,"y":0}],"connections":[]}');
  await expect(
    page.getByRole('tablist', { name: 'Open diagrams' }).getByRole('tab', { selected: true }),
  ).toContainText('edited');
  await expect.poll(() => existsSync(join(userData, 'recovery.json'))).toBe(true);
  await page.waitForTimeout(300); // let app:dirty reach main
  await app.evaluate(({ dialog, BrowserWindow }) => {
    (dialog as any).showMessageBoxSync = () => 0; // "Discard changes"
    BrowserWindow.getAllWindows()[0]!.close();
  });
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), { timeout: 5000 })
    .toBe(0);
  expect(existsSync(join(userData, 'recovery.json'))).toBe(false);
  await app.close();
});
