import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
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

/** Mock OpenAI-compatible LLM that answers after 1.5 s, so a run is still going when the test acts. */
async function slowLlm(): Promise<{ url: string; close: () => void }> {
  const server = createServer((req, res) => {
    if (req.url?.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'mock' }] }));
    req.resume();
    req.on('end', () => {
      const text = JSON.stringify({
        ...DOC,
        entities: [...DOC.entities, { tag: 'Shape', id: 'db', x: 560, y: 40, texts: [{ text: 'DB' }] }],
      });
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`);
      }, 1500);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    close: () => server.close(),
  };
}

test('collapsing and expanding the left pane keeps the diagram still', async () => {
  const page = await open();
  const hit = page.locator('.hit[data-id="web"]');
  const x0 = (await hit.boundingBox())!.x;
  await page.getByTestId('toggle-left').click();
  await expect(page.locator('.pane.left .pane-body:visible')).toHaveCount(0);
  await expect.poll(async () => Math.abs((await hit.boundingBox())!.x - x0)).toBeLessThan(1);
  await page.getByTestId('toggle-left').click();
  await expect(page.locator('.pane.left .pane-body:visible')).toHaveCount(1);
  await expect.poll(async () => Math.abs((await hit.boundingBox())!.x - x0)).toBeLessThan(1);
});

test('collapsing the details pane keeps the AI prompt', async () => {
  const page = await open();
  await page.getByTestId('ai-prompt').fill('keep this prompt');
  await page.getByTestId('toggle-right').click();
  await expect(page.getByTestId('ai-prompt')).toBeHidden();
  await page.getByTestId('toggle-right').click();
  await expect(page.getByTestId('ai-prompt')).toHaveValue('keep this prompt');
});

test('selecting an element leaves the AI composer where it was', async () => {
  const page = await open();
  const prompt = page.getByTestId('ai-prompt');
  const y0 = (await prompt.boundingBox())!.y;
  await page.locator('.hit[data-id="api"]').click();
  await expect(page.getByTestId('inspector')).toBeVisible();
  const box = (await prompt.boundingBox())!;
  expect(Math.abs(box.y - y0)).toBeLessThan(1);
  expect(box.y + box.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight));
});

// Review Focus 3
test('at 900×600 Generate stays visible with an element selected', async () => {
  const page = await open();
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(900, 600));
  await expect.poll(() => page.evaluate(() => innerHeight)).toBe(600);
  await page.evaluate(() =>
    (window as any).__dg.doc.getState().select({ entities: ['api'], connections: [] }),
  );
  await expect(page.getByTestId('inspector')).toBeVisible();
  const run = page.getByTestId('ai-run');
  await expect(run).toBeVisible();
  const inside = await run.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const c = el.closest('.composer')!.getBoundingClientRect();
    return r.top >= c.top && r.bottom <= c.bottom && r.bottom <= innerHeight;
  });
  expect(inside).toBe(true);
});

// Review Focus 2
test('an AI run survives collapsing the details pane', async () => {
  const llm = await slowLlm();
  try {
    const page = await open({}, { DG_LLM_BASE_URL: llm.url, DG_LLM_MODEL: 'mock' });
    await page.getByTestId('ai-prompt').fill('add a database');
    await page.getByTestId('ai-run').click();
    const stopButton = page.getByRole('button', { name: 'Stop', exact: true });
    await expect(stopButton).toBeVisible();
    await page.getByTestId('toggle-right').click();
    await page.getByTestId('toggle-right').click();
    await expect(stopButton).toBeVisible();
    await expect(page.getByTestId('ai-outcome')).toContainText('Diagram updated', { timeout: 15_000 });
    const ids = await page.evaluate(() =>
      (window as any).__dg.doc.getState().doc.entities.map((e: any) => e.id),
    );
    expect(ids).toContain('db');
  } finally {
    llm.close();
  }
});
