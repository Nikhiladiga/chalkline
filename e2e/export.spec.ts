import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch } from './launch';

// A caption with no spaces is wider than its caption box and spills past the scene's own box.
const DOC = {
  entities: [
    { tag: 'Icon', id: 'q', x: 40, y: 40, icon: 'aws-simple-queue-service', texts: [{ text: 'Queue' }] },
    {
      tag: 'Icon',
      id: 'db',
      x: 240,
      y: 40,
      icon: 'aws-dynamodb',
      texts: [{ text: 'email_events_table_v2' }],
    },
  ],
  connections: [{ from: 'q', to: 'db' }],
};

test('PNG and SVG exports contain overflowing caption text plus the margin', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dg-exp-'));
  const { app, page } = await launch({ DG_USER_DATA: join(dir, 'ud'), DG_SAVE_DIR: dir });
  await page.waitForFunction(() => (window as any).__dg);
  await page.evaluate((t) => (window as any).__dg.actions.loadText(t, null), JSON.stringify(DOC));
  await expect.poll(() => page.locator('.hit').count()).toBe(2);
  // Rightmost painted text, relative to the scene's left edge, in CSS px at zoom 1.
  const need = await page.evaluate(() => {
    const scene = document.getElementById('eraser-scene')!;
    const z = (window as any).__dg.ui.getState().zoom;
    const left = scene.getBoundingClientRect().left;
    const r = document.createRange();
    let right = 0;
    const walk = document.createTreeWalker(scene, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      r.selectNodeContents(walk.currentNode);
      right = Math.max(right, (r.getBoundingClientRect().right - left) / z);
    }
    return { right, sceneW: scene.offsetWidth };
  });
  expect(need.right).toBeGreaterThan(need.sceneW); // the case under test really overflows
  await page.evaluate(() => (window as any).__dg.actions.exportPng(1, false));
  await page.evaluate(() => (window as any).__dg.actions.exportSvg(true));
  await expect
    .poll(() => readFileSync(join(dir, 'diagram.png')).length, { timeout: 30_000 })
    .toBeGreaterThan(0);
  const pngWidth = readFileSync(join(dir, 'diagram.png')).readUInt32BE(16);
  expect(pngWidth).toBeGreaterThanOrEqual(Math.ceil(need.right) + 32);
  await expect.poll(() => readFileSync(join(dir, 'diagram.svg'), 'utf8').length).toBeGreaterThan(0);
  const svgWidth = Number(
    readFileSync(join(dir, 'diagram.svg'), 'utf8').match(/<svg[^>]* width="(\d+)"/)![1],
  );
  expect(svgWidth).toBeGreaterThanOrEqual(Math.ceil(need.right) + 32);
  await app.close();
});
