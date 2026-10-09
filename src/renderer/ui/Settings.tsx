import { useEffect, useState } from 'react';
import { DEFAULT_URLS, type Provider, type PublicSettings } from '../../shared/ipc';
import { ipcMessage } from './actions';
import { Modal } from './Modal';
import { useUi } from './uiStore';

const PROVIDERS: [Provider, string][] = [
  ['lmstudio', 'LM Studio (local)'],
  ['openai', 'OpenAI-compatible API (key)'],
];
const HARNESS_LABELS = { codex: 'Codex CLI', 'claude-code': 'Claude Code CLI' };
type Harness = keyof typeof HARNESS_LABELS;

export function Settings() {
  const open = useUi((s) => s.settingsOpen);
  const [s, setS] = useState<PublicSettings | null>(null);
  const [key, setKey] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [harnesses, setHarnesses] = useState<{ provider: Harness; path: string }[]>([]);
  useEffect(() => {
    if (open) {
      setStatus(null);
      setKey('');
      void window.api.invoke('settings:get').then(setS);
      void window.api
        .invoke('llm:harnesses')
        .then(setHarnesses)
        .catch((e) => setStatus(ipcMessage(e)));
    }
  }, [open]);
  if (!s) return null; // first open: wait for settings, then the dialog mounts already open
  const close = () => useUi.getState().set({ settingsOpen: false });
  const patch = (p: Partial<PublicSettings>) => setS({ ...s, ...p });
  const cli = s.provider === 'claude-code' || s.provider === 'codex';

  const persist = async () => {
    const { hasKey: _h, ...rest } = s;
    const saved = await window.api.invoke('settings:set', { ...rest, ...(key ? { apiKey: key } : {}) });
    setS(saved);
    setKey('');
    return saved as PublicSettings;
  };
  const test = async () => {
    setStatus('Connecting…');
    try {
      const saved = await persist();
      const models: string[] = await window.api.invoke('llm:models');
      setStatus(
        saved.provider === 'claude-code' || saved.provider === 'codex'
          ? `${HARNESS_LABELS[saved.provider]} found. Sign in through the CLI before generating diagrams.`
          : models.length
            ? `Connected. ${models.length} model(s): ${models.slice(0, 4).join(', ')}${models.length > 4 ? '…' : ''}`
            : 'Connected, but no models are available. Load one in LM Studio.',
      );
    } catch (e) {
      setStatus(ipcMessage(e));
    }
  };

  return (
    <Modal
      open={open}
      title="Settings"
      onClose={close}
      footer={
        <>
          <button type="button" className="btn secondary" onClick={test}>
            Test connection
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={async () => {
              try {
                await persist();
                close();
              } catch (e) {
                setStatus(ipcMessage(e));
              }
            }}
          >
            Save settings
          </button>
        </>
      }
    >
      <div className="modal-body">
        <section className="modal-group">
          <h3>Provider</h3>
          <label className="field">
            <span>AI provider</span>
            <select
              className="select"
              data-autofocus
              value={cli ? 'cli' : s.provider}
              onChange={(e) => {
                const provider =
                  e.target.value === 'cli'
                    ? (harnesses[0]?.provider ?? 'codex')
                    : (e.target.value as Provider);
                patch({
                  provider,
                  baseUrl: DEFAULT_URLS[provider],
                  model: provider === 'claude-code' || provider === 'codex' ? 'default' : '',
                  cliPath: '',
                });
              }}
            >
              {PROVIDERS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
              <option value="cli">Local CLI (existing login)</option>
            </select>
          </label>
          {cli && (
            <label className="field">
              <span>Installed harness</span>
              <select
                className="select"
                value={s.provider}
                onChange={(e) => {
                  const provider = e.target.value as Harness;
                  patch({ provider, baseUrl: DEFAULT_URLS[provider], model: 'default', cliPath: '' });
                }}
              >
                {harnesses.map(({ provider }) => (
                  <option key={provider} value={provider}>
                    {HARNESS_LABELS[provider]} (installed)
                  </option>
                ))}
                {(Object.keys(HARNESS_LABELS) as Harness[])
                  .filter((provider) => !harnesses.some((h) => h.provider === provider))
                  .map((provider) => (
                    <option key={provider} value={provider}>
                      {HARNESS_LABELS[provider]} (custom path required)
                    </option>
                  ))}
              </select>
              <span className="note">
                Supported harnesses: Codex and Claude Code. Uses their saved login; no app API key needed.
              </span>
            </label>
          )}
          {cli ? (
            <label className="field">
              <span>{HARNESS_LABELS[s.provider as Harness]} path</span>
              <input
                className="input"
                value={s.cliPath}
                placeholder={
                  harnesses.find((h) => h.provider === s.provider)?.path ??
                  'Enter the executable path, or install the CLI and reopen Settings'
                }
                onChange={(e) => patch({ cliPath: e.target.value })}
              />
            </label>
          ) : (
            <label className="field">
              <span>Base URL</span>
              <input
                className="input"
                value={s.baseUrl}
                onChange={(e) => patch({ baseUrl: e.target.value })}
              />
            </label>
          )}
          {s.provider === 'openai' && (
            <label className="field">
              <span>API key {s.hasKey && '(saved — leave empty to keep it)'}</span>
              <input
                className="input"
                type="password"
                autoComplete="off"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={s.hasKey ? '••••••••' : 'Paste your key'}
              />
            </label>
          )}
        </section>
        <section className="modal-group">
          <h3>Generation</h3>
          <label className="field">
            <span>Model</span>
            <input
              className="input"
              value={s.model}
              placeholder={
                s.provider === 'codex'
                  ? 'default (CLI configuration), or a Codex model id'
                  : cli
                    ? 'default, opus, sonnet or haiku'
                    : 'Pick in the AI panel, or type an id'
              }
              onChange={(e) => patch({ model: e.target.value })}
            />
          </label>
          <div className="row">
            {!cli && (
              <label className="field grow">
                <span>Temperature</span>
                <input
                  className="input"
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={s.temperature}
                  onChange={(e) => patch({ temperature: Number(e.target.value) })}
                />
              </label>
            )}
            <label className="field grow">
              <span>Repair attempts</span>
              <input
                className="input"
                type="number"
                min="0"
                max="5"
                value={s.maxRepairs}
                onChange={(e) => patch({ maxRepairs: Number(e.target.value) })}
              />
            </label>
          </div>
        </section>
        <section className="modal-group">
          <h3>Icons</h3>
          <label className="check">
            <input
              type="checkbox"
              checked={s.hostedIcons}
              onChange={(e) => patch({ hostedIcons: e.target.checked })}
            />
            Download missing icons from Eraser's public icon library (cached on disk)
          </label>
        </section>
        {status && <div className="note">{status}</div>}
      </div>
    </Modal>
  );
}
