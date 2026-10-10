import { type ChildProcess, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, relative, resolve, win32 } from 'node:path';
import { spawn } from 'cross-spawn';
import type { ChatMsg, Settings } from '../shared/ipc';

/** Model aliases `claude --model` accepts; "default" leaves the choice to the CLI. */
export const CLI_MODELS = ['default', 'opus', 'sonnet', 'haiku'];
const IDLE_MS = 300_000;
/** Deep scan: the CLI runs in the chosen folder with read-only tools and reports what it reads. */
export interface Deep {
  /** realpath of the chosen folder. */
  cwd: string;
  onProgress(text: string): void;
}
/** Wall clock for one deep run, shared with Codex. Mutable only so tests can shorten it. */
export const deepLimits = { wallMs: 15 * 60_000 };
export const DEEP_WALL_ERROR = 'Deep scan took longer than 15 minutes and was stopped.';
const MAX_TURNS = 60;
const DEEP_TOOLS = 'Read,Grep,Glob';
// Mirrors projectScan SECRET/INSTRUCTIONS/SKIP_DIRS. Read() rules also stop Grep and Glob.
const SPEC_DENY = [
  '**/.env',
  '**/.env.*',
  '**/*.pem',
  '**/*.key',
  '**/*.p12',
  '**/*.pfx',
  '**/*.jks',
  '**/*.keystore',
  '**/id_rsa*',
  '**/id_ed25519*',
  '**/id_ecdsa*',
  '**/.npmrc',
  '**/.netrc',
  '**/.pypirc',
  '**/credentials*',
  '**/secret/**',
  '**/secrets/**',
  '**/secrets.*',
  '**/service-account*',
  '**/service_account*',
  '**/*.tfstate',
  '**/*.tfstate.*',
  '**/.git/**',
  '**/.ssh/**',
  '**/.aws/**',
  '**/.gnupg/**',
  '**/.kube/**',
  '**/node_modules/**',
  '**/CLAUDE.md',
  '**/AGENTS.md',
  '**/GEMINI.md',
  '**/.cursorrules',
  '**/.claude/**',
  '**/.codex/**',
  '**/.agents/**',
  '**/.cursor/**',
];
// Claude Code 2.1.295 matches deny rules case-insensitively (observed from its bundled matcher, not documented);
// we add UPPER/Capitalized variants as defense in depth in case a future version changes this.
const capitalize = (g: string) => g.replace(/[a-z]/, (c) => c.toUpperCase());
export const DENY_READ = [
  ...new Set([...SPEC_DENY, ...SPEC_DENY.flatMap((g) => [g.toUpperCase(), capitalize(g)])]),
];

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

/** Progress lines stay on one line of the stage indicator. */
export const clip = (text: string) => (text.length > 80 ? `${text.slice(0, 79)}…` : text);
const DENIED = /denied by your permission settings|outside .*--restricted/;

/** One progress line for a deep-scan stream event, or null for events worth no line. */
export function claudeProgress(ev: any, cwd: string): string | null {
  const blocks: any[] = Array.isArray(ev?.message?.content) ? ev.message.content : [];
  if (ev?.type === 'user') {
    const denied = blocks.some(
      (b) =>
        b?.type === 'tool_result' &&
        b.is_error &&
        DENIED.test(typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '')),
    );
    return denied ? 'Skipped a protected file' : null;
  }
  if (ev?.type !== 'assistant') return null;
  const rel = (p: string) => {
    const r = relative(cwd, resolve(cwd, p));
    return r.startsWith('..') ? basename(p) : r;
  };
  const steps = blocks
    .filter((b) => b?.type === 'tool_use')
    .map((b) => {
      const input = b.input ?? {};
      if (b.name === 'Read') return `Reading ${rel(String(input.file_path ?? ''))}`;
      if (b.name === 'Grep') {
        const where = input.path ? rel(String(input.path)) : '';
        return `Searching for "${input.pattern}"${where ? ` in ${where}` : ''}`;
      }
      if (b.name === 'Glob') return `Listing ${input.pattern}`;
      if (b.name === 'StructuredOutput') return 'Writing diagram';
      return null;
    })
    .filter(Boolean);
  return steps.length ? clip(steps.join(' · ')) : null;
}

