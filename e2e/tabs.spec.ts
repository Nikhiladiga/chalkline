import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import { launch } from './launch';

// Multi-tab behaviour. Every test runs in test mode, where all motion is 0 ms.
const DOC = {
  entities: [
    { tag: 'Shape', id: 'web', x: 40, y: 40, width: 140, height: 60, texts: [{ text: 'Web' }] },
    { tag: 'Shape', id: 'api', x: 300, y: 40, width: 140, height: 60, texts: [{ text: 'API' }] },
  ],
  connections: [{ from: 'web', to: 'api' }],
};
const SOLO = {
  entities: [{ tag: 'Shape', id: 'solo', x: 40, y: 40, width: 140, height: 60, texts: [{ text: 'Solo' }] }],
  connections: [],
};
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
let app: ElectronApplication | undefined;
let dir: string | undefined;

test.afterEach(async () => {
  await app?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
  app = undefined;
  dir = undefined;
});

async function open(env: Record<string, string> = {}): Promise<Page> {
  dir = mkdtempSync(join(tmpdir(), 'dg-tabs-'));
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ hostedIcons: false }));
  const launched = await launch({ DG_USER_DATA: dir, DG_LLM_BASE_URL: 'http://127.0.0.1:1/v1', ...env });
  app = launched.app;
  const page = launched.page;
  await page.waitForFunction(() => (window as any).__dg);
  return page;
}

const strip = (page: Page) => page.getByRole('tablist', { name: 'Open diagrams' });
const tabs = (page: Page) => strip(page).getByRole('tab');
const activeTab = (page: Page) => strip(page).getByRole('tab', { selected: true });
const newTabButton = (page: Page) => page.getByRole('button', { name: 'New tab' });
/** Load a document into the tab on screen, like Open would. */
const load = (page: Page, doc: unknown, path: string | null = null) =>
  page.evaluate(({ d, p }) => (window as any).__dg.actions.loadText(JSON.stringify(d), p), {
    d: doc,
    p: path,
  });
const docIn = (page: Page, i: number) =>
  page.evaluate((n) => (window as any).__dg.tabs.getState().tabs[n].doc, i);
const ids = (doc: any): string[] => doc.entities.map((e: any) => e.id);
const closeAt = async (page: Page, i: number) => {
  await page.locator('.doc-tab').nth(i).hover();
  await page.locator('.doc-tab').nth(i).locator('.tab-close').click();
};

test('the strip shows each document as a tab titled by its file name', async () => {
  const page = await open();
  await expect(tabs(page)).toHaveText(['Untitled']);
  await load(page, DOC, '/tmp/Payments Flow.json');
  await expect(activeTab(page)).toHaveText('Payments Flow');
  await expect(activeTab(page)).toHaveAttribute('title', '/tmp/Payments Flow.json');
  await newTabButton(page).click();
  await expect(tabs(page)).toHaveText(['Payments Flow', 'Untitled']);
  await expect(activeTab(page)).toHaveText('Untitled');
  // The active tab carries the lavender --line bar.
  expect(
    await page.locator('.doc-tab[data-active]').evaluate((el) => getComputedStyle(el).boxShadow),
  ).toContain('rgb(117, 129, 238)');
  await page.evaluate((d) => (window as any).__dg.doc.getState().commit(d), SOLO);
  await expect(activeTab(page)).toContainText('edited');
  await expect(activeTab(page).locator('.dirty-dot')).toBeVisible();
  if (process.platform === 'darwin') {
    // The traffic lights keep their inset.
    expect((await tabs(page).first().boundingBox())!.x).toBeGreaterThanOrEqual(84);
  }
});

