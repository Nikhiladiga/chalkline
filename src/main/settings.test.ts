import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: {}, safeStorage: {} }));
const { normalizeSettings } = await import('./settings');

describe('settings normalisation', () => {
  it('migrates a stored LM Studio provider to the OpenAI-compatible API, keeping URL and model', () => {
    const s = normalizeSettings(
      { provider: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1', model: 'qwen3' },
      {},
    );
    expect(s).toMatchObject({ provider: 'openai', baseUrl: 'http://127.0.0.1:1234/v1', model: 'qwen3' });
  });

  it('treats a DG_LLM_BASE_URL override as an OpenAI-compatible server', () => {
    const s = normalizeSettings({ provider: 'claude-code' }, { DG_LLM_BASE_URL: 'http://127.0.0.1:9/v1' });
    expect(s).toMatchObject({ provider: 'openai', baseUrl: 'http://127.0.0.1:9/v1' });
  });

  it('migrates an lmstudio DG_LLM_PROVIDER override too', () => {
    expect(normalizeSettings({}, { DG_LLM_PROVIDER: 'lmstudio' }).provider).toBe('openai');
  });

  it('keeps other providers and the legacy anthropic migration', () => {
    expect(normalizeSettings({ provider: 'codex' }, {}).provider).toBe('codex');
    expect(normalizeSettings({ provider: 'anthropic' }, {}).provider).toBe('claude-code');
  });
});