/** Run `claude -p` once: system prompt from a file, conversation on stdin, output as stream-json. */
export function cliChat(
  s: Settings,
  req: { messages: ChatMsg[]; schema?: object },
  onChunk: (text: string) => void,
  signal: AbortSignal,
  deep?: Deep,
): Promise<string> {
  signal.throwIfAborted();
  const bin = findClaude(s.cliPath);
  // A fresh temp dir for system.md (and deny.json). Without Deep scan it is also the empty cwd.
  const dir = mkdtempSync(join(tmpdir(), 'dg-claude-'));
  const sysFile = join(dir, 'system.md');
  writeFileSync(
    sysFile,
    req.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n'),
  );
  const denyFile = join(dir, 'deny.json');
  if (deep)
    writeFileSync(denyFile, JSON.stringify({ permissions: { deny: DENY_READ.map((g) => `Read(${g})`) } }));
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--system-prompt-file',
    sysFile,
    // Isolation: no tools, none of the user's hooks/plugins/skills/CLAUDE.md/MCP, no saved session.
    // Deep scan swaps "no tools" for read-only tools confined to cwd, minus secret files.
    ...(deep
      ? [
          '--tools',
          DEEP_TOOLS,
          '--allowedTools',
          DEEP_TOOLS,
          '--permission-mode',
          'dontAsk',
          '--restricted',
          '--settings',
          denyFile,
        ]
      : ['--tools', '']),
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence',
    ...(deep ? ['--max-turns', String(MAX_TURNS)] : []),
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
    let wall: NodeJS.Timeout | undefined;
    const finish = (err: Error | null, text?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(wall);
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

    child = spawn(bin, args, { cwd: deep?.cwd ?? dir, env, stdio: ['pipe', 'pipe', 'pipe'] });
    bump();
    if (deep) wall = setTimeout(() => finish(new Error(DEEP_WALL_ERROR)), deepLimits.wallMs);
    let buf = '';
    let stderr = '';
    let text = '';
    let block = '';
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
        if (deep) {
          const step = claudeProgress(ev, deep.cwd);
          if (step) deep.onProgress(step);
        }
        if (ev.type === 'stream_event' && ev.event?.type === 'content_block_start') {
          block = ev.event.content_block?.name ?? '';
        } else if (ev.type === 'stream_event' && ev.event?.type === 'content_block_delta') {
          // Deep scan: tool inputs (Read paths, Grep patterns) are not diagram text.
          if (deep && ev.event.delta?.type === 'input_json_delta' && block !== 'StructuredOutput') continue;
          const piece: string | undefined = ev.event.delta?.partial_json ?? ev.event.delta?.text;
          if (piece) {
            text += piece;
            onChunk(piece);
          }
        } else if (ev.type === 'result') {
          if (ev.subtype === 'error_max_turns')
            finish(
              new Error(
                `Deep scan hit its ${MAX_TURNS}-step limit before finishing. Add a narrower focus (e.g. one service) and retry.`,
              ),
            );
          else if (ev.is_error)
            finish(new Error(`Claude Code: ${String(ev.result ?? ev.subtype).slice(0, 400)}`));
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
      finish(
        new Error(
          deep && /unknown option/.test(stderr)
            ? 'Deep scan needs a newer Claude Code. Run "claude update", or turn Deep scan off.'
            : `Claude Code exited (code ${code}) without a result. ${stderr.trim().slice(0, 400)}`,
        ),
      ),
    );
    child.stdin!.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code !== 'EPIPE') finish(err);
    });
    child.stdin!.end(transcript(req.messages));
  });
}
