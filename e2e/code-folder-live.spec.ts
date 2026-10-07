import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch } from './launch';

test('live Codex summarizes the local Typesense Sequelize sample as runtime flows rather than imports', async () => {
  const root = process.env.DG_CODE_FOLDER_SAMPLE;
  test.skip(!root, 'set DG_CODE_FOLDER_SAMPLE to the local Typesense Sequelize sample folder');
  test.setTimeout(240000);
  const dir = mkdtempSync(join(tmpdir(), 'dg-typesense-live-'));
  const ud = join(dir, 'ud');
  mkdirSync(ud);
  const fingerprints = () => {
    const hashes: Record<string, string> = {};
    const walk = (folder: string) => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || ['node_modules', 'dist', 'build'].includes(entry.name)) continue;
        const path = join(folder, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.isFile()) hashes[path] = createHash('sha256').update(readFileSync(path)).digest('hex');
      }
    };
    walk(root!);
    return hashes;
  };
  const before = fingerprints();
  writeFileSync(
    join(ud, 'settings.json'),
    JSON.stringify({ provider: 'codex', model: 'default', hostedIcons: false }),
  );
  const { app, page } = await launch({
    DG_USER_DATA: ud,
    DG_SAVE_DIR: dir,
    DG_TEST_PROJECT_DIR: root!,
    DG_LLM_PROVIDER: 'codex',
    DG_LLM_MODEL: 'default',
  });
  try {
    await page.waitForFunction(() => (window as any).__dg);
    await page.getByLabel('Diagram source').selectOption('folder');
    await page.getByRole('button', { name: 'Choose folder', exact: true }).click();
    await expect(page.getByTestId('code-folder')).toContainText('13 of 13 eligible files read');
    await page.getByTestId('ai-run').click();
    await expect(page.getByTestId('ai-outcome')).toContainText('Diagram generated', { timeout: 200000 });
    const doc = await page.evaluate(() => (window as any).__dg.doc.getState().doc);
    const captions = doc.entities
      .filter((e: any) => e.tag === 'Icon')
      .map((e: any) => e.texts?.map((t: any) => t.text).join(' '))
      .join(' ');
    expect(captions).toMatch(/postgres|postgre|sql/i);
    expect(captions).toMatch(/typesense/i);
    expect(captions).toMatch(/sync|scheduled|cron/i);
    expect(captions).not.toMatch(/book model|typesense client|collection setup/i);
    expect(doc.entities.length).toBeLessThanOrEqual(10);
    expect(doc.connections.length).toBeGreaterThanOrEqual(3);
    for (const connection of doc.connections)
      expect(connection.label ?? '').not.toMatch(/^(?:imports?|requires|depends on)$/i);
    await expect(page.locator('.status')).toContainText('Valid');
    await page.getByText('Fit', { exact: true }).click();
    await page.screenshot({ path: 'test-results/typesense-runtime-architecture.png' });
    writeFileSync('test-results/typesense-runtime-architecture.json', JSON.stringify(doc, null, 2));
    await page.evaluate(() => (window as any).__dg.actions.exportSvg());
    await expect.poll(() => existsSync(join(dir, 'diagram.svg'))).toBe(true);
    expect(fingerprints()).toEqual(before);
    console.log(
      `Typesense sample: ${doc.entities.length} entities, ${doc.connections.length} runtime connections; source unchanged.`,
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('live Codex generates a source-backed API/database/queue architecture from a code folder', async () => {
  test.skip(!process.env.DG_CODE_FOLDER_LIVE, 'set DG_CODE_FOLDER_LIVE=1 to use the installed Codex login');
  test.setTimeout(240000);
  const dir = mkdtempSync(join(tmpdir(), 'dg-code-live-'));
  const root = join(dir, 'reports-service');
  const ud = join(dir, 'ud');
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(ud);
  const source: Record<string, string> = {
    'package.json': JSON.stringify({
      name: 'reports-service',
      scripts: { api: 'node src/server.js', worker: 'node src/worker.js' },
      dependencies: { express: '^4.0.0', pg: '^8.0.0', bullmq: '^5.0.0' },
    }),
    'src/server.js': `import express from 'express';
import { pool } from './store.js';
import { queue } from './queue.js';
const app = express(); app.use(express.json());
app.post('/reports', async (req, res) => { await queue.add('report', req.body); res.status(202).json({status:'queued'}); });
app.get('/reports', async (req, res) => { const result = await pool.query('SELECT id,status FROM reports'); res.json(result.rows); });
app.listen(3000);`,
    'src/store.js': `import pg from 'pg';
export const pool = new pg.Pool({ host: 'postgres', database: 'reports' });`,
    'src/queue.js': `import { Queue } from 'bullmq';
export const connection = { host: 'redis', port: 6379 };
export const queue = new Queue('reports', { connection });`,
    'src/worker.js': `import { Worker } from 'bullmq';
import { pool } from './store.js';
import { connection } from './queue.js';
new Worker('reports', async job => { await pool.query('INSERT INTO reports (id,status) VALUES ($1,$2)',[job.data.id,'complete']); }, { connection });`,
  };
  for (const [path, content] of Object.entries(source)) writeFileSync(join(root, path), content);
  writeFileSync(
    join(ud, 'settings.json'),
    JSON.stringify({ provider: 'codex', model: 'default', hostedIcons: false }),
  );
  const { app, page } = await launch({
    DG_USER_DATA: ud,
    DG_SAVE_DIR: dir,
    DG_TEST_PROJECT_DIR: root,
    DG_LLM_PROVIDER: 'codex',
    DG_LLM_MODEL: 'default',
  });
  try {
    await page.waitForFunction(() => (window as any).__dg);
    await page.getByLabel('Diagram source').selectOption('folder');
    await page.getByRole('button', { name: 'Choose folder', exact: true }).click();
    await expect(page.getByTestId('code-folder')).toContainText('5 of 5 eligible files read');
    await page.getByTestId('ai-run').click();
    await expect(page.getByTestId('ai-outcome')).toBeVisible({ timeout: 200000 });
    await expect(page.getByTestId('ai-outcome')).toContainText('Diagram generated');
    const doc = await page.evaluate(() => (window as any).__dg.doc.getState().doc);
    expect(doc.entities.length).toBeGreaterThanOrEqual(4);
    expect(doc.connections.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(doc)).toMatch(/postgres|postgre|sql/i);
    expect(JSON.stringify(doc)).toMatch(/redis|bullmq/i);
    expect(JSON.stringify(doc)).toMatch(/worker/i);
    expect(JSON.stringify(doc)).not.toMatch(/aws-|aws |vpc/i);
    for (const note of doc.entities.filter(
      (e: any) => e.tag === 'Textbox' && /\.(?:js|json):\d/.test(e.text ?? ''),
    )) {
      expect(note.width).toBeGreaterThanOrEqual(480);
      expect(note.containerId).toBeUndefined();
    }
    await expect(page.locator('.status')).toContainText('Valid');
    await page.getByText('Fit', { exact: true }).click();
    await page.screenshot({ path: 'test-results/code-folder-live.png' });
    await page.evaluate(() => (window as any).__dg.actions.save());
    await page.evaluate(() => (window as any).__dg.actions.exportSvg());
    await expect.poll(() => existsSync(join(dir, 'diagram.svg'))).toBe(true);
    for (const [path, content] of Object.entries(source))
      expect(readFileSync(join(root, path), 'utf8')).toBe(content);
    console.log(
      `Live Codex: ${doc.entities.length} entities, ${doc.connections.length} connections; saved/exported; source unchanged.`,
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
