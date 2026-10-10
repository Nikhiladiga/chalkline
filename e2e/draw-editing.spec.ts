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
  // Highlighted page text wins over the selected elements: ⌘C copies the text, ⌘X cuts nothing.
  const count = (await ids(page)).length;
  await page.evaluate(() => getSelection()!.selectAllChildren(document.querySelector('.status span')!));
  await page.keyboard.press(`${mod}+c`);
  await expect.poll(clipboardText).toBe('Valid');
  await page.keyboard.press(`${mod}+x`);
  await page.keyboard.press(`${mod}+c`); // a round trip, so the cut's (absent) effect has landed
  await expect.poll(clipboardText).toBe('Valid');
  expect((await ids(page)).length).toBe(count);
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

const center = async (page: Page, id: string) => {
  const b = (await page.locator(`.hit[data-id="${id}"]`).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const settled = (page: Page) => page.waitForFunction(() => !document.querySelector('[data-preview]'));

test('Alt-drag drops a copy and leaves the original; Escape leaves no ghost', async () => {
  const page = await open();
  const a = await center(page, 'a');
  const original = await docOf(page);
  const altDrag = async (dx: number, finish: () => Promise<void>) => {
    await page.keyboard.down('Alt');
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + dx, a.y + 140, { steps: 8 });
    await expect(page.locator('[data-preview-clone]').first()).toBeAttached();
    expect(Math.abs((await center(page, 'a')).x - a.x)).toBeLessThan(1); // the original stays
    await finish();
    await page.keyboard.up('Alt');
  };
  await altDrag(150, () => page.keyboard.press('Escape').then(() => page.mouse.up()));
  await expect(page.locator('[data-preview-clone]')).toHaveCount(0);
  expect(await docOf(page)).toEqual(original);
  expect(await past(page)).toBe(0);
  await altDrag(150, () => page.mouse.up());
  await expect.poll(() => ids(page)).toEqual(['a', 'b', 'c', 'a-2']);
  const copy = await entity(page, 'a-2');
  expect(Math.abs(copy.x - 250)).toBeLessThanOrEqual(7);
  expect(Math.abs(copy.y - 240)).toBeLessThanOrEqual(7);
  expect(await entity(page, 'a')).toMatchObject({ x: 100, y: 100 });
  expect(await page.evaluate(() => (window as any).__dg.doc.getState().selection.entities)).toEqual(['a-2']);
  await settled(page);
  await expect(page.locator('[data-preview-clone]')).toHaveCount(0);
  await page.keyboard.press(`${mod}+z`);
  expect(await docOf(page)).toEqual(original);
});

/** Screen point of a document point. */
const toScreen = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([px, py]) => {
      const ui = (window as any).__dg.ui.getState();
      const r = document.querySelector('.canvas')!.getBoundingClientRect();
      return { x: r.left + ui.pan.x + px! * ui.zoom, y: r.top + ui.pan.y + py! * ui.zoom };
    },
    [x, y],
  );
/** A screen point on connection i: the middle of its first segment. */
const onLine = async (page: Page, i: number) => {
  const [p, q] = await page.evaluate((n) => {
    const r = (window as any).__dg.ui.getState().render;
    return r.connections[r.connectionIds[n]].points.slice(0, 2);
  }, i);
  return toScreen(page, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
};
test('double-click a line to label it; Enter commits, Escape cancels, blank removes, keys stay in the field', async () => {
  const page = await open();
  const label = page.getByRole('textbox', { name: 'Connection label' });
  const p = await onLine(page, 0);
  await page.mouse.dblclick(p.x, p.y);
  await expect(label).toBeFocused();
  await label.fill('calls');
  await page.keyboard.press(`${mod}+z`); // native text undo in the field, not a diagram undo
  expect(await past(page)).toBe(0);
  await label.fill('calls');
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.press(`${mod}+c`);
  await expect.poll(clipboardText).toBe('calls'); // the text, not diagram JSON
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await docOf(page)).connections[0].label).toBe('calls');
  expect(await past(page)).toBe(1);
  // Escape: no change, no history; the blur that follows must not commit either.
  await page.mouse.dblclick(p.x, p.y);
  await label.fill('nope');
  await page.keyboard.press('Escape');
  await expect(label).toHaveCount(0);
  expect((await docOf(page)).connections[0].label).toBe('calls');
  expect(await past(page)).toBe(1);
  // Double-click the label box itself; a blank label removes the key.
  const box = (await page.locator('.conn-hit-label').first().boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(label).toHaveValue('calls');
  await label.fill('   ');
  const canvas = (await page.locator('.canvas').boundingBox())!;
  await page.mouse.click(canvas.x + 10, canvas.y + canvas.height - 60); // clicking away commits
  await expect.poll(async () => (await docOf(page)).connections[0]).toEqual({ from: 'a', to: 'b' });
  await page.keyboard.press(`${mod}+z`);
  expect((await docOf(page)).connections[0].label).toBe('calls');
});

