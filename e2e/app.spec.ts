import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { launch } from './launch';

const GENERATED = {
  entities: [
    { tag: 'Icon', id: 'client', x: 40, y: 160, icon: 'user', texts: [{ text: 'Client' }] },
    { tag: 'Icon', id: 'api-gateway', x: 200, y: 160, icon: 'api-gateway', texts: [{ text: 'API Gateway' }] },
    {
      tag: 'Group',
      id: 'vpc',
      x: 340,
      y: 60,
      width: 420,
      height: 300,
      title: { text: 'VPC', icon: 'aws-vpc' },
    },
    {
      tag: 'Icon',
      id: 'lambda',
      x: 400,
      y: 160,
      icon: 'lambda',
      containerId: 'vpc',
      texts: [{ text: 'Lambda' }],
    },
    {
      tag: 'Icon',
      id: 'table',
      x: 620,
      y: 100,
      icon: 'aws-dynamodb',
      containerId: 'vpc',
      texts: [{ text: 'DynamoDB' }],
    },
    { tag: 'Icon', id: 'bucket', x: 620, y: 240, icon: 's3', containerId: 'vpc', texts: [{ text: 'S3' }] },
  ],
  connections: [
    { from: 'client', to: 'api-gateway' },
    { from: 'api-gateway', to: 'lambda' },
    { from: 'lambda', to: 'table' },
    { from: 'lambda', to: 'bucket' },
  ],
};
// The edit reply moves "client" (must be ignored) and adds a cache on top of "lambda" (must be nudged).
const EDITED = {
  entities: [
    ...GENERATED.entities.map((e) => (e.id === 'client' ? { ...e, x: 900, y: 900 } : e)),
    {
      tag: 'Icon',
      id: 'cache',
      x: 400,
      y: 160,
      icon: 'redis',
      containerId: 'vpc',
      texts: [{ text: 'Redis' }],
    },
  ],
  connections: [...GENERATED.connections, { from: 'lambda', to: 'cache' }],
};

