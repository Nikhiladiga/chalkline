import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch } from './launch';

test('a selected code folder generates through its harness, rescans edits, exports and stops without changing source', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dg-folder-'));
  const root = join(dir, 'sample-api');
  const ud = join(dir, 'ud');
  const log = join(dir, 'calls.jsonl');
  const cli = join(dir, 'claude');
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(ud, 'icons'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"dependencies":{"express":"4","pg":"8"}}');
  const source =
    "import express from 'express';\nimport { db } from './db';\napp.get('/users', () => db.query('select id from users'));\n";
  writeFileSync(join(root, 'src/server.ts'), source);
  writeFileSync(join(root, 'src/db.ts'), "import { Pool } from 'pg';\nconst password = 'do-not-send-me';");
  writeFileSync(join(root, '.env'), 'API_KEY=secret-env');
  writeFileSync(join(root, '.gitignore'), 'private.ts\n');
  writeFileSync(join(root, 'private.ts'), 'secret-ignored');
  const generated = {
    entities: [
      { tag: 'Icon', id: 'api', x: 40, y: 100, icon: 'server', texts: [{ text: 'API' }] },
      { tag: 'Icon', id: 'db', x: 260, y: 100, icon: 'database', texts: [{ text: 'Database' }] },
    ],
    connections: [{ from: 'api', to: 'db', label: 'SQL' }],
  };
  const updated = {
    entities: [
      generated.entities[0],
      { tag: 'Icon', id: 'worker', x: 260, y: 100, icon: 'server', texts: [{ text: 'Worker' }] },
    ],
    connections: [{ from: 'api', to: 'worker', label: 'Jobs' }],
  };
  writeFileSync(
    cli,
    `#!/usr/bin/env node
const fs=require('fs');let prompt='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>prompt+=s);process.stdin.on('end',()=>{
const args=process.argv.slice(2);const system=fs.readFileSync(args[args.indexOf('--system-prompt-file')+1],'utf8');
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({prompt,system,args,cwd:process.cwd()})+'\\n');
if(prompt.includes('STOP_REQUEST'))return setTimeout(()=>console.log(JSON.stringify({type:'result',structured_output:${JSON.stringify(updated)}})),20000);
if(prompt.includes('FAIL_REQUEST'))return console.log(JSON.stringify({type:'result',is_error:true,result:'fixture failure'}));
console.log(JSON.stringify({type:'result',structured_output:prompt.includes('QUEUE_CHANGED')?${JSON.stringify(updated)}:${JSON.stringify(generated)}}));
});`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(ud, 'settings.json'),
    JSON.stringify({ provider: 'claude-code', cliPath: cli, model: 'sonnet', hostedIcons: false }),
  );
  for (const name of ['server', 'database'])
    writeFileSync(
      join(ud, 'icons', `${name}.svg`),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" fill="#675ee8"/></svg>',
    );
  const { app, page } = await launch({ DG_USER_DATA: ud, DG_SAVE_DIR: dir, DG_TEST_PROJECT_DIR: root });
  try {
    await page.waitForFunction(() => (window as any).__dg);
    await page.getByLabel('Diagram source').selectOption('folder');
    await page.getByRole('button', { name: 'Choose folder', exact: true }).click();
    await expect(page.getByTestId('code-folder')).toContainText('3 of 3 eligible files read');
    expect(existsSync(log)).toBe(false);
    expect(await page.evaluate(() => (window as any).__dg.doc.getState().doc.entities.length)).toBe(0);
    await page.getByTestId('ai-run').click();
    await expect(page.locator('.hit[data-id="api"]')).toBeVisible();
    await expect(page.getByTestId('ai-outcome')).toContainText('Diagram generated');
    const first = JSON.parse(readFileSync(log, 'utf8').trim().split('\n')[0]!);
    expect(first.prompt).toContain('src/server.ts');
    expect(first.prompt).toContain('app.get');
    expect(first.prompt).toContain('[REDACTED]');
    for (const hidden of ['do-not-send-me', 'secret-env', 'secret-ignored'])
      expect(first.prompt).not.toContain(hidden);
    expect(first.system).toContain('untrusted evidence');
    expect(first.args[first.args.indexOf('--model') + 1]).toBe('sonnet');
    expect(first.args[first.args.indexOf('--tools') + 1]).toBe('');
    expect(first.cwd).not.toBe(root);
    expect(readFileSync(join(root, 'src/server.ts'), 'utf8')).toBe(source);
    const original = await page.evaluate(() => (window as any).__dg.doc.getState().doc);
    rmSync(join(root, 'src/db.ts'));
    writeFileSync(join(root, 'src/worker.ts'), "queue.subscribe('QUEUE_CHANGED');");
    await page.getByTestId('ai-run').click();
    await expect(page.locator('.hit[data-id="worker"]')).toBeVisible();
    await expect(page.locator('.hit[data-id="db"]')).toHaveCount(0);
    await expect(page.getByTestId('ai-outcome')).toContainText('Diagram updated');
    const next = await page.evaluate(() => (window as any).__dg.doc.getState().doc);
    expect(next.entities.find((e: any) => e.id === 'api')).toEqual(
      original.entities.find((e: any) => e.id === 'api'),
    );
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    expect(await page.evaluate(() => (window as any).__dg.doc.getState().doc)).toEqual(original);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await page.evaluate(() => (window as any).__dg.actions.save());
    expect(JSON.parse(readFileSync(join(dir, 'diagram.json'), 'utf8'))).toEqual(next);
    await page.evaluate(() => (window as any).__dg.actions.exportSvg());
    await expect.poll(() => existsSync(join(dir, 'diagram.svg'))).toBe(true);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(900, 600));
    await page.getByText('Fit', { exact: true }).click();
    await page.screenshot({ path: 'test-results/code-folder.png' });
    await page.getByTestId('ai-prompt').fill('STOP_REQUEST');
    await page.getByTestId('ai-run').click();
    await expect.poll(() => readFileSync(log, 'utf8').trim().split('\n').length).toBe(3);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(page.getByTestId('ai-outcome')).toContainText('Stopped');
    expect(await page.evaluate(() => (window as any).__dg.doc.getState().doc)).toEqual(next);
    await page.getByTestId('ai-prompt').fill('FAIL_REQUEST');
    await page.getByTestId('ai-run').click();
    await expect(page.getByTestId('ai-outcome')).toContainText('fixture failure');
    expect(await page.evaluate(() => (window as any).__dg.doc.getState().doc)).toEqual(next);
    expect(readFileSync(join(root, 'src/server.ts'), 'utf8')).toBe(source);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
