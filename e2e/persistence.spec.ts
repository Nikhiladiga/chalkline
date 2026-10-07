import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch } from './launch';

test('invalid code is dirty, recoverable, and never silently saved as the previous diagram', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dg-persistence-'));
  const { app, page } = await launch({ DG_USER_DATA: join(dir, 'ud'), DG_SAVE_DIR: dir });
  try {
    await page.waitForFunction(() => (window as any).__dg);
    await page.evaluate(async () => {
      const dg = (window as any).__dg;
      dg.actions.loadText('{"entities":[],"connections":[]}', null);
      await dg.actions.save();
    });
    const saved = readFileSync(join(dir, 'diagram.json'), 'utf8');
    await page.getByRole('tab', { name: 'Code', exact: true }).click();
    await page.locator('.cm-content').click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.insertText('{"entities": [');
    await expect(page.locator('.file-name')).toContainText('edited');
    await expect.poll(() => page.evaluate(() => window.api.invoke('recovery:read'))).toContain('codeDraft');
    await page.evaluate(() => (window as any).__dg.actions.save());
    await expect(page.getByRole('status')).toContainText('Fix the code');
    expect(readFileSync(join(dir, 'diagram.json'), 'utf8')).toBe(saved);
    await page.getByRole('tab', { name: 'Icons', exact: true }).click();
    await page.getByRole('tab', { name: 'Code', exact: true }).click();
    await expect(page.locator('.cm-content')).toContainText('"entities": [');
    page.once('dialog', (d) => void d.dismiss());
    await page.evaluate(() => (window as any).__dg.actions.newDoc());
    await expect(page.locator('.file-name')).toContainText('edited');
    page.once('dialog', (d) => void d.accept());
    await page.evaluate(() => (window as any).__dg.actions.newDoc());
    await expect(page.locator('.file-name')).not.toContainText('edited');
    await expect.poll(() => page.evaluate(() => window.api.invoke('recovery:read'))).toBeNull();
    await expect(page.locator('.cm-content')).toContainText('"connections": []');
    await page.evaluate(() =>
      (window as any).__dg.actions.restoreRecovery(
        JSON.stringify({
          recoveryVersion: 1,
          doc: { entities: [], connections: [] },
          codeDraft: '{"entities": [',
        }),
      ),
    );
    await expect(page.locator('.cm-content')).toHaveText('{"entities": [');
    await page.locator('.cm-content').click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
    await page.keyboard.insertText(']');
    await expect(page.locator('.cm-content')).toContainText('{"entities": []');
  } finally {
    await app.close();
  }
});

test('a delayed save keeps newer edits dirty and cannot rename a newly opened document', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dg-save-race-'));
  const target = join(dir, 'saved.json');
  const { app, page } = await launch({ DG_USER_DATA: join(dir, 'ud'), DG_SAVE_DIR: '' });
  try {
    await page.waitForFunction(() => (window as any).__dg);
    await app.evaluate(({ dialog }, path) => {
      (dialog as any).showSaveDialog = () =>
        new Promise((resolve) => {
          (globalThis as any).__releaseSave = () => {
            resolve({ canceled: false, filePath: path });
            delete (globalThis as any).__releaseSave;
          };
        });
    }, target);
    for (const newDocument of [false, true]) {
      await page.evaluate(() => {
        const dg = (window as any).__dg;
        dg.actions.loadText('{"entities":[],"connections":[]}', null);
        void dg.actions.save(true);
      });
      await expect.poll(() => app.evaluate(() => Boolean((globalThis as any).__releaseSave))).toBe(true);
      await page.evaluate((replaceDocument) => {
        const store = (window as any).__dg.doc.getState();
        const doc = { entities: [{ tag: 'Shape', id: 'new', x: 40, y: 40 }], connections: [] };
        if (replaceDocument) store.load(doc, '/tmp/different.json');
        else store.commit(doc);
      }, newDocument);
      await app.evaluate(() => (globalThis as any).__releaseSave());
      await expect(page.getByRole('status')).toContainText('Saved saved.json');
      expect(JSON.parse(readFileSync(target, 'utf8')).entities).toEqual([]);
      const state = await page.evaluate(() => {
        const { dirty, filePath, doc } = (window as any).__dg.doc.getState();
        return { dirty, filePath, doc };
      });
      expect(state.filePath).toBe(newDocument ? '/tmp/different.json' : target);
      expect(state.dirty).toBe(!newDocument);
      expect(state.doc.entities[0].id).toBe('new');
      await page.evaluate(() => (window as any).__dg.ui.getState().set({ toast: null }));
    }
  } finally {
    await app.close();
  }
});

test('a failed AI result cannot replace a newer invalid code draft', async () => {
  const server = createServer((req, res) => {
    if (req.url?.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'mock' }] }));
    req.resume();
    req.on('end', () =>
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const content = '{"entities":[{"tag":"NoSuchTag","id":"bad","x":0,"y":0}],"connections":[]}';
        res.end(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`);
      }, 500),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const dir = mkdtempSync(join(tmpdir(), 'dg-ai-draft-'));
  const { app, page } = await launch({
    DG_USER_DATA: join(dir, 'ud'),
    DG_LLM_BASE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    DG_LLM_MODEL: 'mock',
  });
  try {
    await page.waitForFunction(() => (window as any).__dg);
    await page.evaluate(() => window.api.invoke('settings:set', { maxRepairs: 0 }));
    await page.getByTestId('ai-prompt').fill('draw a simple API');
    await page.getByTestId('ai-run').click();
    await page.getByRole('tab', { name: 'Code', exact: true }).click();
    await page.locator('.cm-content').click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.insertText('{"my_unsaved_code": [');
    await expect(page.getByTestId('ai-outcome')).toContainText('kept');
    await expect(page.locator('.cm-content')).toHaveText('{"my_unsaved_code": [');
    expect(await page.evaluate(() => (window as any).__dg.doc.getState().codeDraft)).toBe(
      '{"my_unsaved_code": [',
    );
  } finally {
    await app.close();
    server.close();
  }
});
