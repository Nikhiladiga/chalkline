import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch } from './launch';

// Snapping off while dragging: ⌘ on macOS, Ctrl elsewhere (Alt drops a copy).
const snapOff = process.platform === 'darwin' ? 'Meta' : 'Control';

test('an icon can leave a group across the origin, rejoin it, and undo without losing connections', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dg-group-drag-'));
  mkdirSync(join(dir, 'icons'));
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ hostedIcons: false }));
  writeFileSync(
    join(dir, 'icons/user.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="24" cy="12" r="8"/><path d="M8 44V32a16 16 0 0 1 32 0v12" fill="none" stroke="currentColor"/></svg>',
  );
  const { app, page } = await launch({ DG_USER_DATA: dir, DG_LLM_BASE_URL: 'http://127.0.0.1:1/v1' });
  try {
    await page.waitForFunction(() => (window as any).__dg);
    const original = {
      entities: [
        { tag: 'Group', id: 'vpc', x: 40, y: 40, width: 420, height: 300, title: { text: 'VPC' } },
        {
          tag: 'Icon',
          id: 'user',
          x: 70,
          y: 140,
          icon: 'user',
          containerId: 'vpc',
          texts: [{ text: 'User' }],
        },
        {
          tag: 'Shape',
          id: 'api',
          x: 300,
          y: 140,
          width: 90,
          height: 60,
          containerId: 'vpc',
          texts: [{ text: 'API' }],
        },
      ],
      connections: [{ from: 'user', to: 'api' }],
    };
    await page.evaluate((doc) => {
      const dg = (window as any).__dg;
      dg.actions.loadText(JSON.stringify(doc), null);
      dg.ui.getState().set({ zoom: 1, pan: { x: 260, y: 120 }, fitTick: 0 });
    }, original);
    const icon = page.locator('.hit[data-id="user"]');
    const group = page.locator('.hit[data-id="vpc"]');
    await expect(icon).toBeVisible();
    const before = (await icon.boundingBox())!;
    const groupBefore = (await group.boundingBox())!;
    const state = () => page.evaluate(() => (window as any).__dg.doc.getState().doc);
    const parent = async () => (await state()).entities.find((e: any) => e.id === 'user').containerId;
    const drag = async (dx: number, dy: number) => {
      const box = (await icon.boundingBox())!;
      await page.keyboard.down(snapOff);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
    };
    const release = async () => {
      await page.mouse.up();
      await page.keyboard.up(snapOff);
    };
    await drag(-180, 0);
    await release();
    await expect.poll(parent).toBeUndefined(); // Membership changes on drop, without growing the group.
    await expect.poll(async () => Math.abs((await icon.boundingBox())!.x - (before.x - 180))).toBeLessThan(2);
    expect(Math.abs((await group.boundingBox())!.x - groupBefore.x)).toBeLessThan(2);
    const outside = await state();
    expect(outside.entities.every((e: any) => e.x >= 0 && e.y >= 0)).toBe(true);
    expect(outside.connections).toEqual(original.connections);
    await page.screenshot({ path: 'test-results/group-drag-outside.png' });
    await page.evaluate(() => (window as any).__dg.doc.getState().undo());
    expect(await state()).toEqual(original);
    await page.evaluate(() => (window as any).__dg.doc.getState().redo());
    expect(await state()).toEqual(outside);
    await expect.poll(async () => Math.abs((await icon.boundingBox())!.x - (before.x - 180))).toBeLessThan(2);
    await drag(180, 0);
    await release();
    await expect.poll(parent).toBe('vpc');
    await drag(0, -220);
    await release();
    await expect.poll(parent).toBeUndefined();
    const above = await state();
    expect(above.entities.every((e: any) => e.x >= 0 && e.y >= 0)).toBe(true);
    expect(above.connections).toEqual(original.connections);
    await expect.poll(() => page.evaluate(() => (window as any).__dg.ui.getState().errors)).toEqual([]);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a drop past the origin holds still while its render is in flight', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dg-group-settle-'));
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ hostedIcons: false }));
  const { app, page } = await launch({ DG_USER_DATA: dir, DG_LLM_BASE_URL: 'http://127.0.0.1:1/v1' });
  try {
    await page.waitForFunction(() => (window as any).__dg);
    const doc = {
      entities: [
        { tag: 'Group', id: 'vpc', x: 40, y: 40, width: 420, height: 300, title: { text: 'VPC' } },
        {
          tag: 'Shape',
          id: 'api',
          x: 70,
          y: 140,
          width: 90,
          height: 60,
          containerId: 'vpc',
          texts: [{ text: 'API' }],
        },
      ],
      connections: [],
    };
    await page.evaluate((d) => {
      const dg = (window as any).__dg;
      dg.actions.loadText(JSON.stringify(d), null);
      dg.ui.getState().set({ zoom: 1, pan: { x: 260, y: 120 } });
    }, doc);
    const shape = page.locator('.hit[data-id="api"]');
    const group = page.locator('.hit[data-id="vpc"]');
    await expect(shape).toBeVisible();
    const before = (await shape.boundingBox())!;
    const groupBefore = (await group.boundingBox())!;
    // Hold every engine render until released, like a slow render of a big diagram.
    await page.evaluate(() => {
      const w = window as any;
      const run = w.__eraser.run;
      w.__hold = new Promise((r) => {
        w.__release = r;
      });
      w.__eraser.run = async (...a: unknown[]) => {
        await w.__hold;
        return run.apply(w.__eraser, a);
      };
    });
    await page.keyboard.down(snapOff);
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width / 2 - 180, before.y + before.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up(snapOff);
    // The drop committed (the document shifted right to stay ≥ 0) but its render is held: nothing may jump.
    expect(
      Math.min(
        ...(await page.evaluate(() => (window as any).__dg.doc.getState().doc.entities.map((e: any) => e.x))),
      ),
    ).toBe(0);
    expect(Math.abs((await shape.boundingBox())!.x - (before.x - 180))).toBeLessThan(2);
    expect(Math.abs((await group.boundingBox())!.x - groupBefore.x)).toBeLessThan(2);
    await page.evaluate(() => (window as any).__release());
    await page.waitForFunction(() => !document.querySelector('[data-preview]'));
    expect(Math.abs((await shape.boundingBox())!.x - (before.x - 180))).toBeLessThan(2);
    expect(Math.abs((await group.boundingBox())!.x - groupBefore.x)).toBeLessThan(2);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a drop past the origin keeps a scroll and zoom made while its render is in flight', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dg-group-view-'));
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ hostedIcons: false }));
  const { app, page } = await launch({ DG_USER_DATA: dir, DG_LLM_BASE_URL: 'http://127.0.0.1:1/v1' });
  try {
    await page.waitForFunction(() => (window as any).__dg);
    const doc = {
      entities: [
        { tag: 'Group', id: 'vpc', x: 40, y: 40, width: 420, height: 300, title: { text: 'VPC' } },
        {
          tag: 'Shape',
          id: 'api',
          x: 70,
          y: 140,
          width: 90,
          height: 60,
          containerId: 'vpc',
          texts: [{ text: 'API' }],
        },
      ],
      connections: [],
    };
    await page.evaluate((d) => {
      const dg = (window as any).__dg;
      dg.actions.loadText(JSON.stringify(d), null);
      dg.ui.getState().set({ zoom: 1, pan: { x: 260, y: 120 } });
    }, doc);
    const shape = page.locator('.hit[data-id="api"]');
    const group = page.locator('.hit[data-id="vpc"]');
    await expect(shape).toBeVisible();
    const before = (await shape.boundingBox())!;
    const groupBefore = (await group.boundingBox())!;
    // Hold every engine render until released, like a slow render of a big diagram.
    await page.evaluate(() => {
      const w = window as any;
      const run = w.__eraser.run;
      w.__hold = new Promise((r) => {
        w.__release = r;
      });
      w.__eraser.run = async (...a: unknown[]) => {
        await w.__hold;
        return run.apply(w.__eraser, a);
      };
    });
    await page.keyboard.down(snapOff);
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width / 2 - 180, before.y + before.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up(snapOff);
    // The drop committed (the document shifted right to stay ≥ 0) but its render is held: nothing may jump.
    // The user scrolls and zooms while the drop's render is still pending.
    await page.mouse.wheel(0, 70);
    await page.evaluate(() => (window as any).__dg.ui.getState().set({ zoom: 1.5 }));
    await expect.poll(async () => (await shape.boundingBox())!.width).toBeGreaterThan(before.width * 1.4);
    const held = (await shape.boundingBox())!;
    const heldView = await page.evaluate(() => (window as any).__dg.ui.getState().pan);
    await page.evaluate(() => (window as any).__release());
    await page.waitForFunction(() => !document.querySelector('[data-preview]'));
    // Only the origin-shift compensation is applied: the shape stays where the user left it, and the
    // view is not snapped back to its position at drop time.
    const after = (await shape.boundingBox())!;
    expect(Math.abs(after.x - held.x)).toBeLessThan(2);
    expect(Math.abs(after.y - held.y)).toBeLessThan(2);
    const view = await page.evaluate(() => (window as any).__dg.ui.getState());
    expect(view.zoom).toBe(1.5);
    expect(Math.abs(view.pan.y - heldView.y)).toBeLessThan(1); // the 70 px scroll survives
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