test('an open label edit keeps a change that lands meanwhile and commits to its own tab on a tab switch', async () => {
  const page = await open();
  const label = page.getByRole('textbox', { name: 'Connection label' });
  const p = await onLine(page, 0);
  await page.mouse.dblclick(p.x, p.y);
  await label.fill('calls');
  // An AI result (or any other commit) lands while the field is open: the field and its text stay.
  await page.evaluate(() => {
    const s = (window as any).__dg.doc.getState();
    s.commit({ ...s.doc, entities: s.doc.entities.map((e: any) => (e.id === 'c' ? { ...e, x: 500 } : e)) });
  });
  await expect(label).toHaveValue('calls');
  // Switching tabs (it blurs the field) commits the edit to the tab it was opened in; the new tab is untouched.
  await page.evaluate(() => (window as any).__dg.actions.newTab());
  await expect(label).toHaveCount(0);
  const [first, second] = await page.evaluate(() =>
    (window as any).__dg.tabs.getState().tabs.map((t: any) => t.doc),
  );
  expect(first.connections[0].label).toBe('calls');
  expect(first.entities.find((e: any) => e.id === 'c').x).toBe(500);
  expect(second).toEqual({ entities: [], connections: [] });
  expect(await past(page)).toBe(0); // the active (new) tab has no history
});

test('drag a selected line end to another element or port; invalid drops change nothing', async () => {
  const page = await open();
  const p = await onLine(page, 0);
  await page.mouse.click(p.x, p.y);
  const end = page.getByTestId('conn-end-to');
  await expect(end).toBeVisible();
  const dragEnd = async (to: { x: number; y: number }) => {
    const h = (await end.boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await expect(page.getByTestId('reconnect-preview')).toBeVisible();
    await page.mouse.up();
  };
  const canvas = (await page.locator('.canvas').boundingBox())!;
  for (const nowhere of [
    { x: canvas.x + 20, y: canvas.y + canvas.height - 40 },
    await center(page, 'a'),
    await center(page, 'b'),
  ]) {
    await dragEnd(nowhere); // empty canvas, the line's own start (no self-link), its own end (no change)
    expect((await docOf(page)).connections).toEqual(DOC.connections);
    expect(await past(page)).toBe(0);
  }
  // Escape mid-drag cancels: no change, no history, no preview left behind.
  const h0 = (await end.boundingBox())!;
  const c0 = await center(page, 'c');
  await page.mouse.move(h0.x + h0.width / 2, h0.y + h0.height / 2);
  await page.mouse.down();
  await page.mouse.move(c0.x, c0.y, { steps: 8 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.getByTestId('reconnect-preview')).toHaveCount(0);
  expect((await docOf(page)).connections).toEqual(DOC.connections);
  expect(await past(page)).toBe(0);
  await page.mouse.click(p.x, p.y); // Escape also cleared the selection: select the line again
  await dragEnd(await center(page, 'c')); // a body drop floats
  await expect.poll(async () => (await docOf(page)).connections).toEqual([{ from: 'a', to: 'c' }]);
  await settled(page);
  const top = await page.evaluate(() => {
    const b = (window as any).__dg.ui.getState().render.boxes.c;
    return { x: b.x + b.width / 2, y: b.y };
  });
  await dragEnd(await toScreen(page, top.x, top.y)); // a port drop pins both ends
  await expect
    .poll(async () => (await docOf(page)).connections[0])
    .toMatchObject({ from: 'a', to: 'c', toPort: 'top' });
  expect((await docOf(page)).connections[0].fromPort).toBeTruthy();
  expect(await past(page)).toBe(2);
  // A body drop back on the element this end is already on keeps its port: no change, no history.
  await settled(page);
  const pinned = (await docOf(page)).connections;
  const low = await page.evaluate(() => {
    const b = (window as any).__dg.ui.getState().render.boxes.c;
    return { x: b.x + b.width / 2, y: b.y + b.height * 0.75 };
  });
  await dragEnd(await toScreen(page, low.x, low.y));
  expect((await docOf(page)).connections).toEqual(pinned);
  expect(await past(page)).toBe(2);
  await page.keyboard.press(`${mod}+z`);
  expect((await docOf(page)).connections).toEqual([{ from: 'a', to: 'c' }]);
  // Keyboard: Enter on the end handle, then Enter on a port.
  await end.focus();
  await page.keyboard.press('Enter');
  const port = page.locator('.connection-port[data-id="b"][data-port="left"]');
  await port.focus();
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await docOf(page)).connections[0])
    .toMatchObject({ from: 'a', to: 'b', toPort: 'left' });
});

