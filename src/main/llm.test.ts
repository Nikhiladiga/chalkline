import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, win32 } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../shared/ipc';
import { DENY_READ, deepLimits } from './claudeCli';
import { chat, deepCwd, friendlyError, listModels, tooBroad } from './llm';

let server: Server | undefined;
afterEach(() => server?.close());

type Handler = (req: IncomingMessage, body: any, res: import('node:http').ServerResponse) => void;
async function serve(handler: Handler): Promise<string> {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => handler(req, raw ? JSON.parse(raw) : undefined, res));
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}/v1`;
}

const sse = (res: import('node:http').ServerResponse, chunks: unknown[]) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.end('data: [DONE]\n\n');
};
const delta = (content: string) => ({ choices: [{ delta: { content } }] });
const settings = (baseUrl: string, extra: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  provider: 'openai',
  baseUrl,
  model: 'm',
  ...extra,
});
const msgs = [{ role: 'user' as const, content: 'hi' }];

describe('OpenAI-compatible chat (LM Studio)', () => {
  it('concatenates streamed deltas and reports each chunk', async () => {
    const url = await serve((_q, _b, res) => sse(res, [delta('{"a"'), delta(':1}')]));
    const seen: string[] = [];
    const text = await chat(
      settings(url),
      undefined,
      { messages: msgs },
      (t) => seen.push(t),
      new AbortController().signal,
    );
    expect(text).toBe('{"a":1}');
    expect(seen).toEqual(['{"a"', ':1}']);
  });

  it('falls back to reasoning_content when content is empty (LM Studio + thinking model + schema)', async () => {
    const url = await serve((_q, _b, res) =>
      sse(res, [
        { choices: [{ delta: { reasoning_content: '{"a"' } }] },
        { choices: [{ delta: { reasoning_content: ':1}' } }] },
      ]),
    );
    const seen: string[] = [];
    const text = await chat(
      settings(url),
      undefined,
      { messages: msgs },
      (t) => seen.push(t),
      new AbortController().signal,
    );
    expect(text).toBe('{"a":1}');
    expect(seen.join('')).toBe('{"a":1}');
  });

  it('prefers content over reasoning when both arrive', async () => {
    const url = await serve((_q, _b, res) =>
      sse(res, [{ choices: [{ delta: { reasoning_content: 'thinking...' } }] }, delta('{"b":2}')]),
    );
    const text = await chat(
      settings(url),
      undefined,
      { messages: msgs },
      () => {},
      new AbortController().signal,
    );
    expect(text).toBe('{"b":2}');
  });

  it('sends the JSON schema as response_format and the model/temperature', async () => {
    let body: any;
    const url = await serve((_q, b, res) => {
      body = b;
      sse(res, [delta('{}')]);
    });
    await chat(
      settings(url),
      undefined,
      { messages: msgs, schema: { type: 'object' } },
      () => {},
      new AbortController().signal,
    );
    expect(body).toMatchObject({
      model: 'm',
      stream: true,
      temperature: 0.2,
      response_format: { type: 'json_schema' },
    });
    expect(body.response_format.json_schema.schema).toEqual({ type: 'object' });
  });

  it('retries without response_format when the server rejects it with 400', async () => {
    const bodies: any[] = [];
    const url = await serve((_q, b, res) => {
      bodies.push(b);
      if (b.response_format) {
        res.writeHead(400).end('{"error":"response_format not supported"}');
        return;
      }
      sse(res, [delta('ok')]);
    });
    const text = await chat(
      settings(url),
      undefined,
      { messages: msgs, schema: { type: 'object' } },
      () => {},
      new AbortController().signal,
    );
    expect(text).toBe('ok');
    expect(bodies).toHaveLength(2);
  });

  it('sends the API key as a bearer token', async () => {
    let auth: string | undefined;
    const url = await serve((q, _b, res) => {
      auth = q.headers.authorization;
      sse(res, [delta('x')]);
    });
    await chat(
      settings(url, { provider: 'openai' }),
      'sk-1',
      { messages: msgs },
      () => {},
      new AbortController().signal,
    );
    expect(auth).toBe('Bearer sk-1');
  });

  it('lists model ids', async () => {
    const url = await serve((_q, _b, res) =>
      res.end(JSON.stringify({ data: [{ id: 'qwen' }, { id: 'llama' }] })),
    );
    expect(await listModels(settings(url), undefined)).toEqual(['qwen', 'llama']);
  });

  it('hides embedding models, which cannot chat', async () => {
    const url = await serve((_q, _b, res) =>
      res.end(JSON.stringify({ data: [{ id: 'qwen' }, { id: 'text-embedding-nomic-embed-text-v1.5' }] })),
    );
    expect(await listModels(settings(url), undefined)).toEqual(['qwen']);
  });

  it('stops when aborted', async () => {
    const url = await serve((_q, _b, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify(delta('a'))}\n\n`);
    });
    const ac = new AbortController();
    const p = chat(settings(url), undefined, { messages: msgs }, () => ac.abort(), ac.signal);
    await expect(p).rejects.toThrow();
  });
});

