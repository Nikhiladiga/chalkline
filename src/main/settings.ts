import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, safeStorage } from 'electron';
import { DEFAULT_SETTINGS, DEFAULT_URLS, type PublicSettings, Settings } from '../shared/ipc';
import { checkCliPath } from './claudeCli';

const file = (name: string) => join(app.getPath('userData'), name);

function readJson(name: string): any {
  try {
    return JSON.parse(readFileSync(file(name), 'utf8'));
  } catch {
    return {};
  }
}

/** Stored settings plus env overrides, migrated to the current provider set. Pure, for tests. */
export function normalizeSettings(
  stored: Record<string, unknown>,
  env: Record<string, string | undefined>,
): Settings {
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS, ...stored };
  // The Anthropic API provider was replaced by the Claude Code CLI.
  if (merged.provider === 'anthropic') Object.assign(merged, { provider: 'claude-code', model: 'default' });
  // Test/automation overrides. A base URL override means an OpenAI-compatible server unless told otherwise.
  if (env.DG_LLM_BASE_URL) Object.assign(merged, { provider: 'openai', baseUrl: env.DG_LLM_BASE_URL });
  if (env.DG_LLM_PROVIDER) merged.provider = env.DG_LLM_PROVIDER;
  if (env.DG_LLM_MODEL) merged.model = env.DG_LLM_MODEL;
  // LM Studio is now an API preset: same URL and model, OpenAI-compatible provider.
  if (merged.provider === 'lmstudio') merged.provider = 'openai';
  const parsed = Settings.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export function getSettings(): Settings {
  return normalizeSettings(readJson('settings.json'), process.env);
}

const origin = (url: unknown) => URL.parse(String(url))?.origin ?? String(url);

/** keys.json entry: one per OpenAI-compatible server origin, so a key never reaches a server it wasn't saved for. */
export function keySlot(s: Pick<Settings, 'provider' | 'baseUrl'>): string {
  return s.provider === 'openai' ? `openai@${origin(s.baseUrl)}` : s.provider;
}

/**
 * Encrypted key for `s`. A pre-origin `keys.openai` counts only where the settings file itself pointed an
 * `openai` provider (never settings migrated from `lmstudio`, never after the URL changes).
 */
export function storedKey(
  keys: Record<string, string>,
  raw: Record<string, unknown>,
  s: Settings,
): string | undefined {
  const slot = keySlot(s);
  if (keys[slot]) return keys[slot];
  if (
    s.provider === 'openai' &&
    raw.provider === 'openai' &&
    slot === keySlot({ provider: 'openai', baseUrl: String(raw.baseUrl ?? DEFAULT_URLS.openai) })
  )
    return keys.openai;
  return undefined;
}

/** Before a save can change the URL, pin `keys.openai` to the origin it was saved with (or park it unread). */
export function rebindLegacyKey(
  keys: Record<string, string>,
  raw: Record<string, unknown>,
): Record<string, string> {
  const { openai, ...rest } = keys;
  if (!openai) return keys;
  const slot =
    raw.provider === 'openai'
      ? keySlot({ provider: 'openai', baseUrl: String(raw.baseUrl ?? DEFAULT_URLS.openai) })
      : 'openai@unknown';
  return { [slot]: openai, ...rest };
}

/** API keys, encrypted with the OS keychain via safeStorage. Never sent to the renderer. */
export function getKey(s = getSettings()): string | undefined {
  const enc = storedKey(readJson('keys.json'), readJson('settings.json'), s);
  if (!enc) return undefined;
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'));
  } catch {
    return undefined;
  }
}

export function publicSettings(): PublicSettings {
  return { ...getSettings(), hasKey: Boolean(getKey()) };
}

export function setSettings(patch: Partial<Settings> & { apiKey?: string }): PublicSettings {
  const { apiKey, ...rest } = patch;
  const current = getSettings();
  // Switching provider without an explicit URL resets the URL to that provider's default.
  if (rest.provider && rest.provider !== current.provider && !rest.baseUrl)
    rest.baseUrl = DEFAULT_URLS[rest.provider];
  const next = Settings.parse({ ...current, ...rest });
  // Checked again before every spawn; here so a bad path is refused when it is entered.
  const harness = next.provider === 'codex' ? 'codex' : next.provider === 'claude-code' ? 'claude' : null;
  if (harness && next.cliPath && ('cliPath' in rest || 'provider' in rest))
    checkCliPath(next.cliPath, harness);
  const keys = rebindLegacyKey(readJson('keys.json'), readJson('settings.json'));
  if (apiKey) keys[keySlot(next)] = safeStorage.encryptString(apiKey).toString('base64');
  else if (apiKey !== undefined) delete keys[keySlot(next)];
  writeFileSync(file('keys.json'), JSON.stringify(keys));
  writeFileSync(file('settings.json'), JSON.stringify(next, null, 2));
  return publicSettings();
}
