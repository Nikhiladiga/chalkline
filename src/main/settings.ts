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

export function getSettings(): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...readJson('settings.json') };
  // The Anthropic API provider was replaced by the Claude Code CLI.
  if (merged.provider === 'anthropic') Object.assign(merged, { provider: 'claude-code', model: 'default' });
  // Test/automation overrides.
  // A base URL override means an OpenAI-compatible server (mock or LM Studio) unless told otherwise.
  if (process.env.DG_LLM_BASE_URL)
    Object.assign(merged, { provider: 'lmstudio', baseUrl: process.env.DG_LLM_BASE_URL });
  if (process.env.DG_LLM_PROVIDER) merged.provider = process.env.DG_LLM_PROVIDER;
  if (process.env.DG_LLM_MODEL) merged.model = process.env.DG_LLM_MODEL;
  const parsed = Settings.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

/** API keys per provider, encrypted with the OS keychain via safeStorage. Never sent to the renderer. */
export function getKey(provider = getSettings().provider): string | undefined {
  const enc = readJson('keys.json')[provider];
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
  writeFileSync(file('settings.json'), JSON.stringify(next, null, 2));
  if (apiKey !== undefined) {
    const keys = readJson('keys.json');
    if (apiKey) keys[next.provider] = safeStorage.encryptString(apiKey).toString('base64');
    else delete keys[next.provider];
    writeFileSync(file('keys.json'), JSON.stringify(keys));
  }
  return publicSettings();
}
