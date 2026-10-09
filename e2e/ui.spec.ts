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
