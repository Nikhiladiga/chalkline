import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import names from '../icons/names.json' with { type: 'json' };
import { launch } from './launch';

test('icon picker keeps tiles readable, scrolls results and applies a searched icon', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dg-icon-picker-'));
  const ud = join(dir, 'ud');
  mkdirSync(join(ud, 'icons'), { recursive: true });
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ hostedIcons: false }));
  for (const name of names)
    writeFileSync(
      join(ud, 'icons', `${name}.svg`),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4" fill="#5e6ad2"/></svg>',
    );
  const { app, page } = await launch({ DG_USER_DATA: ud });
  try {
    await page.waitForFunction(() => (window as any).__dg);
    await page.evaluate(() => {
      const dg = (window as any).__dg;
      dg.actions.loadText(
        JSON.stringify({
          entities: [{ tag: 'Icon', id: 'node', x: 100, y: 100, icon: 'server' }],
          connections: [],
        }),
        null,
      );
      dg.doc.getState().select({ entities: ['node'], connections: [] });
    });
    await page.getByTestId('inspector').getByRole('button', { name: 'server', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'Choose an icon' });
    const grid = modal.locator('.icon-grid');
    await expect(grid.locator('.icon-cell')).toHaveCount(240);
    for (const size of [
      { width: 1440, height: 900 },
      { width: 1000, height: 700 },
    ]) {
      await app.evaluate(
        ({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0]!.setSize(bounds.width, bounds.height),
        size,
      );
      await expect
        .poll(() =>
          grid.locator('.icon-cell').evaluateAll((cells) =>
            cells.every((cell) => {
              const box = cell.getBoundingClientRect();
              return (
                box.height >= 76 &&
                [...cell.children].every((child) => {
                  const r = child.getBoundingClientRect();
                  return r.top >= box.top && r.bottom <= box.bottom;
                })
              );
            }),
          ),
        )
        .toBe(true);
    }
    const search = modal.getByRole('textbox');
    const before = await search.boundingBox();
    await grid.evaluate((el) => {
      el.scrollTop = 500;
    });
    expect(await grid.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect((await search.boundingBox())?.y).toBe(before?.y);
    await page.screenshot({ path: 'test-results/icon-picker.png' });
    await search.fill('aws lambda');
    const chosen = await grid.locator('.icon-cell').first().getAttribute('title');
    await grid.locator('.icon-cell').first().click();
    await expect(modal).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => (window as any).__dg.doc.getState().doc.entities[0].icon))
      .toBe(chosen);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
