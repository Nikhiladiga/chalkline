import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { RESPONSE_SCHEMA } from '../renderer/ai/prompt';
import { DEFAULT_SETTINGS } from '../shared/ipc';
import { deepLimits } from './claudeCli';
import { chat } from './llm';

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fake(mode = 'ok') {
  const dir = mkdtempSync(join(tmpdir(), 'dg-fake-codex-'));
  dirs.push(dir);
  const bin = join(dir, 'codex');
  const log = join(dir, 'log.json');
  writeFileSync(
    bin,
    `#!/usr/bin/env node
let stdin = '';
process.stdin.on('data', c => stdin += c);
process.stdin.on('end', () => {
  const fs = require('fs');
  const args = process.argv.slice(2);
  if (${JSON.stringify(mode)} === 'strict' && args.includes('--output-schema')) {
    const schema = JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema') + 1], 'utf8'));
    if (schema.additionalProperties !== false) {
      process.stderr.write("Invalid schema for response_format 'codex_output_schema': 'additionalProperties' is required to be supplied and to be false.");
      process.exit(1);
    }
  }
  fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ args, stdin, cwd: process.cwd(), schema: args.includes('--output-schema') ? JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema') + 1], 'utf8')) : null }));
  if (${JSON.stringify(mode)} === 'hang') return setInterval(() => {}, 1000);
  if (${JSON.stringify(mode)} === 'error') { process.stderr.write('Please run codex login'); process.exit(1); }
  if (${JSON.stringify(mode)} === 'old') { process.stderr.write("error: unexpected argument '-C' found"); process.exit(2); }
  if (${JSON.stringify(mode)} === 'deep') process.stdout.write(JSON.stringify({type: 'item.started', item: {id: 'item_1', type: 'command_execution', command: 'bash -lc ls', status: 'in_progress'}}) + '\\n');
  const event = JSON.stringify({type: 'item.completed', item: {type: 'agent_message', text: '{"entities":[]}'}});
  process.stdout.write(event.slice(0, 20));
  setTimeout(() => process.stdout.write(event.slice(20) + '\\n' + JSON.stringify({type: 'turn.completed'})), 10);
});
`,
    { mode: 0o755 },
  );
  return { s: { ...DEFAULT_SETTINGS, provider: 'codex' as const, cliPath: bin, model: 'default' }, log };
}

it('accepts the real open-ended diagram schema without sending it as a strict output schema', async () => {
  const { s, log } = fake('strict');
  await expect(
    chat(
      s,
      undefined,
      {
        messages: [{ role: 'user', content: 'Draw a VPC with titled groups and icons' }],
        schema: RESPONSE_SCHEMA,
      },
      () => {},
      new AbortController().signal,
    ),
  ).resolves.toBe('{"entities":[]}');
  const run = JSON.parse(readFileSync(log, 'utf8'));
  expect(run.args).not.toContain('--output-schema');
  expect(run.stdin).toContain(JSON.stringify(RESPONSE_SCHEMA));
});

it('runs a Node-based Codex launcher when Finder omits Node from PATH', async () => {
  const { s } = fake();
  vi.stubEnv('PATH', '/usr/bin:/bin');
  await expect(
    chat(
      s,
      undefined,
      { messages: [{ role: 'user', content: 'Draw a diagram' }] },
      () => {},
      new AbortController().signal,
    ),
  ).resolves.toBe('{"entities":[]}');
});

it('runs Codex with login, conversation, schema and read-only sandbox and returns its answer', async () => {
  const { s, log } = fake();
  const chunks: string[] = [];
  expect(
    await chat(
      s,
      undefined,
      {
        messages: [
          { role: 'system', content: 'Draw diagrams' },
          { role: 'user', content: 'Draw a VPC' },
        ],
        schema: { type: 'object' },
      },
      (t) => chunks.push(t),
      new AbortController().signal,
    ),
  ).toBe('{"entities":[]}');
  expect(chunks).toEqual(['{"entities":[]}']);
  const run = JSON.parse(readFileSync(log, 'utf8'));
  expect(run.args).toEqual(
    expect.arrayContaining([
      'exec',
      '--json',
      '--ephemeral',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--ignore-user-config',
      '--ignore-rules',
      'shell_tool',
      'unified_exec',
      'plugins',
      'apps',
      'hooks',
      'computer_use',
      'browser_use',
      'browser_use_external',
      'multi_agent',
      'goals',
      'view_image',
      'web_search="disabled"',
      'project_doc_max_bytes=0',
    ]),
  );
  expect(run.args).not.toContain('--model');
  expect(run.stdin).toContain('Draw diagrams');
  expect(run.stdin).toContain('Draw a VPC');
  expect(run.args).not.toContain('--output-schema');
  expect(run.schema).toBeNull();
  expect(run.stdin).toContain(JSON.stringify({ type: 'object' }));
  expect(() => readFileSync(join(run.cwd, 'schema.json'))).toThrow();
});

