import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { spawn } from 'cross-spawn';
import type { ChatMsg, Settings } from '../shared/ipc';
import { clip, DEEP_WALL_ERROR, type Deep, deepLimits, findClaude, transcript } from './claudeCli';

// Source text is evidence, never authorization to run tools or load the user's plugins/MCP/rules.
const FEATURES = [
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
  'sleep_tool',
];
// Deep scan: Codex reads files only through sandboxed commands, so its shell stays on.
const SHELL = ['shell_tool', 'unified_exec'];
const disabled = (deep: boolean) =>
  FEATURES.filter((f) => !deep || !SHELL.includes(f)).flatMap((feature) => ['--disable', feature]);

function codexEnv(bin: string): NodeJS.ProcessEnv {
  const paths = [dirname(bin), process.env.PATH];
  // npm-installed launchers use /usr/bin/env node; Finder omits Homebrew and version-manager PATHs.
  try {
    paths.push(dirname(findClaude('', 'node')));
  } catch {} // Native Codex installations do not require Node.
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: paths.filter(Boolean).join(delimiter) };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.OPENAI_API_KEY;
  return env;
}

/** Query the installed CLI's catalog using its own config and saved login. */
export function codexModels(s: Settings): Promise<string[]> {
  const bin = findClaude(s.cliPath, 'codex');
  const dir = mkdtempSync(join(tmpdir(), 'dg-codex-models-'));
  const env = codexEnv(bin);
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['app-server', '--listen', 'stdio://'], {
      cwd: dir,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = createInterface({ input: child.stdout });
    const models = new Set(['default']);
    let id = 0;
    let settled = false;
    let stderr = '';
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lines.close();
      child.stdin.end();
      if (child.exitCode === null) child.kill('SIGTERM');
      rmSync(dir, { recursive: true, force: true });
      error ? reject(error) : resolve([...models]);
    };
    const timer = setTimeout(
      () => finish(new Error('Codex model discovery timed out. Check your CLI login and network.')),
      20_000,
    );
    const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const page = (cursor?: string) =>
      send({
        id: ++id,
        method: 'model/list',
        params: { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) },
      });
    lines.on('line', (line) => {
      if (settled) return;
      let response: any;
      try {
        response = JSON.parse(line);
      } catch {
        return;
      }
      if (response?.id !== id) return;
      if (response.error)
        return finish(new Error(`Codex model discovery: ${response.error.message ?? 'Request failed'}`));
      if (id === 0) {
        send({ method: 'initialized', params: {} });
        page();
        return;
      }
      if (!Array.isArray(response.result?.data))
        return finish(new Error('Codex returned an invalid model catalog. Update the CLI and retry.'));
      for (const model of response.result.data) {
        if (!model?.hidden && typeof model?.model === 'string' && model.model) models.add(model.model);
      }
      const cursor = response.result.nextCursor;
      if (typeof cursor === 'string' && cursor) page(cursor);
      else finish();
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    child.stdin.on('error', finish);
    child.on('error', finish);
    child.on('close', (code) =>
      finish(new Error(`Codex model discovery exited (${code}). ${stderr.trim()}`)),
    );
    send({
      id: 0,
      method: 'initialize',
      params: { clientInfo: { name: 'chalkline', title: 'Chalkline', version: '0.1.0' } },
    });
  });
}

/** One progress line for a Codex JSONL event: the command it is about to run. */
export function codexProgress(ev: any): string | null {
  const command = ev?.type === 'item.started' && ev.item?.type === 'command_execution' && ev.item.command;
  if (typeof command !== 'string') return null;
  return clip(`Running ${command.replace(/^bash -lc /, '').replace(/^(['"])(.*)\1$/, '$2')}`);
}

export function codexChat(
  s: Settings,
  req: { messages: ChatMsg[]; schema?: object },
  onChunk: (text: string) => void,
  signal: AbortSignal,
  deep?: Deep,
): Promise<string> {
  signal.throwIfAborted();
  const bin = findClaude(s.cliPath, 'codex');
  const dir = mkdtempSync(join(tmpdir(), 'dg-codex-'));
  const args = [
    'exec',
    '--ignore-user-config',
    '--ignore-rules',
    ...disabled(Boolean(deep)),
    '-c',
    'web_search="disabled"',
    '-c',
    'project_doc_max_bytes=0',
    // Keep the app's env (tokens, AWS_*) away from `env`/`printenv`. Key unverified locally (spec §3).
    ...(deep ? ['-c', 'shell_environment_policy.inherit="core"'] : []),
    '--json',
    '--ephemeral',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    ...(deep ? ['-C', deep.cwd] : []),
    ...(s.model && s.model !== 'default' ? ['--model', s.model] : []),
    '-',
  ];
  const env = codexEnv(bin);
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: deep?.cwd ?? dir, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let timer: NodeJS.Timeout;
    let wall: NodeJS.Timeout | undefined;
    let settled = false;
    let buf = '';
    let stderr = '';
    let answer = '';
    let failure = '';
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(wall);
      signal.removeEventListener('abort', abort);
      if (child.exitCode === null) child.kill('SIGTERM');
      rmSync(dir, { recursive: true, force: true });
      err ? reject(err) : resolve(answer);
    };
    const abort = () => finish(Object.assign(new Error('Stopped.'), { name: 'AbortError' }));
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(() => finish(new Error('Codex stopped responding')), 300_000);
    };
    const event = (line: string) => {
      let ev: any;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      if (deep) {
        const step = codexProgress(ev);
        if (step) deep.onProgress(step);
      }
      if (
        ev.type === 'item.completed' &&
        ev.item?.type === 'agent_message' &&
        typeof ev.item.text === 'string'
      ) {
        answer = ev.item.text;
        onChunk(answer);
      }
      if (ev.type === 'error' || ev.type === 'turn.failed')
        failure = ev.message ?? ev.error?.message ?? 'Request failed';
    };
    signal.addEventListener('abort', abort);
    if (signal.aborted) return abort();
    bump();
    if (deep) wall = setTimeout(() => finish(new Error(DEEP_WALL_ERROR)), deepLimits.wallMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      bump();
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) event(line);
    });
    child.stderr.on('data', (chunk) => {
      bump();
      stderr = (stderr + chunk).slice(-2000);
    });
    child.on('error', finish);
    child.stdin.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code !== 'EPIPE') finish(err);
    });
    child.on('close', (code) => {
      if (buf) event(buf);
      const failed = code !== 0 || failure || !answer;
      finish(
        !failed
          ? undefined
          : new Error(
              deep && /unexpected argument/.test(stderr)
                ? 'Deep scan needs a newer Codex. Run "npm i -g @openai/codex@latest", or turn Deep scan off.'
                : `Codex: ${failure || stderr.trim() || `exited (${code}) without an answer`}`,
            ),
      );
    });
    const system = req.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    // The diagram envelope allows tag-specific fields, incompatible with Codex's strict schema.
    // Keep it as guidance; the AI pipeline validates the full document and repairs errors.
    const format = req.schema
      ? `\n\nReturn only a JSON object matching this schema. Preserve any additional diagram properties needed:\n${JSON.stringify(req.schema)}`
      : '';
    child.stdin.end(`${system}${format}\n\n${transcript(req.messages)}`);
  });
}