test('each tab keeps its own diagram, history, selection and view', async () => {
  const page = await open();
  await load(page, DOC);
  await expect(page.locator('.hit')).toHaveCount(2);
  await page.locator('.hit[data-id="api"]').click();
  await expect(page.getByTestId('inspector')).toContainText('api');
  await page.evaluate(() => (window as any).__dg.ui.getState().set({ zoom: 0.5, pan: { x: 10, y: 20 } }));
  await newTabButton(page).click();
  await expect(page.locator('.hit')).toHaveCount(0);
  await expect(page.getByText('Select an element to edit it.')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__dg.ui.getState().zoom)).toBe(1);
  await load(page, SOLO);
  await expect(page.locator('.hit')).toHaveCount(1);
  await page.locator('.hit[data-id="solo"]').click();
  await page.keyboard.press('Delete');
  await expect(page.locator('.hit')).toHaveCount(0);
  await page.locator('.canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(`${mod}+z`);
  await expect(page.locator('.hit')).toHaveCount(1);
  await tabs(page).first().click();
  await expect(page.locator('.hit')).toHaveCount(2);
  await expect(page.getByTestId('inspector')).toContainText('api');
  expect(
    await page.evaluate(() => {
      const u = (window as any).__dg.ui.getState();
      return { zoom: u.zoom, pan: u.pan };
    }),
  ).toEqual({ zoom: 0.5, pan: { x: 10, y: 20 } });
  await page.keyboard.press(`${mod}+z`); // nothing to undo in this tab; tab 2's history must not leak
  expect(ids(await docIn(page, 0))).toEqual(['web', 'api']);
  expect(ids(await docIn(page, 1))).toEqual(['solo']);
});

test('switching tabs mid-drag cancels the drag in its own tab', async () => {
  const page = await open();
  await load(page, DOC);
  await newTabButton(page).click();
  await tabs(page).first().click();
  await expect(page.locator('.hit')).toHaveCount(2);
  const box = (await page.locator('.hit[data-id="web"]').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 150, { steps: 5 });
  await page.evaluate(() => {
    const dg = (window as any).__dg;
    dg.actions.switchTab(dg.tabs.getState().tabs[1].id);
  });
  await page.mouse.move(box.x + 260, box.y + 200, { steps: 3 });
  await page.mouse.up();
  expect(await docIn(page, 1)).toEqual({ entities: [], connections: [] });
  expect(await docIn(page, 0)).toEqual(DOC);
  expect(await page.evaluate(() => (window as any).__dg.tabs.getState().tabs[0].past.length)).toBe(0);
});

test('the code editor and its own undo stay with their tab', async () => {
  const page = await open();
  await load(page, DOC);
  await page.getByRole('tab', { name: 'Code', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${mod}+A`);
  await page.keyboard.insertText('{"entities": [');
  await expect(page.locator('.draft-bar')).toBeVisible();
  await newTabButton(page).click();
  await expect(page.locator('.cm-content')).toContainText('"entities": []');
  await expect(page.locator('.draft-bar')).toBeHidden();
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${mod}+z`); // CodeMirror's own undo must not bring back tab 1's text
  await expect(page.locator('.cm-content')).toContainText('"entities": []');
  expect(await page.evaluate(() => (window as any).__dg.doc.getState().codeDraft)).toBeNull();
  await tabs(page).first().click();
  await expect(page.locator('.cm-content')).toHaveText('{"entities": [');
  await expect(page.locator('.draft-bar')).toBeVisible();
});

test('closing a dirty tab asks first, and closing the last tab leaves a fresh Untitled', async () => {
  const page = await open();
  await load(page, DOC, '/tmp/keep.json');
  await page.evaluate(() => (window as any).__dg.doc.setState({ dirty: true }));
  await newTabButton(page).click();
  let message = '';
  page.once('dialog', (d) => {
    message = d.message();
    void d.dismiss();
  });
  await closeAt(page, 0);
  expect(message).toBe('Discard unsaved changes to “keep”?');
  await expect(tabs(page)).toHaveText(['keep — edited', 'Untitled']);
  page.once('dialog', (d) => void d.accept());
  await closeAt(page, 0);
  await expect(tabs(page)).toHaveText(['Untitled']);
  const before = await page.evaluate(() => (window as any).__dg.tabs.getState().activeId);
  await tabs(page).first().click({ button: 'middle' });
  await expect(tabs(page)).toHaveText(['Untitled']);
  expect(await page.evaluate(() => (window as any).__dg.tabs.getState().activeId)).not.toBe(before);
  expect(await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
});
