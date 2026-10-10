import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import { launch } from './launch';

// A synthetic copy of the deep-scan diagram that made dragging lag: 25 entities (20 icons, 4 groups, a
// note) and 32 labelled connections, with generic ids and labels.
const LARGE = JSON.parse(readFileSync('e2e/fixtures/large-diagram.json', 'utf8'));

let app: ElectronApplication | undefined;
let dir: string | undefined;
test.afterEach(async () => {
  await app?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
  app = undefined;
  dir = undefined;
});

/** Open the large fixture and count engine runs (`__perf.runs`) and landed render times (`__perf.landed`). */
async function openLarge(): Promise<Page> {
  dir = mkdtempSync(join(tmpdir(), 'dg-perf-'));
  // Light theme: the unbounded reference render below is unthemed, and light is the identity theme.
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ hostedIcons: false, theme: 'light' }));
  const launched = await launch({ DG_USER_DATA: dir, DG_LLM_BASE_URL: 'http://127.0.0.1:1/v1' });
  app = launched.app;
  const page = launched.page;
  await page.waitForFunction(() => (window as any).__dg);
  await page.evaluate((d) => (window as any).__dg.actions.loadText(JSON.stringify(d), null), LARGE);
  await page.waitForFunction(
    () => {
      const s = (window as any).__dg.ui.getState();
      return s.render?.connectionIds.length === 32 && !s.fitPending;
    },
    null,
    { timeout: 60_000 },
  );
  await page.evaluate(() => {
    const w = window as any;
    w.__perf = { runs: 0, landed: [] as number[], lat: [] as number[] };
    const P = w.__perf;
    const run = w.__eraser.run;
    w.__eraser.run = (...a: unknown[]) => {
      P.runs++;
      return run.apply(w.__eraser, a);
    };
    w.__dg.ui.subscribe((s: any, p: any) => {
      if (s.render && s.render !== p.render) P.landed.push(s.render.ms);
    });
  });
  return page;
}

const pct = (a: number[], p: number) =>
  [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))]!;

/** Render the same document again and return how long the render took. */
const rerender = (page: Page) =>
  page.evaluate(async () => {
    const ui = (window as any).__dg.ui;
    const before = ui.getState().render;
    ui.setState({ renderTick: ui.getState().renderTick + 1 });
    while (ui.getState().render === before) await new Promise((r) => setTimeout(r, 10));
    return ui.getState().render.ms as number;
  });

/** Route segments that cross an element other than the connection's own ends (containers excepted). */
const routeCuts = (page: Page) =>
  page.evaluate(() => {
    const dg = (window as any).__dg;
    const r = dg.ui.getState().render;
    const doc = dg.doc.getState().doc;
    const containers = new Set(doc.entities.map((e: any) => e.containerId).filter(Boolean));
    let cuts = 0;
    doc.connections.forEach((c: any, i: number) => {
      const pts: [number, number][] = r.connections[r.connectionIds[i]]?.points ?? [];
      for (const [id, b] of Object.entries<any>(r.boxes)) {
        if (id === c.from || id === c.to || containers.has(id)) continue;
        for (let k = 1; k < pts.length; k++) {
          const [[ax, ay], [bx, by]] = [pts[k - 1]!, pts[k]!];
          const crosses =
            Math.min(ax, bx) < b.x + b.width - 1 &&
            Math.max(ax, bx) > b.x + 1 &&
            Math.min(ay, by) < b.y + b.height - 1 &&
            Math.max(ay, by) > b.y + 1;
          if (crosses) cuts++;
        }
      }
    });
    return cuts;
  });

test('a large diagram renders in under 300 ms with routes as clean as the unbounded router', async () => {
  const page = await openLarge();
  const times = [await rerender(page), await rerender(page), await rerender(page)];
  console.log(`idle render ms: ${times.join(', ')}`);
  expect(pct(times, 0.5)).toBeLessThan(300);
  const bounded = await routeCuts(page);
  await page.screenshot({ path: 'test-results/route-quality-bounded.png' });
  // Reference: the same document with upstream's unbounded repair (not themed; compare routes only).
  await page.evaluate(async () => {
    const dg = (window as any).__dg;
    const r = await dg.render(dg.doc.getState().doc, { repairTimeBudgetMs: Number.POSITIVE_INFINITY });
    if (r.ok) dg.ui.getState().set({ render: r });
  });
  const unbounded = await routeCuts(page);
  await page.screenshot({ path: 'test-results/route-quality-unbounded.png' });
  console.log(`route cuts: bounded ${bounded}, unbounded ${unbounded}`);
  expect(bounded).toBeLessThanOrEqual(unbounded);
});