/**
 * A stand-in `claude` binary: records argv + stdin to $LOG, then prints stream-json like the real
 * CLI (partial JSON deltas, then a result with structured_output). $MODE picks other endings.
 */
function fakeClaude(): { bin: string; log: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dg-fake-claude-'));
  const bin = join(dir, 'claude');
  const log = join(dir, 'log.json');
  writeFileSync(
    bin,
    `#!/usr/bin/env node
let stdin = '';
process.stdin.on('data', (c) => (stdin += c));
process.stdin.on('end', () => {
  const fs = require('fs');
  const argv = process.argv.slice(2);
  const file = (flag) => (argv.includes(flag) ? fs.readFileSync(argv[argv.indexOf(flag) + 1], 'utf8') : null);
  fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ argv, stdin, env: process.env, cwd: process.cwd(), system: file('--system-prompt-file'), deny: JSON.parse(file('--settings') ?? 'null') }));
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  const mode = process.env.MODE || 'ok';
  if (mode.startsWith('old:')) {
    process.stderr.write("error: unknown option '" + mode.slice(4) + "'\\n");
    process.exit(1);
  }
  // Like the real CLI, deep runs open with an init event; $INIT breaks one field of it, or drops it.
  const init = process.env.INIT || 'ok';
  if (argv.includes('--restricted') && init !== 'none')
    out({
      type: 'system',
      subtype: 'init',
      cwd: init === 'cwd' ? '/' : process.cwd(),
      tools: init === 'tools' ? ['Read', 'Grep', 'Glob', 'Bash', 'StructuredOutput'] : ['Glob', 'Grep', 'Read', 'StructuredOutput'],
      permissionMode: init === 'mode' ? 'default' : 'dontAsk',
    });
  if (mode === 'hang') return setInterval(() => {}, 1000);
  if (mode === 'max-turns') {
    out({ type: 'result', subtype: 'error_max_turns', is_error: true, result: null, errors: ['Reached maximum number of turns (60)'], terminal_reason: 'max_turns' });
    return;
  }
  if (mode === 'fail') {
    out({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' });
    return;
  }
  if (mode === 'deep') {
    const ev = (event) => out({ type: 'stream_event', event });
    const file = process.cwd() + '/src/app.ts';
    ev({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', name: 'Read' } });
    ev({ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: JSON.stringify({ file_path: file }) } });
    out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: file } }] }, parent_tool_use_id: null });
    out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'File is in a directory that is denied by your permission settings.' }] } });
    ev({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', name: 'StructuredOutput' } });
    ev({ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"entities":[],"connections":[]}' } });
    out({ type: 'result', subtype: 'success', is_error: false, structured_output: { entities: [], connections: [] } });
    return;
  }
  const delta = (partial_json) => out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json } } });
  delta('{"entities":[],');
  delta('"connections":[]}');
  out({ type: 'result', subtype: 'success', is_error: false, result: 'ignored', structured_output: { entities: [], connections: [] } });
});
`,
  );
  chmodSync(bin, 0o755);
  return { bin, log };
}
const cli = (bin: string, extra: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  provider: 'claude-code',
  cliPath: bin,
  model: 'opus',
  ...extra,
});
const conversation = [
  { role: 'system' as const, content: 'SYSTEM RULES' },
  { role: 'user' as const, content: 'example request' },
  { role: 'assistant' as const, content: '{"entities":[]}' },
  { role: 'user' as const, content: 'draw a VPC' },
];

