import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../shared/ipc';
import { chat, friendlyError, listModels } from './llm';

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
  provider: 'lmstudio',
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
  require('fs').writeFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: process.argv.slice(2), stdin, env: process.env, cwd: process.cwd(), system: require('fs').readFileSync(process.argv[process.argv.indexOf('--system-prompt-file') + 1], 'utf8') }));
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  const mode = process.env.MODE || 'ok';
  if (mode === 'hang') return setInterval(() => {}, 1000);
  if (mode === 'fail') {
    out({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' });
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
  it('explains how to start LM Studio when the connection is refused', async () => {
    const s = settings('http://127.0.0.1:9/v1');
    const err = await chat(s, undefined, { messages: msgs }, () => {}, new AbortController().signal).catch(
      (e) => e,
    );
    const msg = friendlyError(err, s);
    expect(msg).toMatch(/LM Studio/);
    expect(msg).toMatch(/Start Server|lms server start/);
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
