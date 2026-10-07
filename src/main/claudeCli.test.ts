import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
