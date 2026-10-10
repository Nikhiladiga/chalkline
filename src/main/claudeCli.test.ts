import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../shared/ipc';
import * as cli from './claudeCli';

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
