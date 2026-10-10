import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: {}, safeStorage: {} }));
const { normalizeSettings, keySlot, storedKey, rebindLegacyKey } = await import('./settings');

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

describe('API keys are scoped to the server origin', () => {
  const at = (baseUrl: string) => normalizeSettings({ provider: 'openai', baseUrl }, {});
  const openai = { provider: 'openai', baseUrl: 'https://api.openai.com/v1' };

  it('a key saved for one origin is not offered to another', () => {
    const keys = { [keySlot(at('https://api.openai.com/v1'))]: 'enc' };
    expect(storedKey(keys, openai, at('https://api.openai.com/v1'))).toBe('enc');
    expect(storedKey(keys, openai, at('http://127.0.0.1:1234/v1'))).toBeUndefined();
    expect(storedKey(keys, openai, at('http://127.0.0.1:11434/v1'))).toBeUndefined();
  });

  it('a pre-origin openai key still works for the server it was saved with', () => {
    expect(storedKey({ openai: 'legacy' }, openai, at('https://api.openai.com/v1'))).toBe('legacy');
    expect(storedKey({ openai: 'legacy' }, openai, at('http://127.0.0.1:1234/v1'))).toBeUndefined();
  });

  it('settings migrated from lmstudio never get the legacy openai key', () => {
    const raw = { provider: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1' };
    const s = normalizeSettings(raw, {});
    expect(s.provider).toBe('openai');
    expect(storedKey({ openai: 'legacy' }, raw, s)).toBeUndefined();
  });

  it('saving pins the legacy key to its own origin, so a later URL change cannot pick it up', () => {
    const pinned = rebindLegacyKey({ openai: 'legacy' }, openai);
    expect(pinned).toEqual({ 'openai@https://api.openai.com': 'legacy' });
    // After a save that moves to LM Studio, the file says openai at :1234 and still gets no key.
    const moved = { provider: 'openai', baseUrl: 'http://127.0.0.1:1234/v1' };
    expect(storedKey(pinned, moved, at(moved.baseUrl))).toBeUndefined();
    // A key whose server is unknown (migrated lmstudio) is parked where nothing reads it.
    const parked = rebindLegacyKey({ openai: 'legacy' }, { provider: 'lmstudio' });
    expect(parked).not.toHaveProperty('openai');
    expect(storedKey(parked, moved, at(moved.baseUrl))).toBeUndefined();
  });

  it('CLI providers keep their own slot', () => {
    expect(keySlot(normalizeSettings({ provider: 'codex' }, {}))).toBe('codex');
  });
});
