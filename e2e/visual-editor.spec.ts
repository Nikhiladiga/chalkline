import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { PORT_POSITIONS, PORTS } from '../src/renderer/engine/ports';
import { launch } from './launch';

async function open() {
  const dir = mkdtempSync(join(tmpdir(), 'dg-visual-'));
  mkdirSync(join(dir, 'icons'));
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ hostedIcons: false }));
  for (const name of ['user', 'server', 'aws-lambda', 'aws-simple-storage-service'])
    writeFileSync(
      join(dir, 'icons', `${name}.svg`),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect x="2" y="2" width="44" height="44" rx="4" fill="#6775da"/></svg>',
    );
  const launched = await launch({
    DG_USER_DATA: dir,
    DG_SAVE_DIR: dir,
    DG_LLM_BASE_URL: 'http://127.0.0.1:1/v1',
  });
  await launched.page.waitForFunction(() => (window as any).__dg);
  return { ...launched, dir };
}
const docOf = (page: Page) => page.evaluate(() => (window as any).__dg.doc.getState().doc);
async function search(page: Page, name: string) {
  await page.getByRole('tab', { name: 'Icons', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search icons' }).fill(name);
  return page.locator(`.palette-cell[data-icon="${name}"]`);
}

test('palette searches aliases, browses providers and preserves code drafts and search across tabs', async () => {
  const { app, page, dir } = await open();
  try {
    await expect(page.getByRole('tab', { name: 'Icons', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const input = page.getByRole('searchbox', { name: 'Search icons' });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(900, 600));
    await expect(input).toBeVisible();
    expect(
      await page.locator('.palette-cell').evaluateAll((items) =>
        items.every((item) => {
          const tile = item.getBoundingClientRect();
          const name = item.querySelector('.palette-name')!.getBoundingClientRect();
          return name.bottom <= tile.bottom - 7 && name.height >= 12;
        }),
      ),
    ).toBe(true);
    await input.fill('s3');
    await expect(page.locator('.palette-cell').first()).toHaveAttribute(
      'data-icon',
      'aws-simple-storage-service',
    );
    expect(
      (await page.locator('.palette-cell').first().locator('.palette-name').boundingBox())!.height,
    ).toBeGreaterThanOrEqual(25);
    await input.fill('');
    await page.getByLabel('Browse icons').selectOption('aws');
    expect(
      await page
        .locator('.palette-cell')
        .evaluateAll((items) => items.every((item) => item.getAttribute('data-icon')?.startsWith('aws-'))),
    ).toBe(true);
    const initial = await page.locator('.palette-cell').count();
    await page.locator('.palette-results').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect.poll(() => page.locator('.palette-cell').count()).toBeGreaterThan(initial);
    await input.fill('aws lambda');
    await expect(page.locator('.palette-cell').first()).toHaveAttribute('data-icon', 'aws-lambda');
    await page.getByRole('tab', { name: 'Code', exact: true }).click();
    const editor = page.locator('.cm-content');
    await editor.fill('{"entities": [');
    await page.getByRole('tab', { name: 'Icons', exact: true }).click();
    await expect(input).toHaveValue('aws lambda');
    await page.getByRole('tab', { name: 'Code', exact: true }).click();
    await expect(editor).toHaveText('{"entities": [');
    await page.getByRole('tab', { name: 'Icons', exact: true }).click();
    await page.getByTestId('toggle-left').click();
    await page.getByTestId('toggle-left').click();
    await expect(input).toHaveValue('aws lambda');
    await page.screenshot({ path: 'test-results/visual-editor-palette.png' });
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('native icon drop follows zoom/pan, joins groups, and creates one undo step', async () => {
  const { app, page, dir } = await open();
  try {
    const original = {
      entities: [
        { tag: 'Group', id: 'vpc', x: 200, y: 140, width: 360, height: 300, title: { text: 'VPC' } },
      ],
      connections: [],
    };
    await page.evaluate((doc) => (window as any).__dg.actions.loadText(JSON.stringify(doc), null), original);
    await expect(page.locator('.hit[data-id="vpc"]')).toBeVisible();
    await page.evaluate(() => (window as any).__dg.ui.getState().set({ zoom: 0.8, pan: { x: -80, y: -40 } }));
    const tile = await search(page, 'user');
    const canvas = page.locator('.canvas');
    await tile.dragTo(canvas, { targetPosition: { x: 160, y: 160 } });
    await expect.poll(async () => (await docOf(page)).entities.length).toBe(2);
    const inserted = await docOf(page);
    expect(inserted.entities[1]).toMatchObject({ icon: 'user', x: 276, y: 226, containerId: 'vpc' });
    expect(await page.evaluate(() => (window as any).__dg.doc.getState().past.length)).toBe(1);
    await page.getByRole('tab', { name: 'Icons', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Code', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('tab', { name: 'Icons', exact: true })).toBeFocused();
    expect(await docOf(page)).toEqual(inserted);
    expect(await page.evaluate(() => (window as any).__dg.doc.getState().past.length)).toBe(1);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    expect(await docOf(page)).toEqual(original);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    expect(await docOf(page)).toEqual(inserted);
    await page.evaluate(() =>
      (window as any).__dg.doc.getState().load({ entities: [], connections: [] }, null),
    );
    await page.evaluate(() =>
      (window as any).__dg.ui.getState().set({ zoom: 1.25, pan: { x: 160, y: 120 } }),
    );
    await tile.dragTo(canvas, { targetPosition: { x: 70, y: 70 } });
    await expect.poll(async () => (await docOf(page)).entities.length).toBe(1);
    const outside = await docOf(page);
    expect(outside.entities[0]).toMatchObject({ x: 0, y: 0 });
    const viewport = (await canvas.boundingBox())!;
    await expect
      .poll(async () => {
        const box = (await page.locator('.hit[data-id="user"]').boundingBox())!;
        return Math.abs(box.x + box.width / 2 - (viewport.x + 70));
      })
      .toBeLessThan(2);
    await page.evaluate(() => (window as any).__dg.actions.save());
    expect(JSON.parse(readFileSync(join(dir, 'diagram.json'), 'utf8'))).toEqual(outside);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('eight precise connectors follow icon movement and resize, cancel cleanly, and survive save/export', async () => {
  const { app, page, dir } = await open();
  try {
    await page.evaluate(() =>
      (window as any).__dg.actions.loadText(
        JSON.stringify({
          entities: [
            { tag: 'Icon', id: 'a', icon: 'user', x: 100, y: 100, texts: [{ text: 'User' }] },
            { tag: 'Icon', id: 'b', icon: 'server', x: 370, y: 250, texts: [{ text: 'Server' }] },
          ],
          connections: [],
        }),
        null,
      ),
    );
    const a = page.locator('.hit[data-id="a"]');
    const b = page.locator('.hit[data-id="b"]');
    await expect(a).toBeVisible();
    await page.evaluate(() => (window as any).__dg.ui.getState().set({ zoom: 1, pan: { x: 40, y: 40 } }));
    const dragLink = async (port: (typeof PORTS)[number], targetPort: (typeof PORTS)[number]) => {
      await a.click();
      await expect(page.locator('.connection-port[data-id="a"]')).toHaveCount(8);
      const handle = (await page
        .locator(`.connection-port[data-id="a"][data-port="${port}"]`)
        .boundingBox())!;
      const target = (await b.boundingBox())!;
      const [x, y] = PORT_POSITIONS[targetPort];
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(target.x + target.width * x, target.y + target.height * y, { steps: 8 });
      await expect(page.getByTestId('link-preview')).toBeVisible();
      await page.mouse.up();
    };
    const verify = async () => {
      await expect
        .poll(() =>
          page.evaluate(() => {
            const dg = (window as any).__dg;
            const r = dg.ui.getState().render;
            const doc = dg.doc.getState().doc;
            if (dg.ui.getState().errors.length || !r || r.connectionIds.length !== doc.connections.length)
              return false;
            const positions: Record<string, [number, number]> = {
              'top-left': [0, 0],
              top: [0.5, 0],
              'top-right': [1, 0],
              right: [1, 0.5],
              'bottom-right': [1, 1],
              bottom: [0.5, 1],
              'bottom-left': [0, 1],
              left: [0, 0.5],
            };
            return doc.connections.every((c: any, i: number) => {
              const pts = r.connections[r.connectionIds[i]]?.points;
              if (!pts?.length) return false;
              return [
                ['from', pts[0]],
                ['to', pts.at(-1)],
              ].every(([side, point]: any) => {
                const box = r.boxes[c[side]];
                const [x, y] = positions[c[`${side}Port`]]!;
                return (
                  Math.abs(point[0] - (box.x + box.width * x)) <= 1 &&
                  Math.abs(point[1] - (box.y + box.height * y)) <= 1
                );
              });
            });
          }),
        )
        .toBe(true);
    };
    for (let i = 0; i < PORTS.length; i++) {
      const from = PORTS[i]!;
      const to = PORTS[(i + 4) % PORTS.length]!;
      await dragLink(from, to);
      await expect.poll(async () => (await docOf(page)).connections.length).toBe(i + 1);
      expect((await docOf(page)).connections.at(-1)).toMatchObject({ fromPort: from, toPort: to });
      await verify();
    }
    const count = (await docOf(page)).connections.length;
    await dragLink('top-left', 'bottom-right');
    expect((await docOf(page)).connections).toHaveLength(count);
    await a.click();
    const cancelHandle = page.locator('.connection-port[data-id="a"][data-port="right"]');
    const h = (await cancelHandle.boundingBox())!;
    const canvas = (await page.locator('.canvas').boundingBox())!;
    for (const cancel of ['escape', 'empty', 'pointercancel']) {
      const history = await page.evaluate(() => (window as any).__dg.doc.getState().past.length);
      await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
      await page.mouse.down();
      await page.mouse.move(canvas.x + 10, canvas.y + 10);
      if (cancel === 'escape') await page.keyboard.press('Escape');
      if (cancel === 'pointercancel')
        await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel')));
      await page.mouse.up();
      expect((await docOf(page)).connections).toHaveLength(count);
      expect(await page.evaluate(() => (window as any).__dg.doc.getState().past.length)).toBe(history);
      await expect(page.getByTestId('link-preview')).toHaveCount(0);
      await a.click();
    }
    const old = (await a.boundingBox())!;
    await page.mouse.move(old.x + old.width / 2, old.y + old.height / 2);
    await page.mouse.down();
    await page.mouse.move(old.x + old.width / 2 + 35, old.y + old.height / 2 + 55, { steps: 8 });
    await page.mouse.up();
    await verify();
    await a.click();
    const resize = (await page.getByTestId('resize-handle').boundingBox())!;
    await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2);
    await page.mouse.down();
    await page.mouse.move(resize.x + resize.width / 2 + 30, resize.y + resize.height / 2 + 30, { steps: 8 });
    await page.mouse.up();
    await verify();
    const saved = await docOf(page);
    await page.evaluate(() => (window as any).__dg.actions.save());
    expect(JSON.parse(readFileSync(join(dir, 'diagram.json'), 'utf8'))).toEqual(saved);
    await page.evaluate((doc) => (window as any).__dg.actions.loadText(JSON.stringify(doc), null), saved);
    await verify();
    await page.evaluate(async () => {
      await (window as any).__dg.actions.exportSvg();
      await (window as any).__dg.actions.exportPng(1, false);
    });
    expect(readFileSync(join(dir, 'diagram.svg'), 'utf8')).toContain('<svg');
    expect(readFileSync(join(dir, 'diagram.png')).subarray(1, 4).toString()).toBe('PNG');
    await a.hover();
    await page.screenshot({ path: 'test-results/visual-editor-connectors.png' });
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
