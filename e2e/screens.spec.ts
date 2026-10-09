import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch } from './launch';

// Opt-in: DG_SCREENS_DIR=<dir> writes the redesign's after-shots (same states as before/01–11).
const OUT = process.env.DG_SCREENS_DIR;
const DOC = {
  entities: [
    { tag: 'Icon', id: 'client', x: 40, y: 160, icon: 'user', texts: [{ text: 'Client' }] },
    { tag: 'Icon', id: 'api-gateway', x: 200, y: 160, icon: 'api-gateway', texts: [{ text: 'API Gateway' }] },
    {
      tag: 'Group',
      id: 'vpc',
      x: 340,
      y: 60,
      width: 420,
      height: 300,
      title: { text: 'VPC', icon: 'aws-vpc' },
    },
    {
      tag: 'Icon',
      id: 'lambda',
      x: 400,
      y: 160,
      icon: 'lambda',
      containerId: 'vpc',
      texts: [{ text: 'Lambda' }],
    },
    {
      tag: 'Icon',
      id: 'table',
      x: 620,
      y: 100,
      icon: 'aws-dynamodb',
      containerId: 'vpc',
      texts: [{ text: 'DynamoDB' }],
    },
    { tag: 'Icon', id: 'bucket', x: 620, y: 240, icon: 's3', containerId: 'vpc', texts: [{ text: 'S3' }] },
  ],
  connections: [
    { from: 'client', to: 'api-gateway' },
    { from: 'api-gateway', to: 'lambda' },
    { from: 'lambda', to: 'table' },
    { from: 'lambda', to: 'bucket' },
  ],
};

test('capture redesign screenshots', async () => {
  test.skip(!OUT, 'set DG_SCREENS_DIR to write screenshots');
  const dir = mkdtempSync(join(tmpdir(), 'dg-screens-'));
  // Real icons: seed the temp profile from the developer's icon cache, else fetch hosted ones.
  const cache = join(homedir(), 'Library', 'Application Support', 'diagrammer', 'icon-cache');
  const seeded = existsSync(cache);
  if (seeded) cpSync(cache, join(dir, 'icon-cache'), { recursive: true });
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ hostedIcons: !seeded }));
  const { app, page } = await launch({ DG_USER_DATA: dir, DG_LLM_BASE_URL: 'http://127.0.0.1:1/v1' });
  const shot = async (name: string) => {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(OUT!, `${name}.png`), scale: 'css' }); // 1x, like before/
  };
  try {
    mkdirSync(OUT!, { recursive: true });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900));
    await page.waitForFunction(() => (window as any).__dg);
    await shot('01-empty-dark');
    await page.evaluate((d) => (window as any).__dg.actions.loadText(JSON.stringify(d), null), DOC);
    await expect.poll(() => page.locator('.hit').count()).toBe(6);
    await shot('02-main-dark-diagram-ai-open');
    await page.locator('.hit[data-id="lambda"]').click();
    await shot('03-selection-inspector');
    await page.locator('.canvas').click({ position: { x: 5, y: 5 } });
    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('.canvas')).toHaveClass(/\blight\b/);
    await shot('04-main-light-diagram');
    await page.getByTestId('theme-toggle').click();
    await page.getByRole('tab', { name: 'Code', exact: true }).click();
    await shot('05-code-pane');
    await page.getByRole('tab', { name: 'Icons', exact: true }).click();
    await page.getByTestId('toggle-left').click();
    await page.getByTestId('toggle-right').click();
    await shot('06-panes-collapsed');
    await page.getByTestId('toggle-left').click();
    await page.getByTestId('toggle-right').click();
    await page.getByTestId('export-menu').click();
    await shot('07-export-menu');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByLabel('AI provider')).toBeVisible();
    await shot('08-settings');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByLabel('Diagram source').selectOption('folder');
    await shot('09-ai-code-folder');
    await page.getByLabel('Diagram source').selectOption('description');
    await page.locator('.palette-cell').first().hover();
    await shot('10-palette-hover');
    await page.evaluate(() => (window as any).__dg.ui.getState().set({ toast: 'Saved diagram.json' }));
    await shot('11-toast');
    await page.evaluate(() => (window as any).__dg.ui.getState().set({ toast: null }));
    // Light chrome is new in the redesign (decision D1).
    await page.getByTestId('theme-toggle').click();
    await page.locator('.hit[data-id="lambda"]').click();
    await shot('12-light-selection');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await shot('13-light-settings');
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
