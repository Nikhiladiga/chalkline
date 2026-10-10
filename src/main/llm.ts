import { realpathSync, statSync } from 'node:fs';
import { type ChatMsg, isCliProvider, type Settings } from '../shared/ipc';
import { CLI_MODELS, CliMissing, cliChat, type Deep, findClaude } from './claudeCli';
import { codexChat, codexModels } from './codexCli';

export function installedHarnesses(): { provider: 'codex' | 'claude-code'; path: string }[] {
  const installed: { provider: 'codex' | 'claude-code'; path: string }[] = [];
  for (const provider of ['codex', 'claude-code'] as const) {
    try {
      installed.push({ provider, path: findClaude('', provider === 'codex' ? 'codex' : 'claude') });
    } catch {}
  }
  return installed;
}

const IDLE_MS = 180_000;

class HttpError extends Error {
  constructor(
    public status: number,
    body: string,
  ) {
    super(`HTTP ${status}: ${body.slice(0, 300)}`);
  }
}

function headers(key: string | undefined): Record<string, string> {
  return { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) };
}

const base = (s: Settings) => s.baseUrl.replace(/\/+$/, '');

export async function listModels(s: Settings, key: string | undefined): Promise<string[]> {
  if (s.provider === 'codex') return codexModels(s);
  if (s.provider === 'claude-code') {
    findClaude(s.cliPath);
    return CLI_MODELS;
  }
  const res = await fetch(`${base(s)}/models`, {
    headers: headers(key),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new HttpError(res.status, await res.text());
  const json = (await res.json()) as { data?: { id: string }[] };
  return (json.data ?? []).map((m) => m.id).filter((id) => !/embed/i.test(id));
}

/** Read an SSE body, calling `onData` with each parsed `data:` JSON payload. */
async function readSse(res: Response, onData: (data: any) => void, bump: () => void): Promise<void> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bump();
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const payload = t.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        onData(JSON.parse(payload));
      } catch {}
    }
  }
}

function body(s: Settings, req: { messages: ChatMsg[]; schema?: object }, withSchema: boolean): object {
  return {
    model: s.model,
    temperature: s.temperature,
    stream: true,
    messages: req.messages,
    ...(withSchema && req.schema
      ? {
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'diagram', schema: req.schema, strict: false },
          },
        }
      : {}),
  };
}

const DEEP_OFF = 'Deep scan is off or not supported by this provider.';

/** Main's own Deep scan gate: the renderer alone cannot turn on tools. Returns the folder's realpath. */
export function deepCwd(s: Settings, path: string): string {
  if (!s.deepScan || !isCliProvider(s.provider)) throw new Error(DEEP_OFF);
  try {
    const real = realpathSync(path);
    if (statSync(real).isDirectory()) return real;
  } catch {}
  throw new Error('Choose the code folder again before scanning.');
}

export async function chat(
  s: Settings,
  key: string | undefined,
  req: { messages: ChatMsg[]; schema?: object },
  onChunk: (text: string) => void,
  signal: AbortSignal,
  extra: { cwd?: string; onProgress?: (text: string) => void } = {},
): Promise<string> {
  const deep: Deep | undefined = extra.cwd
    ? { cwd: extra.cwd, onProgress: extra.onProgress ?? (() => {}) }
    : undefined;
  if (s.provider === 'claude-code') return cliChat(s, req, onChunk, signal, deep);
  // Codex deep mode arrives in the next task; until then a deep request is refused, never run shallow.
  if (s.provider === 'codex' && !deep) return codexChat(s, req, onChunk, signal);
  if (deep) throw new Error(DEEP_OFF);
  const idle = new AbortController();
  let timer = setTimeout(() => idle.abort(new Error('LLM stopped responding')), IDLE_MS);
  const bump = () => {
    clearTimeout(timer);
    timer = setTimeout(() => idle.abort(new Error('LLM stopped responding')), IDLE_MS);
  };
  const both = AbortSignal.any([signal, idle.signal]);
  const url = `${base(s)}/chat/completions`;
  try {
    const send = (withSchema: boolean) =>
      fetch(url, {
        method: 'POST',
        headers: headers(key),
        body: JSON.stringify(body(s, req, withSchema)),
        signal: both,
      });
    let res = await send(true);
    if (res.status === 400 && req.schema) res = await send(false);
    if (!res.ok) throw new HttpError(res.status, await res.text());

    let text = '';
    // LM Studio routes a thinking model's schema-constrained output into reasoning_content.
    let reasoning = '';
    await readSse(
      res,
      (data) => {
        const delta = data.choices?.[0]?.delta;
        const piece: string | undefined = delta?.content;
        if (piece) {
          text += piece;
          onChunk(piece);
        } else if (delta?.reasoning_content) {
          reasoning += delta.reasoning_content;
          onChunk(delta.reasoning_content);
        }
      },
      bump,
    );
    return text || reasoning;
  } finally {
    clearTimeout(timer);
  }
}

/** Turn a transport error into a message a person can act on. */
export function friendlyError(e: unknown, s: Settings): string {
  const err = e as { name?: string; message?: string; status?: number; cause?: { code?: string } };
  if (err?.name === 'AbortError') return 'Stopped.';
  if (e instanceof CliMissing && s.provider === 'codex')
    return `${err.message} Install it (npm install -g @openai/codex), run "codex login" in a terminal, or set its path in Settings.`;
  if (e instanceof CliMissing)
    return `${err.message} Install it (npm install -g @anthropic-ai/claude-code), run "claude" once in a terminal to sign in, or set its path in Settings.`;
  const code = err?.cause?.code ?? '';
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || /fetch failed/i.test(err?.message ?? '')) {
    const url = URL.parse(s.baseUrl);
    if (url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      return `Can't reach the local server at ${s.baseUrl}. Start it and load a model.`;
    return `Can't reach ${s.baseUrl}. Check the base URL in Settings and your network.`;
  }
  if (err?.status === 401 || err?.status === 403)
    return 'The API key was rejected. Set a valid key in Settings.';
  if (err?.status === 404)
    return `Model "${s.model}" or endpoint not found at ${s.baseUrl}. Pick a model in the AI panel.`;
  return err?.message ?? String(e);
}