test('dragging in a large diagram previews without rendering and settles in one fast render', async () => {
  const page = await openLarge();
  await page.evaluate(() => {
    const P = (window as any).__perf;
    // Main-thread time from each pointermove to the next frame: what a user feels as drag lag.
    window.addEventListener(
      'pointermove',
      (e) => {
        const t0 = e.timeStamp;
        requestAnimationFrame(() => P.lat.push(performance.now() - t0));
      },
      true,
    );
  });
  const hit = page.locator('.hit[data-id="node-20"]');
  const box = (await hit.boundingBox())!;
  const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
  const zoom: number = await page.evaluate(() => (window as any).__dg.ui.getState().zoom);
  const xOf = () =>
    page.evaluate(
      () => (window as any).__dg.doc.getState().doc.entities.find((e: any) => e.id === 'node-20').x as number,
    );
  const x0 = await xOf();
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) {
    await page.mouse.move(cx + i * 6, cy + i * 3);
    await page.waitForTimeout(16);
  }
  const during = await page.evaluate(() => (window as any).__perf);
  expect(during.runs).toBe(0); // no engine render while dragging
  expect(Math.abs((await hit.boundingBox())!.x - (box.x + 180))).toBeLessThan(8); // the preview follows
  await expect(page.locator('.preview-line').first()).toBeAttached(); // incident lines are stand-ins
  console.log(
    `move→frame ms: p50 ${pct(during.lat, 0.5).toFixed(1)}, p90 ${pct(during.lat, 0.9).toFixed(1)}`,
  );
  expect(pct(during.lat, 0.5)).toBeLessThan(16);
  expect(pct(during.lat, 0.9)).toBeLessThan(33);
  await page.mouse.up();
  await page.waitForFunction(() => (window as any).__perf.landed.length > 0, null, { timeout: 10_000 });
  const drops: number[] = [await page.evaluate(() => (window as any).__perf.landed[0])];
  expect(Math.abs((await xOf()) - x0 - 180 / zoom)).toBeLessThanOrEqual(Math.ceil(6 / zoom) + 1);
  await expect(page.locator('[data-preview], .preview-line')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__dg.doc.getState().past.length)).toBe(1);
  // Two more drops: a single sample is noisy, so judge the median.
  for (let n = 0; n < 2; n++) {
    await page.waitForTimeout(300); // let the previous render's follow-ups settle
    const seen: number = await page.evaluate(() => (window as any).__perf.landed.length);
    const b = (await hit.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 - 60, b.y + b.height / 2 - 30, { steps: 10 });
    await page.mouse.up();
    await page.waitForFunction((k) => (window as any).__perf.landed.length > k, seen, { timeout: 10_000 });
    drops.push(await page.evaluate((k) => (window as any).__perf.landed[k], seen));
  }
  console.log(`drop render ms: ${drops.join(', ')}`);
  expect(pct(drops, 0.5)).toBeLessThan(500);
});

test('resizing in a large diagram shows an outline and renders once, on release', async () => {
  const page = await openLarge();
  await page.locator('.hit[data-id="zone-03"]').click({ position: { x: 8, y: 8 } });
  const h = (await page.getByTestId('resize-handle').boundingBox())!;
  await page.evaluate(() => {
    (window as any).__perf.runs = 0;
  });
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + 60, h.y + 40, { steps: 10 });
  await expect(page.getByTestId('resize-preview')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__perf.runs)).toBe(0);
  await page.mouse.up();
  await expect(page.getByTestId('resize-preview')).toHaveCount(0);
  const zone = () =>
    page.evaluate(() =>
      (window as any).__dg.doc.getState().doc.entities.find((e: any) => e.id === 'zone-03'),
    );
  await expect.poll(async () => (await zone()).width).toBeGreaterThan(300);
  expect(await page.evaluate(() => (window as any).__dg.doc.getState().past.length)).toBe(1);
  // Escape mid-resize changes nothing.
  const before = await zone();
  const h2 = (await page.getByTestId('resize-handle').boundingBox())!;
  await page.mouse.move(h2.x + h2.width / 2, h2.y + h2.height / 2);
  await page.mouse.down();
  await page.mouse.move(h2.x + 50, h2.y + 50, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.getByTestId('resize-preview')).toHaveCount(0);
  expect(await zone()).toEqual(before);
});
