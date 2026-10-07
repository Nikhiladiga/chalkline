import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { launch } from './launch';

const DOC = {
  entities: [
    { tag: 'Shape', id: 'web', x: 40, y: 40, width: 140, height: 60, texts: [{ text: 'Web' }] },
    { tag: 'Shape', id: 'api', x: 300, y: 40, width: 140, height: 60, texts: [{ text: 'API' }] },
  ],
  connections: [{ from: 'web', to: 'api' }],
};

let server: Server;
let baseUrl: string;
test.beforeAll(async () => {
  // Slow mock LLM: answers after 1.5 s with DOC plus a "db" node.
  server = createServer((req, res) => {
    if (req.url?.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'mock' }] }));
    req.resume();
    req.on('end', () => {
      const text = JSON.stringify({
        ...DOC,
        entities: [...DOC.entities, { tag: 'Shape', id: 'db', x: 560, y: 40, texts: [{ text: 'DB' }] }],
      });
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`);
      }, 1500);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
test.afterAll(() => server.close());

async function open(): Promise<{ app: Awaited<ReturnType<typeof launch>>['app']; page: Page }> {
  const dir = mkdtempSync(join(tmpdir(), 'dg-edit-'));
  const { app, page } = await launch({
    DG_LLM_BASE_URL: baseUrl,
    DG_LLM_MODEL: 'mock',
    DG_USER_DATA: join(dir, 'ud'),
  });
  await page.waitForFunction(() => (window as any).__dg);
  await page.evaluate((d) => (window as any).__dg.actions.loadText(JSON.stringify(d), null), DOC);
  await expect.poll(() => page.locator('.hit').count()).toBe(2);
  return { app, page };
}
const textOf = (page: Page, id: string) =>
  page.evaluate(
    (i) => (window as any).__dg.doc.getState().doc.entities.find((e: any) => e.id === i)?.texts?.[0]?.text,
    id,
  );
const emptySpot = async (page: Page) => {
  const c = (await page.locator('.canvas').boundingBox())!;
  return { x: c.x + 10, y: c.y + c.height - 60 };
};

test('inline text edit is kept when clicking away on the canvas', async () => {
  const { app, page } = await open();
  await page.locator('.hit[data-id="web"]').dblclick();
  await page.locator('.text-edit').fill('Frontend');
  const p = await emptySpot(page);
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => textOf(page, 'web')).toBe('Frontend');
  await app.close();
});

test('inspector text edit is kept when clicking away on the canvas', async () => {
  const { app, page } = await open();
  await page.locator('.hit[data-id="api"]').click();
  const field = page.getByTestId('inspector').locator('textarea').first();
  await field.fill('Backend API');
  const p = await emptySpot(page);
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => textOf(page, 'api')).toBe('Backend API');
  await app.close();
});

test('an AI result does not silently overwrite edits made while it was running', async () => {
  const { app, page } = await open();
  await page.getByTestId('ai-prompt').fill('add a database');
  await page.getByTestId('ai-run').click();
  // The user keeps working while the model runs.
  await page.evaluate(() => {
    const s = (window as any).__dg.doc.getState();
    s.commit({
      ...s.doc,
      entities: [...s.doc.entities, { tag: 'Shape', id: 'mine', x: 40, y: 300, texts: [{ text: 'Mine' }] }],
    });
  });
  let asked = '';
  page.once('dialog', (d) => {
    asked = d.message();
    void d.dismiss();
  });
  await expect(page.getByTestId('ai-outcome')).toBeVisible({ timeout: 15_000 });
  expect(asked).toMatch(/changed/i);
  const ids = await page.evaluate(() =>
    (window as any).__dg.doc.getState().doc.entities.map((e: any) => e.id),
  );
  expect(ids).toContain('mine');
  expect(ids).not.toContain('db');
  await app.close();
});

test('theme switches apply and are saved without a diagram style selector', async () => {
  const { app, page } = await open();
  await expect(page.locator('.canvas')).toHaveClass(/dark/);
  await page.getByTestId('theme-toggle').click();
  await expect(page.locator('.canvas')).toHaveClass(/light/);
  await expect(page.getByTestId('style-detailed')).toHaveCount(0);
  await expect(page.getByTestId('style-simple')).toHaveCount(0);
  const saved = await page.evaluate(() => window.api.invoke('settings:get'));
  expect(saved).toMatchObject({ theme: 'light' });
  expect(saved).not.toHaveProperty('aiStyle');
  await app.close();
});

test('side panes collapse to a rail and open again', async () => {
  const { app, page } = await open();
  for (const side of ['left', 'right']) {
    await page.getByTestId(`toggle-${side}`).click();
    await expect(page.locator(`.pane.${side} .pane-body:visible`)).toHaveCount(0);
    await page.getByTestId(`toggle-${side}`).click();
    await expect(page.locator(`.pane.${side} .pane-body:visible`)).toHaveCount(1);
  }
  await app.close();
});

test('an icon caption counts toward its painted footprint', async () => {
  const { app, page } = await open();
  const stacked = {
    entities: [
      { tag: 'Icon', id: 'p', x: 100, y: 100, icon: 'docker', texts: [{ text: 'Container 1' }] },
      { tag: 'Icon', id: 'q', x: 100, y: 160, icon: 'docker', texts: [{ text: 'Container 2' }] },
    ],
    connections: [],
  };
  await page.evaluate((d) => (window as any).__dg.actions.loadText(JSON.stringify(d), null), stacked);
  await expect.poll(() => page.locator('.hit').count()).toBe(2);
  const r = await page.evaluate(() => {
    const dg = (window as any).__dg;
    const ui = dg.ui.getState();
    return {
      painted: ui.render.painted.p,
      box: ui.render.boxes.p,
      overlaps: dg.checkLayout(dg.doc.getState().doc, ui.render.painted).overlaps,
    };
  });
  expect(r.painted.height).toBeGreaterThan(r.box.height + 10); // caption below the glyph
  expect(r.overlaps).toEqual([['p', 'q']]);
  await app.close();
});

test('code editor suggests element templates and property values', async () => {
  const { app, page } = await open();
  await page.getByRole('tab', { name: 'Code', exact: true }).click();
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${mod}+A`);
  await page.keyboard.insertText('{\n  "entities": [\n    ');
  await page.keyboard.type('Ico');
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('Icon');
  await page.keyboard.press('Enter'); // inserts the Icon template, id field selected
  await page.keyboard.press('Escape');
  await page.keyboard.press(`${mod}+ArrowDown`);
  await page.keyboard.insertText('\n  ],\n  "connections": []\n}');
  await expect
    .poll(() => page.evaluate(() => (window as any).__dg.doc.getState().doc.entities.map((e: any) => e.tag)))
    .toEqual(['Icon']);
  // Value suggestions: put the cursor inside the icon string and ask for suggestions.
  await page.locator('.cm-line', { hasText: '"icon": "server"' }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft'); // before the closing quote, after "server
  await page.keyboard.press('Control+Space');
  await expect(page.locator('.cm-tooltip-autocomplete li').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/completions.png' });
  await app.close();
});
