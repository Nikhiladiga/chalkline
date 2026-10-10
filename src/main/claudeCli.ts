import { type ChildProcess, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, win32 } from 'node:path';
import { spawn } from 'cross-spawn';
import type { ChatMsg, Settings } from '../shared/ipc';

/** Model aliases `claude --model` accepts; "default" leaves the choice to the CLI. */
export const CLI_MODELS = ['default', 'opus', 'sonnet', 'haiku'];
const IDLE_MS = 300_000;

export class CliMissing extends Error {
  constructor(where: string, name = 'Claude Code') {
    super(`${name} CLI not found (${where}).`);
  }
}

// Apps started from Finder get a bare PATH, so look where installers put `claude` too.
const CANDIDATES = [
  '~/.local/bin/claude',
  '~/.claude/local/claude',
  '/opt/homebrew/bin/claude',
  '/usr/local/bin/claude',
  '~/.npm-global/bin/claude',
  '~/.bun/bin/claude',
];
const expand = (p: string) => p.replace(/^~(?=[\\/])/, homedir());

/** Candidate filenames only; Windows paths use Windows separators even when inspected on macOS. */
export function cliSearchPaths(
  binary: string,
  platform = process.platform,
  env = process.env,
  home = homedir(),
): string[] {
  if (platform !== 'win32') {
    const onPath = (env.PATH ?? '')
      .split(delimiter)
      .filter(Boolean)
      .map((dir) => join(dir, binary));
    return [...onPath, ...CANDIDATES.map((p) => p.replace(/claude/g, binary).replace(/^~/, home))];
  }
  const dirs = (env.PATH ?? env.Path ?? '').split(';').map((dir) => dir.trim().replace(/^"(.*)"$/, '$1'));
  dirs.push(win32.join(home, '.local', 'bin'), win32.join(home, '.bun', 'bin'));
  if (env.APPDATA) dirs.push(win32.join(env.APPDATA, 'npm'));
  if (env.LOCALAPPDATA) dirs.push(win32.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'));
  const extensions = [...(env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean), ''];
  return dirs.filter(Boolean).flatMap((dir) => extensions.map((ext) => win32.join(dir, binary + ext)));
}

/** A configured CLI path is only ever run if it names the expected executable and is a regular file. */
export function checkCliPath(cliPath: string, binary: string, platform = process.platform): string {
  const path = expand(cliPath);
  const name = platform === 'win32' ? win32.basename(path).replace(/\.(exe|cmd|bat)$/i, '') : basename(path);
  const wrong = new Error(`CLI path must point to the ${binary} executable.`);
  if (name.toLowerCase() !== binary) throw wrong;
  if (!existsSync(path)) throw new CliMissing(cliPath, binary === 'codex' ? 'Codex' : 'Claude Code');
  if (!statSync(path).isFile()) throw wrong;
  return path;
}

let found: string | undefined;
/** The settings path if set, else PATH, the usual install spots, then a login shell's `command -v`. */
export function findClaude(cliPath: string, binary = 'claude'): string {
  const missing = (where: string) => new CliMissing(where, binary === 'codex' ? 'Codex' : 'Claude Code');
  if (cliPath) return checkCliPath(cliPath, binary);
  if (binary === 'claude' && found && existsSync(found)) return found;
  let path = cliSearchPaths(binary).find((p) => existsSync(p));
  if (!path) {
    try {
      const out =
        process.platform === 'win32'
          ? execFileSync('where.exe', [binary], { timeout: 4000, encoding: 'utf8', windowsHide: true })
          : execFileSync(process.env.SHELL || '/bin/zsh', ['-lc', `command -v ${binary}`], {
              timeout: 4000,
              encoding: 'utf8',
            });
      path = out
        .trim()
        .split(/\r?\n/)
        .find((p) => existsSync(p));
    } catch {}
  }
  if (!path || !existsSync(path)) throw missing('not on PATH or in the usual install folders');
  if (binary === 'claude') found = path;
  return path;
}

/** The CLI takes one prompt, so earlier turns (few-shot examples, repair rounds) become a transcript. */
export function transcript(messages: ChatMsg[]): string {
  const turns = messages.filter((m) => m.role !== 'system');
  if (turns.length === 1) return turns[0]!.content;
  const body = turns.map((m) => `<${m.role}>\n${m.content}\n</${m.role}>`).join('\n\n');
  return `${body}\n\nAnswer the last <user> message. The <assistant> turns show the expected output format.`;
}

/** Run `claude -p` once: system prompt from a file, conversation on stdin, output as stream-json. */
export function cliChat(
  s: Settings,
  req: { messages: ChatMsg[]; schema?: object },
  onChunk: (text: string) => void,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  const bin = findClaude(s.cliPath);
  // A fresh empty cwd: nothing for the CLI to read, and no project CLAUDE.md.
  const dir = mkdtempSync(join(tmpdir(), 'dg-claude-'));
  const sysFile = join(dir, 'system.md');
  writeFileSync(
    sysFile,
    req.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n'),
  );
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--system-prompt-file',
    sysFile,
    // Isolation: no tools, none of the user's hooks/plugins/skills/CLAUDE.md/MCP, no saved session.
    '--tools',
    '',
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence',
    ...(s.model && s.model !== 'default' ? ['--model', s.model] : []),
    ...(req.schema ? ['--json-schema', JSON.stringify(req.schema)] : []),
  ];
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: [dirname(bin), '/opt/homebrew/bin', '/usr/local/bin', process.env.PATH].join(delimiter),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CLAUDECODE;

  return new Promise<string>((resolve, reject) => {
    let child: ChildProcess;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (err: Error | null, text?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      if (child?.exitCode === null) child.kill('SIGTERM');
      rmSync(dir, { recursive: true, force: true });
      err ? reject(err) : resolve(text!);
    };
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(() => finish(new Error('Claude Code stopped responding')), IDLE_MS);
    };
    const onAbort = () => finish(Object.assign(new Error('Stopped.'), { name: 'AbortError' }));
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort);

    child = spawn(bin, args, { cwd: dir, env, stdio: ['pipe', 'pipe', 'pipe'] });
    bump();
    let buf = '';
    let stderr = '';
    let text = '';
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => {
      bump();
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        let ev: any;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev.type === 'stream_event' && ev.event?.type === 'content_block_delta') {
          const piece: string | undefined = ev.event.delta?.partial_json ?? ev.event.delta?.text;
          if (piece) {
            text += piece;
            onChunk(piece);
          }
        } else if (ev.type === 'result') {
          if (ev.is_error) finish(new Error(`Claude Code: ${String(ev.result ?? ev.subtype).slice(0, 400)}`));
          else
            finish(
              null,
              ev.structured_output !== undefined
                ? JSON.stringify(ev.structured_output)
                : String(ev.result ?? text),
            );
        }
      }
    });
    child.stderr!.on('data', (c) => (stderr += c));
    child.on('error', (e) => finish(e));
    child.on('close', (code) =>
      finish(new Error(`Claude Code exited (code ${code}) without a result. ${stderr.trim().slice(0, 400)}`)),
    );
    child.stdin!.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code !== 'EPIPE') finish(err);
    });
    child.stdin!.end(transcript(req.messages));
  });
}