test('reconnecting inside a group keeps membership', async () => {
  const page = await open({
    entities: [
      { tag: 'Group', id: 'vpc', x: 40, y: 40, width: 600, height: 400, title: { text: 'VPC' } },
      ...DOC.entities.map((e) => ({ ...e, containerId: 'vpc' })),
    ],
    connections: DOC.connections,
  });
  const p = await onLine(page, 0);
  await page.mouse.click(p.x, p.y);
  const h = (await page.getByTestId('conn-end-from').boundingBox())!;
  const c = await center(page, 'c');
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(c.x, c.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await docOf(page)).connections).toEqual([{ from: 'c', to: 'b' }]);
  expect((await docOf(page)).entities.filter((e: any) => e.containerId === 'vpc')).toHaveLength(3);
});

test('a reconnect that would duplicate a line, or a tab switch mid-drag, changes nothing', async () => {
  const doc = { ...DOC, connections: [...DOC.connections, { from: 'c', to: 'b' }] };
  const page = await open(doc);
  const p = await onLine(page, 1);
  await page.mouse.click(p.x, p.y);
  const drag = async (end: string, to: { x: number; y: number }, before: () => Promise<void>) => {
    const h = (await page.getByTestId(`conn-end-${end}`).boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await expect(page.getByTestId('reconnect-preview')).toBeVisible();
    await before();
    await page.mouse.up();
  };
  await drag('from', await center(page, 'a'), async () => {}); // c → b would become a second a → b
  expect((await docOf(page)).connections).toEqual(doc.connections);
  expect(await past(page)).toBe(0);
  // c → a would be valid, but the tab switch cancels it: no preview, and the release changes nothing.
  await drag('to', await center(page, 'a'), async () => {
    await page.evaluate(() => (window as any).__dg.actions.newTab());
    await expect(page.getByTestId('reconnect-preview')).toHaveCount(0);
  });
  const [first, second] = await page.evaluate(() =>
    (window as any).__dg.tabs.getState().tabs.map((t: any) => t.doc),
  );
  expect(first.connections).toEqual(doc.connections);
  expect(second).toEqual({ entities: [], connections: [] });
});

test('Shift-drag moves along one axis, also for an already selected element', async () => {
  const page = await open();
  const selected = () => page.evaluate(() => (window as any).__dg.doc.getState().selection.entities);
  const drag = async (id: string, keys: string[], dx: number, dy: number) => {
    const p = await center(page, id);
    for (const k of keys) await page.keyboard.down(k);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + dx, p.y + dy, { steps: 8 });
    await page.mouse.up();
    for (const k of keys) await page.keyboard.up(k);
    await settled(page);
  };
  await page.locator('.hit[data-id="a"]').click();
  await drag('a', ['Shift'], 130, 25);
  await expect.poll(async () => (await entity(page, 'a')).x).toBeGreaterThan(220);
  expect((await entity(page, 'a')).y).toBe(100);
  expect(await selected()).toEqual(['a']);
  // A Shift-click without a drag still deselects.
  await page.locator('.hit[data-id="a"]').click({ modifiers: ['Shift'] });
  expect(await selected()).toEqual([]);
  // With Alt, a vertical copy keeps the original's x.
  const a = await entity(page, 'a');
  await drag('a', ['Shift', 'Alt'], 15, 150);
  await expect.poll(() => ids(page)).toEqual(['a', 'b', 'c', 'a-2']);
  expect((await entity(page, 'a-2')).x).toBe(a.x);
  expect(Math.abs((await entity(page, 'a-2')).y - 250)).toBeLessThanOrEqual(7);
  expect(await entity(page, 'a')).toMatchObject({ x: a.x, y: 100 });
  // With ⌘/Ctrl, the free axis does not snap: 3 px right of b's left edge stays there.
  const copy = await entity(page, 'a-2');
  await drag('a-2', ['Shift', mod], 403 - copy.x, 10);
  await expect.poll(async () => (await entity(page, 'a-2')).x).toBe(403);
  expect((await entity(page, 'a-2')).y).toBe(copy.y);
  expect(await selected()).toEqual(['a-2']);
});

