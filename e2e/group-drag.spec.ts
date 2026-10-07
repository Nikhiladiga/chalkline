import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch } from './launch';

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
      await page.keyboard.down('Alt');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
    };
    const release = async () => {
      await page.mouse.up();
      await page.keyboard.up('Alt');
    };
    await drag(-180, 0);
    await expect.poll(parent).toBeUndefined(); // Membership updates during the drag, without growing the group.
    await release();
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