let server: Server;
let baseUrl: string;
const requests: any[] = [];

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (req.url?.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }));
      const body = JSON.parse(raw);
      requests.push(body);
      const last = body.messages.at(-1).content as string;
      const doc = last.includes('Change request') ? EDITED : GENERATED;
      const text = JSON.stringify(doc);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (let i = 0; i < text.length; i += 200)
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(i, i + 200) } }] })}\n\n`,
        );
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
test.afterAll(() => server.close());

const docOf = (page: Page) => page.evaluate(() => (window as any).__dg.doc.getState().doc);
const renderOf = (page: Page) =>
  page.evaluate(() => {
    const r = (window as any).__dg.ui.getState().render;
    return (
      r && {
        boxes: r.boxes,
        paths: Object.fromEntries(Object.entries(r.connections).map(([k, v]: any) => [k, v.d])),
        ids: r.connectionIds,
      }
    );
  });
const settle = (page: Page) => page.waitForTimeout(600);

test('generate → edit → drag → connect → save/reopen → export PNG and SVG', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dg-e2e-'));
  const { app, page } = await launch({
    DG_LLM_BASE_URL: baseUrl,
    DG_LLM_MODEL: 'mock-model',
    DG_USER_DATA: join(dir, 'ud'),
    DG_SAVE_DIR: dir,
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // 1. Generate from natural language.
  await page
    .getByTestId('ai-prompt')
    .fill('AWS serverless API: API Gateway, Lambda, DynamoDB and S3 inside a VPC');
  await page.getByTestId('ai-run').click();
  await expect(page.getByTestId('ai-outcome')).toContainText('Diagram', { timeout: 30_000 });
  let doc = await docOf(page);
  expect(doc.entities).toHaveLength(6);
  expect(doc.entities.find((e: any) => e.id === 'lambda').icon).toBe('aws-lambda'); // alias fix-up
  expect(requests[0].response_format.type).toBe('json_schema');
  await settle(page);
  expect(await page.locator('.hit').count()).toBe(6);

  // 2. Edit with natural language: existing positions kept, the new node placed in free space.
  const before = Object.fromEntries(doc.entities.map((e: any) => [e.id, [e.x, e.y]]));
  await page.getByTestId('ai-prompt').fill('add a redis cache next to the lambda');
  await page.getByTestId('ai-run').click();
  await expect(page.getByTestId('ai-outcome')).toContainText('updated', { timeout: 30_000 });
  doc = await docOf(page);
  for (const [id, xy] of Object.entries(before))
    expect([
      doc.entities.find((e: any) => e.id === id).x,
      doc.entities.find((e: any) => e.id === id).y,
    ]).toEqual(xy);
  const cache = doc.entities.find((e: any) => e.id === 'cache');
  expect(cache).toBeTruthy();
  await settle(page);
  const afterEdit = await renderOf(page);
  const overlap = (a: any, b: any) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  expect(overlap(afterEdit.boxes.cache, afterEdit.boxes.lambda)).toBe(false);

  // 3. Drag the Lambda: it moves, and its connections re-route. Fit the view first (Shift+1).
  await page.locator('.canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Shift+Digit1');
  await settle(page);
  const lambdaBefore = doc.entities.find((e: any) => e.id === 'lambda');
  const pathBefore = afterEdit.paths[afterEdit.ids[1]];
  const hit = page.locator('.hit[data-id="lambda"]');
  const box = (await hit.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++)
    await page.mouse.move(box.x + box.width / 2 + i * 4, box.y + box.height / 2 + i * 8);
  await page.mouse.up();
  await settle(page);
  doc = await docOf(page);
  const lambdaAfter = doc.entities.find((e: any) => e.id === 'lambda');
  expect(lambdaAfter.y).toBeGreaterThan(lambdaBefore.y + 20);
  expect(lambdaAfter.containerId).toBe('vpc');
  const afterDrag = await renderOf(page);
  expect(afterDrag.paths[afterDrag.ids[1]]).not.toBe(pathBefore);
  // One undo step restores the original position.
  await page.locator('.canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Meta+z');
  await settle(page);
  expect((await docOf(page)).entities.find((e: any) => e.id === 'lambda').y).toBe(lambdaBefore.y);

  // 4. Connect two elements by hand with the link handle.
  await page.locator('.hit[data-id="client"]').click();
  const handle = (await page.locator('.connection-port[data-id="client"][data-port="right"]').boundingBox())!;
  const target = (await page.locator('.hit[data-id="bucket"]').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
  await page.mouse.up();
  doc = await docOf(page);
  expect(doc.connections.some((c: any) => c.from === 'client' && c.to === 'bucket')).toBe(true);

  // 5. Save → reopen round-trips the exact document.
  await page.evaluate(() => (window as any).__dg.actions.save());
  await expect.poll(() => existsSync(join(dir, 'diagram.json'))).toBe(true);
  const saved = JSON.parse(readFileSync(join(dir, 'diagram.json'), 'utf8'));
  expect(saved).toEqual(doc);
  await page.evaluate(() =>
    (window as any).__dg.doc.getState().load({ entities: [], connections: [] }, null),
  );
  await page.evaluate(
    async (p) => {
      const f = await window.api.invoke('file:openPath', p);
      (window as any).__dg.actions.loadText(f.content, f.path);
    },
    join(dir, 'diagram.json'),
  );
  expect(await docOf(page)).toEqual(doc);
  await settle(page);

  // 6. Export PNG (2x) and SVG — no watermark text anywhere.
  await page.getByTestId('export-menu').click();
  await page.getByTestId('export-png-2x').click();
  await expect.poll(() => existsSync(join(dir, 'diagram.png')), { timeout: 30_000 }).toBe(true);
  // The hidden export window is cleaned up.
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  const png = readFileSync(join(dir, 'diagram.png'));
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  const width = png.readUInt32BE(16);
  const r = await page.evaluate(() => (window as any).__dg.ui.getState().render.bounds);
  expect(width).toBe((Math.ceil(r.width) + 2 * 32) * 2); // scene + 32px margin each side, at 2x

  await page.getByTestId('export-menu').click();
  await page.getByTestId('export-svg').click();
  await expect.poll(() => existsSync(join(dir, 'diagram.svg'))).toBe(true);
  const svg = readFileSync(join(dir, 'diagram.svg'), 'utf8');
  expect(svg).toContain('<foreignObject');
  expect(svg).toMatch(/url\('?data:font\/woff2/);
  expect(svg).toContain(`width="${Math.ceil(r.width) + 64}"`);
  expect(svg.toLowerCase()).not.toMatch(/watermark|made with|eraser\.io/);

  expect(errors).toEqual([]);
  await app.close();
});
