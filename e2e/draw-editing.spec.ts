import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import { launch } from './launch';

// draw.io-style editing: clipboard, Alt-drag copies, line labels, reconnecting, Shift-drag, F2/Enter, arrange.
const DOC = {
  entities: [
    { tag: 'Icon', id: 'a', icon: 'user', x: 100, y: 100, texts: [{ text: 'A' }] },
    { tag: 'Icon', id: 'b', icon: 'server', x: 400, y: 100, texts: [{ text: 'B' }] },
    { tag: 'Icon', id: 'c', icon: 'server', x: 400, y: 320, texts: [{ text: 'C' }] },
  ],
  connections: [{ from: 'a', to: 'b' }],
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

async function open(doc: unknown = DOC): Promise<Page> {
  dir = mkdtempSync(join(tmpdir(), 'dg-draw-'));
  mkdirSync(join(dir, 'icons'));
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ hostedIcons: false }));
  for (const name of ['user', 'server'])
    writeFileSync(
      join(dir, 'icons', `${name}.svg`),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect x="2" y="2" width="44" height="44" rx="4" fill="#6775da"/></svg>',
    );
  const launched = await launch({ DG_USER_DATA: dir, DG_LLM_BASE_URL: 'http://127.0.0.1:1/v1' });
  app = launched.app;
  const page = launched.page;
  await page.waitForFunction(() => (window as any).__dg);
  await page.evaluate((d) => (window as any).__dg.actions.loadText(JSON.stringify(d), null), doc);
  await expect(page.locator('.hit').first()).toBeVisible();
  await page.evaluate(() => (window as any).__dg.ui.getState().set({ zoom: 1, pan: { x: 40, y: 40 } }));
  return page;
}

const docOf = (page: Page) => page.evaluate(() => (window as any).__dg.doc.getState().doc);
const past = (page: Page) => page.evaluate(() => (window as any).__dg.doc.getState().past.length as number);
const ids = async (page: Page) => (await docOf(page)).entities.map((e: any) => e.id);
const entity = async (page: Page, id: string) => (await docOf(page)).entities.find((e: any) => e.id === id);
const clipboardText = () => app!.evaluate(({ clipboard }) => clipboard.readText());
const setClipboard = (text: string) => app!.evaluate(({ clipboard }, t) => clipboard.writeText(t), text);
test('copy and paste: fresh ids, a 20 px cascade, connections between copies, one undo step each', async () => {
  const page = await open();
  await page.locator('.hit[data-id="a"]').click();
  await page.keyboard.press(`${mod}+c`);
  await expect
    .poll(async () => JSON.parse((await clipboardText()) || '{}').entities?.map((e: any) => e.id))
    .toEqual(['a']);
  await page.keyboard.press(`${mod}+v`);
  await expect.poll(() => entity(page, 'a-2')).toMatchObject({ x: 120, y: 120 });
  await page.keyboard.press(`${mod}+v`);
  await expect.poll(() => entity(page, 'a-3')).toMatchObject({ x: 140, y: 140 });
  expect(await page.evaluate(() => (window as any).__dg.doc.getState().selection.entities)).toEqual(['a-3']);
  expect(await past(page)).toBe(2);
  await page.keyboard.press(`${mod}+z`);
  expect(await ids(page)).toEqual(['a', 'b', 'c', 'a-2']);
  // Two connected elements bring their connection along (a-2 overlaps a's lower right).
  await page.locator('.hit[data-id="a"]').click({ position: { x: 5, y: 5 } });
  await page.locator('.hit[data-id="b"]').click({ modifiers: ['Shift'] });
  await page.keyboard.press(`${mod}+c`);
  await page.keyboard.press(`${mod}+v`);
  await expect.poll(async () => (await docOf(page)).connections).toContainEqual({ from: 'a-3', to: 'b-2' });
});

test('cut pastes back in place; another tab gets the original coordinates; a paste stays in its tab', async () => {
  const page = await open();
  await page.locator('.hit[data-id="c"]').click();
  await page.keyboard.press(`${mod}+x`);
  await expect.poll(() => ids(page)).toEqual(['a', 'b']);
  await page.keyboard.press(`${mod}+v`);
  await expect.poll(() => entity(page, 'c')).toMatchObject({ x: 400, y: 320 });
  await page.locator('.hit[data-id="b"]').click();
  await page.keyboard.press(`${mod}+c`);
  await expect.poll(async () => JSON.parse((await clipboardText()) || '{}').entities?.[0]?.id).toBe('b');
  await page.evaluate(() => (window as any).__dg.actions.newTab());
  await page.keyboard.press(`${mod}+v`);
  await expect.poll(() => docOf(page)).toMatchObject({ entities: [{ id: 'b', x: 400, y: 100 }] });
  // Paste, then switch tabs before it lands: it still goes to the tab where it was asked for.
  const [first, second] = await page.evaluate(async () => {
    const dg = (window as any).__dg;
    const [one, two] = dg.tabs.getState().tabs.map((t: any) => t.id);
    const pasting = dg.actions.pasteClipboard();
    dg.actions.switchTab(one);
    await pasting;
    const docs = dg.tabs.getState().tabs.map((t: any) => t.doc.entities.map((e: any) => e.id));
    return [docs[0], docs[1], two];
  });
  expect(first).toEqual(['a', 'b', 'c']);
  expect(second).toEqual(['b', 'b-2']);
});

test('pasting outside JSON validates it; plain text is ignored; text fields keep native paste', async () => {
  const page = await open();
  await setClipboard(
    JSON.stringify({ entities: [{ tag: 'Icon', id: 'ext', icon: 'server', x: 10, y: 10 }], connections: [] }),
  );
  await page.keyboard.press(`${mod}+v`);
  await expect.poll(() => entity(page, 'ext')).toMatchObject({ x: 10, y: 10 });
  const before = await docOf(page);
  await setClipboard('plain words');
  await page.keyboard.press(`${mod}+v`);
  await setClipboard(JSON.stringify({ entities: [{ tag: 'Bogus', id: 'x', x: 0, y: 0 }], connections: [] }));
  await page.keyboard.press(`${mod}+v`);
  await expect(page.locator('.toast')).toContainText('Could not paste');
  expect(await docOf(page)).toEqual(before);
  await setClipboard('hello');
  await page.getByRole('tab', { name: 'Code', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.press(`${mod}+v`);
  await expect(page.locator('.cm-content')).toHaveText('hello');
  expect(await docOf(page)).toEqual(before);
});