describe('Claude Code CLI chat', () => {
  it('streams the partial JSON and returns the structured output', async () => {
    const { bin } = fakeClaude();
    const seen: string[] = [];
    const text = await chat(
      cli(bin),
      undefined,
      { messages: conversation, schema: { type: 'object' } },
      (t) => seen.push(t),
      new AbortController().signal,
    );
    expect(JSON.parse(text)).toEqual({ entities: [], connections: [] });
    expect(seen.join('')).toBe('{"entities":[],"connections":[]}');
  });

  it('runs print mode isolated from the user setup, with the schema, model and system prompt', async () => {
    const { bin, log } = fakeClaude();
    await chat(
      cli(bin),
      undefined,
      { messages: conversation, schema: { type: 'object' } },
      () => {},
      new AbortController().signal,
    );
    const { argv, stdin, env, system } = JSON.parse(readFileSync(log, 'utf8'));
    const arg = (flag: string) => argv[argv.indexOf(flag) + 1];
    expect(argv).toContain('-p');
    expect(arg('--output-format')).toBe('stream-json');
    expect(argv).toContain('--include-partial-messages');
    expect(arg('--model')).toBe('opus');
    expect(JSON.parse(arg('--json-schema'))).toEqual({ type: 'object' });
    expect(system).toBe('SYSTEM RULES');
    // No tools, no hooks/plugins/CLAUDE.md from the user's own setup, no saved session.
    expect(arg('--tools')).toBe('');
    expect(arg('--setting-sources')).toBe('');
    expect(argv).toEqual(expect.arrayContaining(['--strict-mcp-config', '--no-session-persistence']));
    // The whole conversation (examples + request) goes in on stdin, last request last.
    expect(stdin).toContain('example request');
    expect(stdin).toContain('{"entities":[]}');
    expect(stdin.trim().endsWith('draw a VPC')).toBe(false);
    expect(stdin.lastIndexOf('draw a VPC')).toBeGreaterThan(stdin.lastIndexOf('example request'));
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });

  it('lets the CLI pick its own model when the model is "default"', async () => {
    const { bin, log } = fakeClaude();
    await chat(
      cli(bin, { model: 'default' }),
      undefined,
      { messages: conversation },
      () => {},
      new AbortController().signal,
    );
    expect(JSON.parse(readFileSync(log, 'utf8')).argv).not.toContain('--model');
  });

  it('turns an error result into a thrown error with its message', async () => {
    const { bin } = fakeClaude();
    process.env.MODE = 'fail';
    try {
      await expect(
        chat(cli(bin), undefined, { messages: conversation }, () => {}, new AbortController().signal),
      ).rejects.toThrow(/Not logged in/);
    } finally {
      delete process.env.MODE;
    }
  });

  it('stops the CLI process when aborted', async () => {
    const { bin } = fakeClaude();
    process.env.MODE = 'hang';
    const ac = new AbortController();
    try {
      const p = chat(cli(bin), undefined, { messages: conversation }, () => {}, ac.signal);
      setTimeout(() => ac.abort(), 300);
      await expect(p).rejects.toThrow();
    } finally {
      delete process.env.MODE;
    }
  });

  it('lists the model aliases the CLI accepts', async () => {
    const { bin } = fakeClaude();
    expect(await listModels(cli(bin), undefined)).toEqual(['default', 'opus', 'sonnet', 'haiku']);
  });

  it('explains how to install Claude Code when the binary is missing', async () => {
    const s = cli('/nonexistent/claude');
    const err = await listModels(s, undefined).catch((e) => e);
    expect(friendlyError(err, s)).toMatch(/Claude Code.*not found/i);
  });
});

describe('friendlyError', () => {
  const refused = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  const api = (baseUrl: string) => settings(baseUrl, { provider: 'openai' });

  it('gives every local server the same hint, LM Studio included', () => {
    for (const url of ['http://127.0.0.1:1234/v1', 'http://localhost:1234/v1', 'http://127.0.0.1:11434/v1'])
      expect(friendlyError(refused(), api(url))).toBe(
        `Can't reach the local server at ${url}. Start it and load a model.`,
      );
  });

  it('keeps the generic network hint for remote servers', () => {
    expect(friendlyError(refused(), api('https://api.openai.com/v1'))).toBe(
      "Can't reach https://api.openai.com/v1. Check the base URL in Settings and your network.",
    );
  });

  it('explains how to reach a local server when a real connection is refused', async () => {
    const s = settings('http://127.0.0.1:9/v1');
    const err = await chat(s, undefined, { messages: msgs }, () => {}, new AbortController().signal).catch(
      (e) => e,
    );
    expect(friendlyError(err, s)).toMatch(/local server at http:\/\/127\.0\.0\.1:9\/v1/);
  });

  it('asks for an API key on 401', () => {
    expect(
      friendlyError(
        Object.assign(new Error('HTTP 401: bad key'), { status: 401 }),
        settings('http://x/v1', { provider: 'openai' }),
      ),
    ).toMatch(/API key/);
  });
});