test('F2 and Enter edit the one selected element or line; not for several, mid-drag, behind a modal or while typing', async () => {
  const page = await open();
  // Keys that must open nothing: no editor may mount, even briefly (one that blurs at once would vanish).
  const pressNothing = async (...keys: string[]) => {
    await page.evaluate(() => {
      const w = window as any;
      w.__mounted = false;
      w.__watch?.disconnect();
      w.__watch = new MutationObserver(() => {
        if (document.querySelector('.text-edit')) w.__mounted = true;
      });
      w.__watch.observe(document.body, { childList: true, subtree: true });
    });
    for (const k of keys) await page.keyboard.press(k);
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => (window as any).__mounted)).toBe(false);
  };
  await page.locator('.hit[data-id="a"]').click();
  await page.keyboard.press('F2');
  await expect(page.locator('textarea.text-edit')).toHaveValue('A');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await page.locator('textarea.text-edit').fill('Alpha');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await entity(page, 'a')).texts[0].text).toBe('Alpha');
  const p = await onLine(page, 0);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press('Enter');
  await page.getByRole('textbox', { name: 'Connection label' }).fill('HTTP');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await docOf(page)).connections[0].label).toBe('HTTP');
  expect(await past(page)).toBe(2);
  // Enter on a focused button stays the button's.
  await page.getByRole('button', { name: 'Fit', exact: true }).focus();
  await pressNothing('Enter');
  // Several items selected: nothing opens (there is no single label to edit).
  await page.locator('.hit[data-id="b"]').click();
  await page.locator('.hit[data-id="c"]').click({ modifiers: ['Shift'] });
  await pressNothing('F2', 'Enter');
  // b alone (clicking b would keep the multi-selection, for a group drag).
  const onlyB = () =>
    page.evaluate(() => (window as any).__dg.doc.getState().select({ entities: ['b'], connections: [] }));
  // Mid-drag: nothing opens.
  await onlyB();
  const b = await center(page, 'b');
  await page.mouse.move(b.x, b.y);
  await page.mouse.down();
  await page.mouse.move(b.x + 30, b.y + 30, { steps: 4 });
  await pressNothing('F2');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  // Behind a modal: nothing opens.
  await onlyB();
  await page.evaluate(() => (window as any).__dg.ui.getState().set({ settingsOpen: true }));
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); // not typing: the body has focus
  await pressNothing('F2');
  await page.evaluate(() => (window as any).__dg.ui.getState().set({ settingsOpen: false }));
  await expect(page.getByRole('dialog')).toBeHidden();
  // No rendered box yet (its render is pending or failed): nothing opens, not even once the box shows up.
  await onlyB();
  await page.evaluate(() => {
    const ui = (window as any).__dg.ui;
    (window as any).__r = ui.getState().render;
    ui.getState().set({ render: { ...(window as any).__r, boxes: {} } });
  });
  await expect(page.locator('.hit[data-id="b"]')).toHaveCount(0);
  await page.keyboard.press('F2');
  await page.evaluate(() => (window as any).__dg.ui.getState().set({ render: (window as any).__r }));
  await expect(page.locator('.hit[data-id="b"]')).toBeVisible();
  await expect(page.locator('textarea.text-edit')).toHaveCount(0);
  // Typing in the code editor: F2 stays there.
  await page.locator('.hit[data-id="b"]').click();
  await page.getByRole('tab', { name: 'Code', exact: true }).click();
  await page.locator('.cm-content').click();
  await pressNothing('F2');
  expect(await past(page)).toBe(2);
});

