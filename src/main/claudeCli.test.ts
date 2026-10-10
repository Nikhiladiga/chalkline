import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../shared/ipc';
import * as cli from './claudeCli';
import { codexProgress } from './codexCli';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function exitingCli() {
  const dir = mkdtempSync(join(tmpdir(), 'chalkline-exiting-cli-'));
  dirs.push(dir);
  const bin = join(dir, 'claude');
  writeFileSync(bin, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  return { ...DEFAULT_SETTINGS, cliPath: bin };
}

it('preserves cancellation before Claude discovery or temporary files are created', async () => {
  const ac = new AbortController();
  ac.abort();
  await expect(async () =>
    cli.cliChat(
      { ...DEFAULT_SETTINGS, cliPath: '/does-not-exist/claude' },
      { messages: [{ role: 'user', content: 'hi' }] },
      () => {},
      ac.signal,
    ),
  ).rejects.toMatchObject({ name: 'AbortError' });
});

it.skipIf(process.platform === 'win32')(
  'handles a Claude launcher that closes stdin before reading the prompt',
  async () => {
    await expect(
      cli.cliChat(
        exitingCli(),
        { messages: [{ role: 'user', content: 'x'.repeat(1_000_000) }] },
        () => {},
        new AbortController().signal,
      ),
    ).rejects.toThrow(/exited.*without a result/);
  },
);

it('discovers Windows native executables and npm wrappers using PATHEXT and installer folders', () => {
  const paths =
    (cli as any).cliSearchPaths?.(
      'codex',
      'win32',
      {
        PATH: 'C:\\tools;"C:\\Program Files\\nodejs"',
        PATHEXT: '.EXE;.CMD;.BAT',
        APPDATA: 'C:\\Users\\alice\\AppData\\Roaming',
        LOCALAPPDATA: 'C:\\Users\\alice\\AppData\\Local',
      },
      'C:\\Users\\alice',
    ) ?? [];
  expect(paths).toEqual(
    expect.arrayContaining([
      'C:\\tools\\codex.EXE',
      'C:\\tools\\codex.CMD',
      'C:\\Program Files\\nodejs\\codex.EXE',
      'C:\\Users\\alice\\AppData\\Roaming\\npm\\codex.CMD',
      'C:\\Users\\alice\\AppData\\Local\\Microsoft\\WinGet\\Links\\codex.EXE',
      'C:\\Users\\alice\\.local\\bin\\codex.EXE',
    ]),
  );
  // npm also writes a bare POSIX shell shim beside its .cmd launcher.
  expect(paths.indexOf('C:\\tools\\codex.CMD')).toBeLessThan(paths.indexOf('C:\\tools\\codex'));
});

it('only accepts a configured CLI path that names the claude/codex executable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chalkline-cli-path-'));
  dirs.push(dir);
  for (const name of ['claude', 'claude-evil', 'claude.cmd', 'codex.exe'])
    writeFileSync(join(dir, name), '', { mode: 0o755 });
  mkdirSync(join(dir, 'sub', 'codex'), { recursive: true });
  const wrong = /CLI path must point to the (claude|codex) executable/;
  expect(cli.checkCliPath(join(dir, 'claude'), 'claude')).toBe(join(dir, 'claude'));
  expect(cli.findClaude(join(dir, 'claude'))).toBe(join(dir, 'claude'));
  expect(cli.checkCliPath(join(dir, 'claude.cmd'), 'claude', 'win32')).toBe(join(dir, 'claude.cmd'));
  expect(cli.checkCliPath(join(dir, 'codex.exe'), 'codex', 'win32')).toBe(join(dir, 'codex.exe'));
  // Name is checked before the file, so a Windows path is judged on its name alone here.
  expect(() =>
    cli.checkCliPath('C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd', 'claude', 'win32'),
  ).toThrow(cli.CliMissing);
  expect(() => cli.checkCliPath('C:\\Windows\\System32\\cmd.exe', 'claude', 'win32')).toThrow(wrong);
  expect(() => cli.checkCliPath(join(dir, 'claude.cmd'), 'claude', 'darwin')).toThrow(wrong);
  expect(() => cli.checkCliPath('/bin/sh', 'claude')).toThrow(wrong);
  expect(() => cli.findClaude('/bin/sh', 'codex')).toThrow(wrong);
  expect(() => cli.checkCliPath(join(dir, 'claude-evil'), 'claude')).toThrow(wrong);
  expect(() => cli.checkCliPath(join(dir, 'claude'), 'codex')).toThrow(wrong);
  expect(() => cli.checkCliPath(join(dir, 'sub', 'codex'), 'codex')).toThrow(wrong);
});

