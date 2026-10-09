import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import { launch } from './launch';

// Redesign behaviour. Every test runs in test mode, where all motion is 0 ms.
const DOC = {
  entities: [
    { tag: 'Shape', id: 'web', x: 40, y: 40, width: 140, height: 60, texts: [{ text: 'Web' }] },
    { tag: 'Shape', id: 'api', x: 300, y: 40, width: 140, height: 60, texts: [{ text: 'API' }] },
  ],
  connections: [{ from: 'web', to: 'api' }],
};
// biome-ignore lint/correctness/noUnusedVariables: used by later redesign tests
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
let app: ElectronApplication | undefined;
let dir: string | undefined;

test.afterEach(async () => {
  await app?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
  app = undefined;
  dir = undefined;
});

/** Launch with DOC loaded. `settings` seeds settings.json; `env` adds launch variables. */
async function open(settings: Record<string, unknown> = {}, env: Record<string, string> = {}): Promise<Page> {
  dir = mkdtempSync(join(tmpdir(), 'dg-ui-'));
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ hostedIcons: false, ...settings }));
  const launched = await launch({ DG_USER_DATA: dir, DG_LLM_BASE_URL: 'http://127.0.0.1:1/v1', ...env });
  app = launched.app;
  const page = launched.page;
  await page.waitForFunction(() => (window as any).__dg);
  await page.evaluate((d) => (window as any).__dg.actions.loadText(JSON.stringify(d), null), DOC);
  await expect.poll(() => page.locator('.hit').count()).toBe(2);
  return page;
}

test('the theme toggle themes the chrome and the diagram; test mode is on', async () => {
  const page = await open();
  const shell = page.locator('.app');
  await expect(shell).toHaveAttribute('data-theme', 'dark');
  await expect(shell).toHaveClass(/\btest-mode\b/);
  await page.getByTestId('theme-toggle').click();
  await expect(shell).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.canvas')).toHaveClass(/\blight\b/);
  expect(await shell.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(238, 240, 243)');
});

// Review Focus 4
test('a saved light theme opens with light chrome and a light board', async () => {
  const page = await open({ theme: 'light' });
  await expect(page.locator('.app')).toHaveAttribute('data-theme', 'light');
  await expect
    .poll(() => page.locator('.canvas').evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe('rgb(247, 248, 250)');
});

test('reduced motion and test mode zero every duration', async () => {
  const page = await open();
  const dur = () =>
    page.evaluate(() =>
      getComputedStyle(document.querySelector('.app')!).getPropertyValue('--dur-base').trim(),
    );
  expect(await dur()).toBe('0ms');
  await page.evaluate(() => document.querySelector('.app')!.classList.remove('test-mode'));
  expect(await dur()).toBe('200ms');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await dur()).toBe('0ms');
});

test('controls: disabled primary is solid, tabs slide, zoom resets to 100%', async () => {
  const page = await open();
  const run = page.getByTestId('ai-run');
  await expect(run).toBeDisabled();
  expect(await run.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  await page.getByRole('tab', { name: 'Code', exact: true }).click();
  await expect(page.locator('.editor-tabs')).toHaveAttribute('data-active', '1');
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Reset zoom to 100%' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__dg.ui.getState().zoom)).toBe(1);
});

test('Settings is a native modal: focus moves in, Escape closes it, focus returns', async () => {
  const page = await open();
  const button = page.getByRole('button', { name: 'Settings', exact: true });
  await button.click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('AI provider')).toBeFocused();
  expect(await dialog.evaluate((d) => d.matches('dialog:modal'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();
  expect(await page.evaluate(() => (window as any).__dg.ui.getState().settingsOpen)).toBe(false);
});

test('export menu: focus moves in, arrows rove and wrap, Escape returns focus', async () => {
  const page = await open();
  const trigger = page.getByTestId('export-menu');
  await trigger.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'Export' });
  await expect(menu).toBeVisible();
  await expect(page.getByTestId('export-png-2x')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'PNG (1x)' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Transparent background' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('export-png-2x')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Transparent background' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});

// Review Focus 5
test('a long file name keeps the unsaved dot visible', async () => {
  const page = await open();
  await page.evaluate(() =>
    (window as any).__dg.doc.setState({
      filePath: `/tmp/${'quarterly-architecture-review-'.repeat(8)}.json`,
      dirty: true,
    }),
  );
  const name = page.locator('.file-name');
  const dot = name.locator('.dirty-dot');
  await expect(dot).toBeVisible();
  await expect(name).toContainText('edited');
  const d = (await dot.boundingBox())!;
  const f = (await name.boundingBox())!;
  expect(d.x + d.width).toBeLessThanOrEqual(f.x + f.width + 0.5);
});
