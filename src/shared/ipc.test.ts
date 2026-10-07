import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseArgs, Settings } from './ipc';

describe('IPC payload validation', () => {
  it('loads legacy Detailed settings without a style field or losing other preferences', () => {
    const saved = Settings.parse({
      ...DEFAULT_SETTINGS,
      aiStyle: 'detailed',
      provider: 'codex',
      model: 'custom-model',
      theme: 'light',
    });
    expect(saved).not.toHaveProperty('aiStyle');
    expect(saved).toMatchObject({ provider: 'codex', model: 'custom-model', theme: 'light' });
  });
  it('accepts a valid save payload', () => {
    expect(parseArgs('file:save', { path: null, content: '{}' })).toEqual({ path: null, content: '{}' });
  });

  it('rejects a non-string path', () => {
    expect(() => parseArgs('file:save', { path: 3, content: '{}' })).toThrow();
  });

  it('only accepts bounded scans with opaque folder handles', () => {
    const scan = { projectId: 'a824c0af-924c-4f15-b190-2136b2a4b344', id: 'request', maxChars: 16000 };
    expect(parseArgs('project:scan', scan)).toEqual(scan);
    expect(() => parseArgs('project:scan', { ...scan, projectId: '/etc' })).toThrow();
    expect(() => parseArgs('project:scan', { ...scan, maxChars: 9999999 })).toThrow();
  });

  it('rejects an unknown export kind', () => {
    expect(() => parseArgs('export:save', { kind: 'exe', content: 'x', name: 'a' })).toThrow();
  });

  it('rejects an unknown provider in settings', () => {
    expect(() => parseArgs('settings:set', { provider: 'evil' })).toThrow();
  });

  it('rejects a chat with a bad role', () => {
    expect(() => parseArgs('llm:chat', { id: 'a', messages: [{ role: 'tool', content: 'x' }] })).toThrow();
  });

  it('rejects an unknown channel', () => {
    expect(() => parseArgs('nope' as never, {})).toThrow(/unknown channel/);
  });
});