it('reports login errors and supports cancellation, including before spawn', async () => {
  const { s } = fake('error');
  const req = { messages: [{ role: 'user' as const, content: 'hi' }] };
  await expect(chat(s, undefined, req, () => {}, new AbortController().signal)).rejects.toThrow(
    /codex login/,
  );
  const ac = new AbortController();
  ac.abort();
  await expect(chat(s, undefined, req, () => {}, ac.signal)).rejects.toMatchObject({ name: 'AbortError' });
  const hanging = fake('hang');
  const running = new AbortController();
  const p = chat(hanging.s, undefined, req, () => {}, running.signal);
  setTimeout(() => running.abort(), 100);
  await expect(p).rejects.toMatchObject({ name: 'AbortError' });
});

const project = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'dg-codex-project-')));
  dirs.push(dir);
  return dir;
};
const ask = (s: typeof DEFAULT_SETTINGS, cwd?: string) =>
  chat(
    s,
    undefined,
    { messages: [{ role: 'user', content: 'Map it' }] },
    () => {},
    new AbortController().signal,
    { cwd },
  );
const FEATURES = ['plugins', 'apps', 'hooks', 'computer_use', 'browser_use', 'browser_use_external'];
const MORE = ['multi_agent', 'goals', 'view_image', 'sleep_tool'];
const disables = (list: string[]) => list.flatMap((f) => ['--disable', f]);

it('keeps the non-deep Codex argv byte-for-byte unchanged', async () => {
  const { s, log } = fake();
  await ask(s);
  const run = JSON.parse(readFileSync(log, 'utf8'));
  expect(run.args).toEqual([
    'exec',
    '--ignore-user-config',
    '--ignore-rules',
    ...disables(['shell_tool', 'unified_exec', ...FEATURES, ...MORE]),
    '-c',
    'web_search="disabled"',
    '-c',
    'project_doc_max_bytes=0',
    '--json',
    '--ephemeral',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '-',
  ]);
  expect(run.cwd).toMatch(/dg-codex-/);
});

it('deep scan runs Codex in the folder with its read-only shell and everything else still off', async () => {
  const { s, log } = fake();
  const root = project();
  await ask({ ...s, deepScan: true }, root);
  const run = JSON.parse(readFileSync(log, 'utf8'));
  expect(run.cwd).toBe(root);
  expect(run.args).toEqual([
    'exec',
    '--ignore-user-config',
    '--ignore-rules',
    ...disables([...FEATURES, ...MORE]),
    '-c',
    'web_search="disabled"',
    '-c',
    'project_doc_max_bytes=0',
    '-c',
    'shell_environment_policy.inherit="core"',
    '--json',
    '--ephemeral',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '-C',
    root,
    '-',
  ]);
  expect(run.args).not.toContain('shell_tool');
  expect(run.args).not.toContain('unified_exec');
});

// Review Focus 3: an older Codex without -C must say what to do.
it('asks for a newer Codex when deep flags are rejected, and only in deep mode', async () => {
  const { s } = fake('old');
  await expect(ask({ ...s, deepScan: true }, project())).rejects.toThrow(
    'Deep scan needs a newer Codex. Run "npm i -g @openai/codex@latest", or turn Deep scan off.',
  );
  await expect(ask(s)).rejects.toThrow(/Codex: error: unexpected argument/);
});

it('stops a deep Codex run at the wall clock', async () => {
  const { s } = fake('hang');
  deepLimits.wallMs = 300;
  try {
    await expect(ask({ ...s, deepScan: true }, project())).rejects.toThrow(
      'Deep scan took longer than 15 minutes and was stopped.',
    );
  } finally {
    deepLimits.wallMs = 15 * 60_000;
  }
});

it('reports Codex commands as progress in deep mode', async () => {
  const { s } = fake('deep');
  const steps: string[] = [];
  await chat(
    { ...s, deepScan: true },
    undefined,
    { messages: [{ role: 'user', content: 'Map it' }] },
    () => {},
    new AbortController().signal,
    { cwd: project(), onProgress: (t) => steps.push(t) },
  );
  expect(steps).toEqual(['Running ls']);
});