const project = () => realpathSync(mkdtempSync(join(tmpdir(), 'dg-project-')));
const deepRun = (s: Settings, cwd: string, onChunk: (t: string) => void = () => {}) =>
  chat(
    s,
    undefined,
    { messages: conversation, schema: { type: 'object' } },
    onChunk,
    new AbortController().signal,
    {
      cwd,
    },
  );
const withMode = async (mode: string, fn: () => Promise<void>) => {
  process.env.MODE = mode;
  try {
    await fn();
  } finally {
    delete process.env.MODE;
  }
};

describe('Claude Code deep scan', () => {
  it('reports tool use as progress and counts only the diagram toward the chars', async () => {
    const { bin } = fakeClaude();
    const root = project();
    const seen: string[] = [];
    const steps: string[] = [];
    await withMode('deep', async () => {
      const text = await chat(
        cli(bin, { deepScan: true }),
        undefined,
        { messages: conversation, schema: { type: 'object' } },
        (t) => seen.push(t),
        new AbortController().signal,
        { cwd: root, onProgress: (t) => steps.push(t) },
      );
      expect(JSON.parse(text)).toEqual({ entities: [], connections: [] });
    });
    expect(steps).toEqual(['Reading src/app.ts', 'Skipped a protected file']);
    expect(seen.join('')).toBe('{"entities":[],"connections":[]}');
  });

  it('keeps the non-deep argv byte-for-byte unchanged', async () => {
    const { bin, log } = fakeClaude();
    await chat(
      cli(bin),
      undefined,
      { messages: conversation, schema: { type: 'object' } },
      () => {},
      new AbortController().signal,
    );
    const { argv, cwd, deny } = JSON.parse(readFileSync(log, 'utf8'));
    expect(argv).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--system-prompt-file',
      expect.stringMatching(/dg-claude-.*system\.md$/),
      '--tools',
      '',
      '--setting-sources',
      '',
      '--strict-mcp-config',
      '--disable-slash-commands',
      '--no-session-persistence',
      '--model',
      'opus',
      '--json-schema',
      '{"type":"object"}',
    ]);
    expect(cwd).toMatch(/dg-claude-/);
    expect(deny).toBeNull();
  });

  it('runs in the folder with read-only tools, --restricted, a turn cap and the spec deny list plus case variants', async () => {
    const { bin, log } = fakeClaude();
    const root = project();
    await deepRun(cli(bin, { deepScan: true }), root);
    const { argv, cwd, deny, system } = JSON.parse(readFileSync(log, 'utf8'));
    expect(cwd).toBe(root);
    expect(system).toBe('SYSTEM RULES');
    expect(argv).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--system-prompt-file',
      expect.stringMatching(/dg-claude-.*system\.md$/),
      '--tools',
      'Read,Grep,Glob',
      '--allowedTools',
      'Read,Grep,Glob',
      '--permission-mode',
      'dontAsk',
      '--restricted',
      '--settings',
      expect.stringMatching(/dg-claude-.*deny\.json$/),
      '--setting-sources',
      '',
      '--strict-mcp-config',
      '--disable-slash-commands',
      '--no-session-persistence',
      '--max-turns',
      '60',
      '--model',
      'opus',
      '--json-schema',
      '{"type":"object"}',
    ]);
    expect(argv.filter((a: string) => a === '--tools')).toHaveLength(1);
    for (const flag of ['--bare', '--dangerously-skip-permissions', '--add-dir', '--max-budget-usd'])
      expect(argv).not.toContain(flag);
    // The temp dir holding system.md and deny.json sits outside cwd, so --restricted hides it.
    expect(argv[argv.indexOf('--settings') + 1].startsWith(root)).toBe(false);
    // Review Focus 1: the spec's list stays verbatim as the prefix; case variants (case-insensitive APFS) follow.
    const SPEC =
      `**/.env **/.env.* **/*.pem **/*.key **/*.p12 **/*.pfx **/*.jks **/*.keystore **/id_rsa* **/id_ed25519* **/id_ecdsa* **/.npmrc **/.netrc **/.pypirc **/credentials* **/secret/** **/secrets/** **/secrets.* **/service-account* **/service_account* **/*.tfstate **/*.tfstate.* **/.git/** **/.ssh/** **/.aws/** **/.gnupg/** **/.kube/** **/node_modules/** **/CLAUDE.md **/AGENTS.md **/GEMINI.md **/.cursorrules **/.claude/** **/.codex/** **/.agents/** **/.cursor/** **/secret **/secret.* **/secrets **/.envrc **/.git-credentials **/.hg/** **/.svn/** **/.gemini/** **/.opencode/** **/.terraform/** **/SKILL.md **/copilot-instructions.md **/.windsurfrules **/.clinerules`.split(
        ' ',
      );
    expect(DENY_READ.slice(0, SPEC.length)).toEqual(SPEC);
    expect(deny.permissions.deny).toEqual(
      expect.arrayContaining(
        [
          '**/.ENV',
          '**/.Env',
          '**/.ENV.*',
          '**/*.PEM',
          '**/*.KEY',
          '**/ID_RSA*',
          '**/Secrets/**',
          '**/SECRETS/**',
          '**/.GIT/**',
          '**/.ENVRC',
          '**/SECRET.*',
          '**/skill.md',
          '**/COPILOT-INSTRUCTIONS.MD',
          '**/.Terraform/**',
        ].map((g) => `Read(${g})`),
      ),
    );
    expect(deny).toEqual({ permissions: { deny: DENY_READ.map((g) => `Read(${g})`) } });
    expect(deny.permissions.deny).toEqual(
      expect.arrayContaining([
        'Read(**/.env)',
        'Read(**/*.pem)',
        'Read(**/id_rsa*)',
        'Read(**/.git/**)',
        'Read(**/secrets/**)',
        'Read(**/credentials*)',
      ]),
    );
  });

  // Final review I5: an accepted-but-ignored flag must not fail open.
  it.each([
    ['tools', 'deep'],
    ['mode', 'deep'],
    ['cwd', 'deep'],
    ['none', 'deep'],
    ['none', 'ok'],
  ])('aborts when the init event is %s-broken (output %s) before any tool runs', async (init, mode) => {
    const { bin } = fakeClaude();
    const steps: string[] = [];
    process.env.INIT = init;
    try {
      await withMode(mode, () =>
        expect(
          chat(
            cli(bin, { deepScan: true }),
            undefined,
            { messages: conversation, schema: { type: 'object' } },
            () => {},
            new AbortController().signal,
            { cwd: project(), onProgress: (t) => steps.push(t) },
          ),
        ).rejects.toThrow(
          "Claude Code didn't apply Deep scan restrictions; update Claude Code or turn Deep scan off.",
        ),
      );
    } finally {
      delete process.env.INIT;
    }
    expect(steps).toEqual([]);
  });

  it('explains the 60-step limit instead of a raw error_max_turns', async () => {
    const { bin } = fakeClaude();
    await withMode('max-turns', () =>
      expect(deepRun(cli(bin, { deepScan: true }), project())).rejects.toThrow(
        'Deep scan hit its 60-step limit before finishing. Add a narrower focus (e.g. one service) and retry.',
      ),
    );
  });

  // Review Focus 3: --max-turns is a hidden flag; an older CLI rejects it as well as --restricted.
  it.each(['--restricted', '--max-turns'])(
    'asks for a newer Claude Code when it rejects %s',
    async (flag) => {
      const { bin } = fakeClaude();
      await withMode(`old:${flag}`, async () => {
        await expect(deepRun(cli(bin, { deepScan: true }), project())).rejects.toThrow(
          'Deep scan needs a newer Claude Code. Run "claude update", or turn Deep scan off.',
        );
        // Outside deep mode the raw CLI error stays, so nobody is told to update for the wrong reason.
        await expect(
          chat(cli(bin), undefined, { messages: conversation }, () => {}, new AbortController().signal),
        ).rejects.toThrow(/exited \(code 1\) without a result.*unknown option/);
      });
    },
  );

  it('stops a deep run at the wall clock', async () => {
    const { bin } = fakeClaude();
    deepLimits.wallMs = 300;
    try {
      await withMode('hang', () =>
        expect(deepRun(cli(bin, { deepScan: true }), project())).rejects.toThrow(
          'Deep scan took longer than 15 minutes and was stopped.',
        ),
      );
    } finally {
      deepLimits.wallMs = 15 * 60_000;
    }
  });

  // Review Focus 5: a cwd must never be silently dropped and turned into a shallow run.
  it('refuses a deep cwd for an HTTP provider', async () => {
    await expect(
      chat(
        settings('http://127.0.0.1:9/v1'),
        undefined,
        { messages: msgs },
        () => {},
        new AbortController().signal,
        {
          cwd: project(),
        },
      ),
    ).rejects.toThrow('Deep scan is off or not supported by this provider.');
  });
});

