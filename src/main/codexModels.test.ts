import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../shared/ipc';
import { listModels } from './llm';

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fakeModels(fail = false) {
  const dir = mkdtempSync(join(tmpdir(), 'dg-codex-models-'));
  dirs.push(dir);
  const bin = join(dir, 'codex');
  const catalog = join(dir, 'catalog.json');
  const log = join(dir, 'log.jsonl');
  writeFileSync(catalog, JSON.stringify(['available-a', 'available-b']));
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require('fs');
const readline = require('readline');
let initialized = false;
readline.createInterface({ input: process.stdin }).on('line', line => {
  const req = JSON.parse(line);
  fs.appendFileSync(${JSON.stringify(log)}, line + '\\n');
  const reply = result => process.stdout.write(JSON.stringify({id: req.id, result}) + '\\n');
  if (req.method === 'initialize') return reply({userAgent: 'fake'});
  if (req.method === 'initialized') { initialized = true; return; }
  if (req.method !== 'model/list') return;
  if (!initialized || ${fail}) {
    process.stdout.write(JSON.stringify({id: req.id, error: {code: -32000, message: 'Please run codex login'}}) + '\\n');
    return;
  }
  const names = JSON.parse(fs.readFileSync(${JSON.stringify(catalog)}, 'utf8'));
  const data = req.params.cursor ? [{model: names[1]}, {model: names[0]}, {model: 'hidden-model', hidden: true}] : [{id: 'catalog-entry', model: names[0]}];
  process.stdout.write('{"method":"unrelated/notification"}\\n');
  const response = JSON.stringify({id: req.id, result: {data, nextCursor: req.params.cursor ? null : 'page-two'}}) + '\\n';
  process.stdout.write(response.slice(0, 12));
  setTimeout(() => process.stdout.write(response.slice(12)), 5);
});
`,
    { mode: 0o755 },
  );
  return { settings: { ...DEFAULT_SETTINGS, provider: 'codex' as const, cliPath: bin }, catalog, log };
}

it('discovers current Codex models, handles pagination and refreshes instead of caching a fixed list', async () => {
  const { settings, catalog, log } = fakeModels();
  expect(await listModels(settings, undefined)).toEqual(['default', 'available-a', 'available-b']);
  const requests = readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(requests.map((req) => req.method)).toEqual([
    'initialize',
    'initialized',
    'model/list',
    'model/list',
  ]);
  expect(requests[2].params.includeHidden).toBe(false);
  expect(requests[3].params.cursor).toBe('page-two');
  writeFileSync(catalog, JSON.stringify(['new-a', 'new-b']));
  expect(await listModels(settings, undefined)).toEqual(['default', 'new-a', 'new-b']);
});

it('shows the CLI error when model discovery fails', async () => {
  const { settings } = fakeModels(true);
  await expect(listModels(settings, undefined)).rejects.toThrow(/codex login/);
});

it('discovers models when Finder omits the Node installation directory from PATH', async () => {
  const { settings } = fakeModels();
  vi.stubEnv('PATH', '/usr/bin:/bin');
  expect(await listModels(settings, undefined)).toEqual(['default', 'available-a', 'available-b']);
});
