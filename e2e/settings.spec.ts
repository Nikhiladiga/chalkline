import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import { launch } from './launch';

// Settings provider picker. Test mode: all motion is 0 ms.
let app: ElectronApplication | undefined;
let dir: string | undefined;

test.afterEach(async () => {
  await app?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
  app = undefined;
  dir = undefined;
});

/** Opens Settings from a seeded settings.json; no DG_LLM_BASE_URL, so stored providers are kept. */
async function openSettings(settings: Record<string, unknown>, size?: [number, number]): Promise<Page> {
  dir = mkdtempSync(join(tmpdir(), 'dg-settings-'));
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ hostedIcons: false, ...settings }));
  const launched = await launch({ DG_USER_DATA: dir });
  app = launched.app;
  const page = launched.page;
  if (size)
    await app.evaluate(
      ({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]!.setContentSize(w, h),
      size,
    );
  await page.waitForFunction(() => (window as any).__dg);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  return page;
}

const kind = (page: Page, name: string) =>
  page.getByRole('radiogroup', { name: 'AI provider' }).getByRole('radio', { name, exact: true });
const harness = (page: Page, name: string) =>
  page.getByRole('radiogroup', { name: 'Harness' }).getByRole('radio', { name, exact: true });
const preset = (page: Page, name: string) =>
  page.getByRole('radiogroup', { name: 'Server preset' }).getByRole('radio', { name, exact: true });

test('the Settings dialog keeps one outer size across provider kind, harness and preset', async () => {
  const page = await openSettings({ provider: 'claude-code' }, [900, 600]);
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  const height = async () => (await dialog.boundingBox())!.height;
  const first = await height();
  const heights: number[] = [];
  await harness(page, 'Codex CLI').click();
  heights.push(await height());
  await harness(page, 'Claude Code CLI').click();
  heights.push(await height());
  await kind(page, 'API').click();
  heights.push(await height());
  for (const name of ['LM Studio', 'Ollama', 'OpenAI', 'Custom']) {
    await preset(page, name).click();
    await expect(preset(page, name)).toHaveAttribute('aria-checked', 'true');
    heights.push(await height());
  }
  await kind(page, 'Installed CLI').click();
  heights.push(await height());
  for (const h of heights) expect(Math.abs(h - first)).toBeLessThanOrEqual(1);
  // Header and footer stay put; only the middle scrolls.
  await expect(page.getByRole('button', { name: 'Save settings' })).toBeInViewport();
});

test('at 1440×900 the dialog keeps its 640 px height and sits inside the themed .app shell', async () => {
  const page = await openSettings({ provider: 'claude-code' }, [1440, 900]);
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  // Inside .app, so the chrome tokens and the themed :focus-visible ring apply.
  expect(await dialog.evaluate((d) => d.closest('.app') !== null)).toBe(true);
  const height = async () => (await dialog.boundingBox())!.height;
  expect(Math.abs((await height()) - 640)).toBeLessThanOrEqual(1);
  await harness(page, 'Codex CLI').click();
  expect(Math.abs((await height()) - 640)).toBeLessThanOrEqual(1);
  await kind(page, 'API').click();
  for (const name of ['LM Studio', 'Ollama', 'OpenAI', 'Custom']) {
    await preset(page, name).click();
    expect(Math.abs((await height()) - 640)).toBeLessThanOrEqual(1);
  }
  await kind(page, 'Installed CLI').click();
  expect(Math.abs((await height()) - 640)).toBeLessThanOrEqual(1);
});

test('harness cards are a radiogroup driven by arrow keys', async () => {
  const page = await openSettings({ provider: 'claude-code' });
  const claude = harness(page, 'Claude Code CLI');
  const codex = harness(page, 'Codex CLI');
  await expect(claude).toHaveAttribute('aria-checked', 'true');
  await expect(codex).toHaveAttribute('aria-checked', 'false');
  await expect(codex).toHaveAttribute('tabindex', '-1');
  await claude.focus();
  await page.keyboard.press('ArrowRight');
  await expect(codex).toBeFocused();
  await expect(codex).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('Codex CLI path')).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(claude).toBeFocused();
  await expect(claude).toHaveAttribute('aria-checked', 'true');
  // Each card says whether the CLI was found.
  await expect(page.locator('[role="radio"] .harness-status')).toHaveCount(2);
});

test('presets fill the base URL and a hand-edited URL selects Custom', async () => {
  const page = await openSettings({ provider: 'claude-code' });
  await kind(page, 'API').click();
  const url = page.getByLabel('Base URL');
  await preset(page, 'Ollama').click();
  await expect(url).toHaveValue('http://127.0.0.1:11434/v1');
  await preset(page, 'OpenAI').click();
  await expect(url).toHaveValue('https://api.openai.com/v1');
  await preset(page, 'LM Studio').click();
  await expect(url).toHaveValue('http://127.0.0.1:1234/v1');
  await expect(page.getByLabel(/^API key/)).toBeVisible();
  await url.fill('http://192.168.1.20:8080/v1');
  await expect(preset(page, 'Custom')).toHaveAttribute('aria-checked', 'true');
  await expect(preset(page, 'LM Studio')).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('button', { name: 'Save settings' }).click();
  const saved = await page.evaluate(() => window.api.invoke('settings:get'));
  expect(saved).toMatchObject({ provider: 'openai', baseUrl: 'http://192.168.1.20:8080/v1' });
});

test('an old LM Studio settings file opens as API with the LM Studio preset', async () => {
  const page = await openSettings({
    provider: 'lmstudio',
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: 'qwen3',
  });
  await expect(kind(page, 'API')).toHaveAttribute('aria-checked', 'true');
  await expect(preset(page, 'LM Studio')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('Base URL')).toHaveValue('http://127.0.0.1:1234/v1');
  await expect(page.getByRole('dialog').getByLabel('Model', { exact: true })).toHaveValue('qwen3');
});