test('a drop whose render throws still settles: the error shows and the next drag works', async () => {
  const page = await open();
  await page.evaluate(() => {
    const eraser = (window as any).__eraser;
    const run = eraser.run;
    eraser.run = async () => {
      eraser.run = run;
      throw new Error('render exploded');
    };
  });
  const drag = async () => {
    const c = await center(page, 'c');
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 100, c.y, { steps: 8 });
    await page.mouse.up();
  };
  await drag();
  await expect.poll(async () => (await entity(page, 'c')).x).toBeGreaterThan(450);
  await expect(page.locator('.error-pill')).toContainText('render exploded');
  await expect(page.locator('[data-preview]')).toHaveCount(0);
  const x = (await entity(page, 'c')).x;
  await drag();
  await expect.poll(async () => (await entity(page, 'c')).x).toBeGreaterThan(x + 50);
  await expect(page.locator('.error-pill')).toHaveCount(0);
});

test('label field: Enter while composing does not commit; an untouched open and blur adds no undo step', async () => {
  const page = await open({
    ...DOC,
    connections: [
      { from: 'a', to: 'b', label: ' HTTP ' },
      { from: 'b', to: 'c' },
    ],
  });
  // A non-string label (typed into the code) fails to render; the canvas keeps the last good render.
  await page.evaluate(() => {
    const s = (window as any).__dg.doc.getState();
    s.commit({ ...s.doc, connections: [s.doc.connections[0], { ...s.doc.connections[1], label: 42 }] });
  });
  await expect(page.locator('.hit').first()).toBeVisible();
  const label = page.getByRole('textbox', { name: 'Connection label' });
  const canvas = (await page.locator('.canvas').boundingBox())!;
  for (const i of [0, 1]) {
    const p = await onLine(page, i);
    await page.mouse.dblclick(p.x, p.y);
    await expect(label).toBeFocused();
    await page.mouse.click(canvas.x + 10, canvas.y + canvas.height - 60);
    await expect(label).toHaveCount(0);
  }
  expect((await docOf(page)).connections.map((c: any) => c.label)).toEqual([' HTTP ', 42]);
  expect(await past(page)).toBe(1);
  // IME: the Enter that ends a composition is the IME's, in both editors.
  const composingEnter = (sel: string) =>
    page
      .locator(sel)
      .evaluate((el) =>
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })),
      );
  const p = await onLine(page, 0);
  await page.mouse.dblclick(p.x, p.y);
  await label.fill('呼ぶ');
  await composingEnter('input.label-edit');
  await expect(label).toHaveValue('呼ぶ');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await docOf(page)).connections[0].label).toBe('呼ぶ');
  await page.locator('.hit[data-id="a"]').click();
  await page.keyboard.press('F2');
  await page.locator('textarea.text-edit').fill('甲');
  await composingEnter('textarea.text-edit');
  await expect(page.locator('textarea.text-edit')).toHaveValue('甲');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await entity(page, 'a')).texts[0].text).toBe('甲');
  expect(await past(page)).toBe(3);
});

