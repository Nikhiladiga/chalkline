import { z } from 'zod';

/** 'lmstudio' is read from old settings files only; main migrates it to 'openai' (an API preset now). */
export const Provider = z.enum(['lmstudio', 'openai', 'claude-code', 'codex']);
export type Provider = z.infer<typeof Provider>;
/**
 * Providers that can Deep scan; the UI and main both check this. Codex's deep code and tests stay, but it is
 * hidden until the Codex gate in the deep-scan manual acceptance passes; then add 'codex' here and word the
 * consent dialog in main/index.ts for it.
 */
export const DEEP_SCAN_PROVIDERS: readonly Provider[] = ['claude-code'];
export const canDeepScan = (p: Provider): boolean => DEEP_SCAN_PROVIDERS.includes(p);

export const Settings = z.object({
  provider: Provider,
  baseUrl: z.string().url(),
  model: z.string(),
  /** Selected CLI binary; empty = find it automatically. */
  cliPath: z.string(),
  temperature: z.number().min(0).max(2),
  maxRepairs: z.number().int().min(0).max(5),
  contextSize: z.number().int().min(1024).max(1_000_000),
  hostedIcons: z.boolean(),
  theme: z.enum(['dark', 'light']),
  /** Opt-in: let the Claude Code / Codex CLI read the chosen code folder with read-only tools. */
  deepScan: z.boolean(),
});
export type Settings = z.infer<typeof Settings>;
/** What the renderer sees: never the key itself. */
export type PublicSettings = Settings & { hasKey: boolean };

export const DEFAULT_URLS: Record<Provider, string> = {
  lmstudio: 'http://127.0.0.1:1234/v1',
  openai: 'https://api.openai.com/v1',
  // Unused: the CLI talks to Anthropic itself, with the user's own Claude login.
  'claude-code': 'https://api.anthropic.com/v1',
  codex: 'https://api.openai.com/v1',
};

export const DEFAULT_SETTINGS: Settings = {
  provider: 'claude-code',
  baseUrl: DEFAULT_URLS['claude-code'],
  model: 'default',
  cliPath: '',
  temperature: 0.2,
  maxRepairs: 2,
  contextSize: 16384,
  hostedIcons: true,
  theme: 'dark',
  deepScan: false,
};

const ChatMsg = z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string() });
export type ChatMsg = z.infer<typeof ChatMsg>;

/** Every invoke channel and the zod schema of its single argument. */
export const channels = {
  'file:open': z.undefined(),
  /** Re-read a file chosen earlier in an Open/Save dialog (crash recovery); null if unknown or unreadable. */
  'file:reopen': z.string(),
  'file:save': z.object({ path: z.string().nullable(), content: z.string() }),
  'recovery:write': z.string(),
  'recovery:read': z.undefined(),
  'recovery:clear': z.undefined(),
  'settings:get': z.undefined(),
  'settings:set': Settings.partial().extend({
    provider: Provider.exclude(['lmstudio']).optional(),
    apiKey: z.string().optional(),
  }),
  'llm:models': z.undefined(),
  'llm:harnesses': z.undefined(),
  'llm:chat': z.object({
    id: z.string(),
    messages: z.array(ChatMsg).min(1),
    schema: z.record(z.string(), z.unknown()).optional(),
    /** Deep scan only: an opaque folder handle from project:choose, never a path. */
    projectId: z.string().uuid().optional(),
  }),
  'llm:cancel': z.string(),
  'project:choose': z.undefined(),
  'project:scan': z.object({
    projectId: z.string().uuid(),
    id: z.string().min(1),
    maxChars: z.number().int().min(4000).max(120000),
  }),
  'export:png': z.object({
    doc: z.unknown(),
    scale: z.union([z.literal(1), z.literal(2)]),
    transparent: z.boolean(),
    theme: z.enum(['dark', 'light']),
    clipboard: z.boolean(),
  }),
  'export:save': z.object({ kind: z.enum(['svg', 'html', 'json']), content: z.string(), name: z.string() }),
  'app:dirty': z.boolean(),
  /** Copied diagram elements, as JSON text, onto the system clipboard (main has no focus requirement). */
  'clipboard:write': z.string().max(10_000_000),
  'clipboard:read': z.undefined(),
} as const;
export type Channel = keyof typeof channels;
export type Args<C extends Channel> = z.infer<(typeof channels)[C]>;

export function parseArgs<C extends Channel>(channel: C, arg: unknown): Args<C> {
  const schema = channels[channel];
  if (!schema) throw new Error(`unknown channel ${String(channel)}`);
  return schema.parse(arg) as Args<C>;
}

export interface OpenedFile {
  path: string;
  content: string;
  /** Main's identity for the file (realpath, case-folded on macOS/Windows): the same file opens once. */
  key: string;
}

/** Where `file:save` wrote: the path and its key, so the renderer can tell which open tab is that file. */
export type SavedFile = Omit<OpenedFile, 'content'>;

/** The `window.api` surface the preload exposes. */
export interface Api {
  invoke<C extends Channel>(channel: C, arg?: Args<C>): Promise<any>;
  on(event: 'llm:chunk' | 'llm:progress' | 'menu' | 'export:render', cb: (payload: any) => void): () => void;
  /** Export window → main: the rendered scene's rect (or an error). */
  exportReady(payload: { width: number; height: number } | { error: string }): void;
}