describe('deepCwd gate', () => {
  const on: Settings = { ...DEFAULT_SETTINGS, deepScan: true };

  it('refuses unless Deep scan is on and the provider is a CLI', () => {
    const root = project();
    expect(() => deepCwd({ ...on, deepScan: false }, root)).toThrow(
      'Deep scan is off or not supported by this provider.',
    );
    expect(() => deepCwd({ ...on, provider: 'lmstudio' }, root)).toThrow(/Deep scan is off/);
    expect(() => deepCwd({ ...on, provider: 'openai' }, root)).toThrow(/Deep scan is off/);
    expect(deepCwd({ ...on, provider: 'claude-code' }, root)).toBe(root);
  });

  // Final review I1: Codex deep code stays, but main refuses it until its manual gate passes.
  it('refuses Codex until its manual acceptance gate passes', () => {
    expect(() => deepCwd({ ...on, provider: 'codex' }, project())).toThrow(
      "Deep scan isn't available for Codex yet. Use Claude Code, or turn Deep scan off.",
    );
  });

  // Final review I2: --restricted only confines reads to cwd, so cwd must not be home or a root.
  it('refuses the home folder, its ancestors and the filesystem root', () => {
    const msg = 'Choose a project folder, not your home or a system root.';
    for (const dir of [homedir(), dirname(homedir()), '/']) expect(() => deepCwd(on, dir)).toThrow(msg);
    expect(deepCwd(on, project())).not.toBe(homedir());
  });

  it('spots roots and home ancestors on Windows paths too, ignoring case', () => {
    const home = 'C:\\Users\\me';
    for (const dir of ['C:\\', 'D:\\', 'C:\\Users', 'c:\\users\\ME', '\\\\server\\share\\'])
      expect(tooBroad(dir, home, win32)).toBe(true);
    for (const dir of ['C:\\Users\\me\\code\\app', 'D:\\repo', 'C:\\Users\\meta'])
      expect(tooBroad(dir, home, win32)).toBe(false);
    expect(tooBroad('/Users/me/..hidden', '/Users/me/..hidden/x')).toBe(true);
    expect(tooBroad('/Users/me/app', '/Users/me')).toBe(false);
  });

  // Review Focus 2: symlinked, deleted or non-directory folders.
  it('runs in the real folder behind a symlink and asks to re-choose a folder that is gone', () => {
    const real = project();
    const link = join(project(), 'link');
    symlinkSync(real, link);
    expect(deepCwd(on, link)).toBe(real);
    const file = join(real, 'file.txt');
    writeFileSync(file, 'x');
    expect(() => deepCwd(on, file)).toThrow('Choose the code folder again before scanning.');
    rmSync(real, { recursive: true, force: true });
    expect(() => deepCwd(on, link)).toThrow('Choose the code folder again before scanning.');
  });

  // Acceptance finding: a folder picked with other letter case must resolve to the on-disk case.
  it('returns the on-disk letter case for a miscased folder', (ctx) => {
    const dir = realpathSync.native(project());
    const upper = dir.toUpperCase();
    let caseInsensitive = false;
    try {
      caseInsensitive = realpathSync.native(upper) === dir;
    } catch {}
    if (!caseInsensitive) ctx.skip(); // case-sensitive filesystem: nothing to resolve
    expect(deepCwd(on, upper)).toBe(dir);
  });
});