const use = (name: string, input: object) => ({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id: 't1', name, input }] },
  parent_tool_use_id: null,
});
const result = (content: unknown) => ({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content }] },
});

it('turns Claude tool calls into short progress lines relative to the folder', () => {
  const p = (ev: unknown) => cli.claudeProgress(ev, '/repo');
  expect(p(use('Read', { file_path: '/repo/src/app.ts' }))).toBe('Reading src/app.ts');
  expect(p(use('Read', { file_path: '/etc/passwd' }))).toBe('Reading passwd');
  expect(p(use('Grep', { pattern: 'zebra', output_mode: 'content' }))).toBe('Searching for "zebra"');
  expect(p(use('Grep', { pattern: 'zebra', path: '/repo/src' }))).toBe('Searching for "zebra" in src');
  expect(p(use('Glob', { pattern: '**/*.ts' }))).toBe('Listing **/*.ts');
  expect(p(use('StructuredOutput', { entities: [] }))).toBe('Writing diagram');
  expect(
    p({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Read', input: { file_path: '/repo/a.ts' } },
          { type: 'tool_use', name: 'Read', input: { file_path: '/repo/b.ts' } },
        ],
      },
    }),
  ).toBe('Reading a.ts · Reading b.ts');
  expect(p(use('Read', { file_path: `/repo/${'d/'.repeat(60)}x.ts` }))).toHaveLength(80);
  expect(p({ type: 'rate_limit_event' })).toBeNull();
  expect(p({ type: 'system', subtype: 'thinking_tokens' })).toBeNull();
});

it('reports denied and out-of-folder reads as a skipped protected file', () => {
  const p = (ev: unknown) => cli.claudeProgress(ev, '/repo');
  expect(p(result('File is in a directory that is denied by your permission settings.'))).toBe(
    'Skipped a protected file',
  );
  expect(
    p(
      result([
        {
          type: 'text',
          text: '/etc/hosts is outside /repo; --restricted confines the file tools to the working directory.',
        },
      ]),
    ),
  ).toBe('Skipped a protected file');
  expect(p(result('ENOENT: no such file'))).toBeNull();
});

it('turns a Codex command into a progress line', () => {
  expect(
    codexProgress({
      type: 'item.started',
      item: { id: 'item_1', type: 'command_execution', command: 'bash -lc ls', status: 'in_progress' },
    }),
  ).toBe('Running ls');
  expect(
    codexProgress({
      type: 'item.started',
      item: { type: 'command_execution', command: "bash -lc 'rg -n route src'" },
    }),
  ).toBe('Running rg -n route src');
  expect(codexProgress({ type: 'item.completed', item: { type: 'agent_message', text: '{}' } })).toBeNull();
});

it('never shows absolute paths or "undefined" in progress', () => {
  const p = (ev: unknown) => cli.claudeProgress(ev, '/repo');
  expect(p(use('Glob', { pattern: '/repo/src/**/*.ts' }))).toBe('Listing src/**/*.ts');
  expect(p(use('Glob', { pattern: '/etc/*.conf' }))).toBe('Listing *.conf');
  expect(p(use('Grep', { path: '/repo' }))).toBe('Searching the repo');
  expect(cli.claudeProgress(result({ weird: 1 }), '/repo')).toBeNull();
  expect(cli.claudeProgress(result(null), '/repo')).toBeNull();
});

it('redacts Codex command paths', () => {
  const run = (command: string) =>
    codexProgress({ type: 'item.started', item: { type: 'command_execution', command } }, '/Users/x/repo');
  expect(run('cat /Users/x/repo/src/a.ts')).toBe('Running cat ./src/a.ts');
  expect(run('cd /tmp && rg foo /etc')).toBe('Running cd tmp && rg foo etc');
  expect(run(`ls ${homedir()}/.ssh`)).toBe('Running ls ~/.ssh');
});
