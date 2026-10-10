import { describe, expect, it } from 'vitest';
import { channels, DEFAULT_SETTINGS, parseArgs, Settings } from './ipc';

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

  it('exposes no channel that reads a renderer-named path', () => {
    // `file:reopen` takes a path, but main reads it only when its key is a past dialog pick (files.test.ts).
    for (const channel of ['file:openPath', 'file:recent'])
      expect(() => parseArgs(channel as never, '/etc/passwd')).toThrow('unknown channel');
  });

  it('takes a free-form string only where reviewed, so a new path-reading channel fails here first', () => {
    // A zod schema's type, seen through optional/nullable/default wrappers.
    const kind = (schema: any): string =>
      ['optional', 'nullable', 'default'].includes(schema.def.type)
        ? kind(schema.def.innerType)
        : schema.def.type;
    const free = (schema: any) => ['string', 'unknown', 'any'].includes(kind(schema));
    const found = Object.entries(channels).flatMap(([channel, schema]: [string, any]) =>
      free(schema)
        ? [channel]
        : kind(schema) === 'object'
          ? Object.entries(schema.def.shape)
              .filter(([, field]) => free(field))
              .map(([field]) => `${channel}.${field}`)
          : [],
    );
    expect(found.sort()).toEqual(
      [
        'file:reopen', // a path: read only if a past dialog pick, after isSafePath (files.test.ts)
        'file:save.path', // a path: written only if this session's dialog pick, after isSafePath
        'file:save.content', // the diagram text written
        'recovery:write', // recovery text, written to a fixed file in userData
        'settings:set.baseUrl', // URL-validated; main fetches it as the API endpoint
        'settings:set.model', // model name passed to the provider
        'settings:set.cliPath', // a path: run only if it names the claude/codex binary (checkCliPath)
        'settings:set.apiKey', // stored in main, never echoed back
        'llm:chat.id', // request id echoed on llm:chunk
        'llm:chat.projectId', // UUID-validated opaque handle from project:choose
        'llm:cancel', // request id
        'project:scan.projectId', // UUID-validated opaque handle
        'project:scan.id', // request id
        'export:png.doc', // a diagram rendered offscreen, never a path
        'export:save.content', // export text written to the dialog's pick
        'export:save.name', // only a dialog default; main keeps its basename
      ].sort(),
    );
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

  it('reads legacy lmstudio settings but never saves them', () => {
    expect(Settings.parse({ ...DEFAULT_SETTINGS, provider: 'lmstudio' }).provider).toBe('lmstudio');
    expect(() => parseArgs('settings:set', { provider: 'lmstudio' })).toThrow();
    expect(parseArgs('settings:set', { provider: 'openai' })).toEqual({ provider: 'openai' });
  });

  it('rejects an unknown provider in settings', () => {
    expect(() => parseArgs('settings:set', { provider: 'evil' })).toThrow();
  });

  it('rejects a chat with a bad role', () => {
    expect(() => parseArgs('llm:chat', { id: 'a', messages: [{ role: 'tool', content: 'x' }] })).toThrow();
  });

  it('defaults Deep scan off for settings saved before it existed', () => {
    const { deepScan: _deep, ...legacy } = DEFAULT_SETTINGS;
    // getSettings() merges DEFAULT_SETTINGS first, so an old settings.json loads with Deep scan off.
    expect(Settings.parse({ ...DEFAULT_SETTINGS, ...legacy }).deepScan).toBe(false);
    expect(DEFAULT_SETTINGS.deepScan).toBe(false);
    expect(parseArgs('settings:set', { deepScan: true })).toEqual({ deepScan: true });
    expect(() => parseArgs('settings:set', { deepScan: 'yes' })).toThrow();
  });

  it('accepts an opaque folder id on chat and never a path', () => {
    const req = { id: 'r', messages: [{ role: 'user', content: 'x' }] };
    const projectId = 'a824c0af-924c-4f15-b190-2136b2a4b344';
    expect(parseArgs('llm:chat', { ...req, projectId })).toEqual({ ...req, projectId });
    expect(parseArgs('llm:chat', req)).toEqual(req);
    expect(() => parseArgs('llm:chat', { ...req, projectId: '/Users/me/repo' })).toThrow();
  });

  it('rejects an unknown channel', () => {
    expect(() => parseArgs('nope' as never, {})).toThrow(/unknown channel/);
  });
});
