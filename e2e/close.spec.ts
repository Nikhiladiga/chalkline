import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { launch } from './launch';

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

const CODE = '{"entities":[{"tag":"Shape","id":"a","x":0,"y":0}],"connections":[]}';

async function realGuardApp(prefix: string) {
  const userData = join(mkdtempSync(join(tmpdir(), prefix)), 'ud');
  const env = { ...process.env, DG_USER_DATA: userData } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.DG_TEST; // real close guards, not test mode
  const app = await electron.launch({ args: ['.'], env });
  return { app, page: await app.firstWindow(), userData };
}

const windows = (app: Awaited<ReturnType<typeof electron.launch>>) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);

test('a dirty tab in the background still stops the window from closing', async () => {
  const { app, page, userData } = await realGuardApp('dg-close-bg-');
  const active = page.getByRole('tablist', { name: 'Open diagrams' }).getByRole('tab', { selected: true });
  await page.getByRole('tab', { name: 'Code', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText(CODE);
  await expect(active).toContainText('edited');
  await expect(page).toHaveTitle('Untitled (edited) — Chalkline');
  await page.getByRole('button', { name: 'New tab' }).click();
  await expect(active).not.toContainText('edited');
  await expect(page).toHaveTitle('Untitled 2 — Chalkline');
  await page.waitForTimeout(300); // let app:dirty reach main
  const asked = await app.evaluate(({ dialog, BrowserWindow }) => {
    let n = 0;
    (dialog as any).showMessageBoxSync = () => {
      n++;
      return 1; // "Cancel"
    };
    BrowserWindow.getAllWindows()[0]!.close();
    return n;
  });
  expect(asked).toBe(1);
  expect(await windows(app)).toBe(1);
  await expect(page.getByRole('tablist', { name: 'Open diagrams' }).getByRole('tab')).toHaveCount(2);
  await page.getByRole('tablist', { name: 'Open diagrams' }).getByRole('tab').first().click();
  await expect(page).toHaveTitle('Untitled (edited) — Chalkline');
  await app.evaluate(({ dialog, BrowserWindow }) => {
    (dialog as any).showMessageBoxSync = () => 0; // "Discard changes"
    BrowserWindow.getAllWindows()[0]!.close();
  });
  await expect.poll(() => windows(app), { timeout: 5000 }).toBe(0);
  expect(existsSync(join(userData, 'recovery.json'))).toBe(false);
  await app.close();
});

test('Close Window (macOS, Cmd+Shift+W) is the native close role, so it reaches the same guard', async () => {
  test.skip(process.platform !== 'darwin', 'Close Window menu item is macOS only');
  // A role item runs the native performClose:, which JS cannot invoke; it fires the BrowserWindow
  // 'close' event that the guard test above already exercises.
  const { app } = await launch();
  const item = await app.evaluate(({ Menu }) => {
    const m = Menu.getApplicationMenu()!.getMenuItemById('close-window')!;
    return { role: m.role, accelerator: m.accelerator };
  });
  expect(item).toEqual({ role: 'close', accelerator: 'CmdOrCtrl+Shift+W' });
  await app.close();
});

test('a background tab with a running AI run also asks before the window closes', async () => {
  const { app, page } = await launch();
  await page.evaluate(() => {
    const dg = (window as any).__dg;
    dg.actions.newTab();
    dg.tabs.setState((s: any) => ({ tabs: s.tabs.map((t: any, i: number) => ({ ...t, busy: i === 0 })) }));
  });
  await page.waitForTimeout(300);
  const asked = await app.evaluate(({ dialog, BrowserWindow }) => {
    delete process.env.DG_TEST; // arm the real guard
    let n = 0;
    (dialog as any).showMessageBoxSync = () => {
      n++;
      return 1;
    };
    BrowserWindow.getAllWindows()[0]!.close();
    return n;
  });
  expect(asked).toBe(1);
  expect(await windows(app)).toBe(1);
  await app.evaluate(({ dialog, BrowserWindow }) => {
    (dialog as any).showMessageBoxSync = () => 0;
    BrowserWindow.getAllWindows()[0]!.close();
  });
  await expect.poll(() => windows(app), { timeout: 5000 }).toBe(0);
  await app.close();
});
