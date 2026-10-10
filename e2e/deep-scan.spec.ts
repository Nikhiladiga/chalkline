import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch } from './launch';

const SHOTS = process.env.DG_SCREENS_DIR;

test('Deep scan shows only for a code folder on Claude Code and persists', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dg-deep-ui-'));
  const ud = join(dir, 'ud');
  mkdirSync(ud);
  const cli = join(dir, 'claude');
  writeFileSync(cli, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const save = (extra: object) =>
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ cliPath: cli, hostedIcons: false, ...extra }));
  save({ provider: 'claude-code', model: 'default' });
  const { app, page } = await launch({ DG_USER_DATA: ud });
  const panel = page.getByTestId('ai-panel');
  const toggle = page.getByRole('switch', { name: 'Deep scan', exact: true });
  const folder = () => page.getByLabel('Diagram source').selectOption('folder');
  const blurb = page.getByTestId('code-folder');
  const EXCERPTS = 'Generate sends selected excerpts to your chosen provider.';
  const DEEP =
    'Deep scan: the CLI reads this folder itself (read-only) and sends what it reads to its provider.';
  try {
    await expect(panel).toBeVisible();
    await expect(toggle).toHaveCount(0);
    await folder();
    await expect(toggle).not.toBeChecked();
    await expect(blurb).toContainText(EXCERPTS);
    await expect(toggle).toHaveAccessibleDescription(
      "Lets Claude Code read this folder (read-only) and send what it reads to Anthropic. Secret files like .env and keys are blocked. Uses your plan's quota and takes longer.",
    );
    // Keyboard operable.
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toBeChecked();
    await expect(blurb).toContainText(DEEP);
    await expect(blurb).not.toContainText(EXCERPTS);
    await expect.poll(() => JSON.parse(readFileSync(join(ud, 'settings.json'), 'utf8')).deepScan).toBe(true);
    if (SHOTS) await panel.screenshot({ path: join(SHOTS, 'deep-scan-claude.png') });
    await page.reload();
    await folder();
    await expect(toggle).toBeChecked();

    // Codex deep scan stays hidden until its manual acceptance gate passes, even with the setting on.
    save({ provider: 'codex', model: 'default', deepScan: true });
    await page.reload();
    await folder();
    await expect(blurb).toContainText(EXCERPTS);
    await expect(toggle).toHaveCount(0);

    // An OpenAI-compatible API preset: no CLI, so no deep scan.
    save({ provider: 'openai', baseUrl: 'http://127.0.0.1:9/v1', model: 'm', deepScan: true });
    await page.reload();
    await folder();
    await expect(blurb).toContainText(EXCERPTS);
    await expect(toggle).toHaveCount(0);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Deep scan explores the folder with read-only tools, shows progress, repairs in isolation and stops', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dg-deep-'));
  const root = join(dir, 'sample-api');
  const ud = join(dir, 'ud');
  const log = join(dir, 'calls.jsonl');
  const cli = join(dir, 'claude');
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(ud, 'icons'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"dependencies":{"express":"4"}}');
  writeFileSync(join(root, 'src/server.ts'), "app.get('/users', () => db.query('select 1'));\n");
  const generated = {
    entities: [
      { tag: 'Icon', id: 'api', x: 40, y: 100, icon: 'server', texts: [{ text: 'API' }] },
      { tag: 'Icon', id: 'db', x: 260, y: 100, icon: 'database', texts: [{ text: 'Database' }] },
    ],
    connections: [{ from: 'api', to: 'db', label: 'SQL read users' }],
  };
  const invalid = { entities: [{ tag: 'Shap', id: 'a', x: 0, y: 0 }], connections: [] };
  writeFileSync(
    cli,
    `#!/usr/bin/env node
const fs=require('fs');let prompt='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>prompt+=s);process.stdin.on('end',()=>{
const args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({prompt,args,cwd:process.cwd(),pid:process.pid})+'\\n');
const out=o=>console.log(JSON.stringify(o));
if(args.includes('--restricted')){
  out({type:'system',subtype:'init',cwd:process.cwd(),tools:['Glob','Grep','Read','StructuredOutput'],permissionMode:'dontAsk'});
  out({type:'assistant',message:{content:[{type:'tool_use',id:'t1',name:'Read',input:{file_path:process.cwd()+'/src/server.ts'}}]},parent_tool_use_id:null});
  if(prompt.includes('STOP_REQUEST'))return setInterval(()=>{},1000);
  return setTimeout(()=>out({type:'result',structured_output:${JSON.stringify(invalid)}}),3000);
}
out({type:'result',structured_output:${JSON.stringify(generated)}});
});`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(ud, 'settings.json'),
    JSON.stringify({
      provider: 'claude-code',
      cliPath: cli,
      model: 'sonnet',
      hostedIcons: false,
      deepScan: true,
    }),
  );
  for (const name of ['server', 'database'])
    writeFileSync(
      join(ud, 'icons', `${name}.svg`),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" fill="#675ee8"/></svg>',
    );
  const calls = () =>
    readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const { app, page } = await launch({ DG_USER_DATA: ud, DG_SAVE_DIR: dir, DG_TEST_PROJECT_DIR: root });
  const stage = page.locator('.stage-line');
  try {
    await page.waitForFunction(() => (window as any).__dg);
    await page.getByLabel('Diagram source').selectOption('folder');
    await page.getByRole('button', { name: 'Choose folder', exact: true }).click();
    // Excerpt-scan coverage does not apply to a deep run: show the deep line instead.
    const coverage = page.locator('.code-folder-coverage');
    await expect(coverage).toHaveText(/^Deep scan: Claude Code explores the folder itself\.\s*Rescan$/);
    await expect(page.getByTestId('code-folder')).not.toContainText('eligible files read');
    await expect(page.getByTestId('code-folder')).not.toContainText('Partial evidence');
    await expect(page.getByRole('switch', { name: 'Deep scan', exact: true })).toBeChecked();
    await page.getByTestId('ai-run').click();
    await expect(stage).toContainText('Reading src/server.ts');
    await expect(page.locator('.hit[data-id="api"]')).toBeVisible();
    await expect(page.getByTestId('ai-outcome')).toContainText('Diagram generated');
    await expect(coverage).toContainText(
      'Deep scan: Claude Code explores the folder itself. Last run: 1 file read.',
    );
    await expect(stage).toHaveCount(0);
    const [first, repair] = calls();
    // The first call really is deep, and no excerpts were sent instead.
    expect(first.cwd).toBe(realpathSync(root));
    expect(first.args).toContain('--restricted');
    expect(first.args[first.args.indexOf('--tools') + 1]).toBe('Read,Grep,Glob');
    expect(first.prompt).not.toContain('app.get');
    expect(first.prompt).not.toContain('Repository evidence');
    // The repair round is the old isolated call.
    expect(repair.args[repair.args.indexOf('--tools') + 1]).toBe('');
    expect(repair.args).not.toContain('--restricted');
    expect(repair.cwd).not.toBe(realpathSync(root));

    await page.getByTestId('ai-prompt').fill('STOP_REQUEST');
    await page.getByTestId('ai-run').click();
    await expect.poll(() => calls().length).toBe(3);
    await expect(stage).toContainText('Reading src/server.ts');
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(page.getByTestId('ai-outcome')).toContainText('Stopped');
    await expect(stage).toHaveCount(0);
    await expect.poll(() => alive(calls()[2].pid)).toBe(false);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