test('Arrange aligns and distributes the selection in one undo step and one render each', async () => {
  const page = await open({
    entities: [
      { tag: 'Icon', id: 'p', icon: 'server', x: 100, y: 100, texts: [{ text: 'P' }] },
      { tag: 'Icon', id: 'q', icon: 'server', x: 220, y: 200, texts: [{ text: 'Q' }] },
      { tag: 'Icon', id: 'r', icon: 'server', x: 600, y: 300, texts: [{ text: 'R' }] },
    ],
    connections: [{ from: 'p', to: 'r' }],
  });
  await page.locator('.hit[data-id="p"]').click();
  await page.locator('.hit[data-id="q"]').click({ modifiers: ['Shift'] });
  const align = page.getByRole('button', { name: 'Align top', exact: true });
  const spread = page.getByRole('button', { name: 'Distribute horizontally', exact: true });
  // Two roots align but cannot distribute.
  await expect(align).toBeVisible();
  await expect(spread).toBeDisabled();
  await page.locator('.hit[data-id="r"]').click({ modifiers: ['Shift'] });
  // A selected line is ignored.
  await page.evaluate(() =>
    (window as any).__dg.doc.getState().select({ entities: ['p', 'q', 'r'], connections: [0] }),
  );
  await page.evaluate(() => {
    const w = window as any;
    w.__runs = 0;
    const run = w.__eraser.run;
    w.__eraser.run = (...a: unknown[]) => {
      w.__runs++;
      return run.apply(w.__eraser, a);
    };
  });
  const runs = () => page.evaluate(() => (window as any).__runs as number);
  const at = async () => (await docOf(page)).entities.map((e: any) => [e.x, e.y]);
  await align.click();
  await expect.poll(at).toEqual([
    [100, 100],
    [220, 100],
    [600, 100],
  ]);
  await expect.poll(runs).toBe(1);
  await spread.click();
  await expect.poll(at).toEqual([
    [100, 100],
    [350, 100],
    [600, 100],
  ]);
  await expect.poll(runs).toBe(2);
  expect(await past(page)).toBe(2);
  expect((await docOf(page)).connections).toEqual([{ from: 'p', to: 'r' }]);
  await page.keyboard.press(`${mod}+z`);
  expect(await at()).toEqual([
    [100, 100],
    [220, 100],
    [600, 100],
  ]);
});

test('Arrange keeps grouping; a group with its own child is one root, so Arrange hides', async () => {
  const page = await open({
    entities: [
      { tag: 'Group', id: 'g', x: 0, y: 0, width: 300, height: 200, title: { text: 'G' } },
      { tag: 'Icon', id: 'k', icon: 'server', x: 60, y: 60, containerId: 'g', texts: [{ text: 'K' }] },
      { tag: 'Icon', id: 'o', icon: 'server', x: 500, y: 60, texts: [{ text: 'O' }] },
    ],
    connections: [],
  });
  const select = (ids: string[]) =>
    page.evaluate((e) => (window as any).__dg.doc.getState().select({ entities: e, connections: [] }), ids);
  await select(['g', 'k']);
  await expect(page.getByText('2 selected')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Align left', exact: true })).toHaveCount(0);
  // A grouped child aligned to an icon outside its group moves out of the box but stays in the group.
  await select(['k', 'o']);
  await page.getByRole('button', { name: 'Align right', exact: true }).click();
  await expect.poll(() => entity(page, 'k')).toMatchObject({ x: 500, y: 60, containerId: 'g' });
  expect((await entity(page, 'o')).containerId).toBeUndefined();
  expect(await past(page)).toBe(1);
});
