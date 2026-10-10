import { type KeyboardEvent, useEffect, useState } from 'react';
import { DEFAULT_URLS, type PublicSettings } from '../../shared/ipc';
import { ipcMessage } from './actions';
import { IconCheck, IconTerminal } from './icons';
import { Modal } from './Modal';
import { useUi } from './uiStore';

const HARNESS_LABELS = { 'claude-code': 'Claude Code CLI', codex: 'Codex CLI' };
type Harness = keyof typeof HARNESS_LABELS;
// Monogram tiles, not vendor marks: third-party logos need their owners' permission.
const MONOGRAMS: Record<Harness, string> = { 'claude-code': 'CC', codex: 'CX' };
const PRESETS = [
  { name: 'LM Studio', url: 'http://127.0.0.1:1234/v1', hint: 'Port 1234' },
  { name: 'Ollama', url: 'http://127.0.0.1:11434/v1', hint: 'Port 11434' },
  { name: 'OpenAI', url: 'https://api.openai.com/v1', hint: 'api.openai.com' },
];

/** Radiogroup keyboard: arrows move focus and selection together (WAI-ARIA radio pattern). */
function arrows(e: KeyboardEvent<HTMLElement>) {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (!step) return;
  e.preventDefault();
  const radios = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')];
  const next =
    radios[(radios.indexOf(document.activeElement as HTMLElement) + step + radios.length) % radios.length];
  next?.focus();
  next?.click();
}
const radio = (checked: boolean) => ({ role: 'radio', 'aria-checked': checked, tabIndex: checked ? 0 : -1 });

export function Settings() {
  const open = useUi((s) => s.settingsOpen);
  const [s, setS] = useState<PublicSettings | null>(null);
  // Saved keys belong to one server origin (main scopes them), so hasKey only holds for the saved URL's origin.
  const [savedUrl, setSavedUrl] = useState('');
  const [key, setKey] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);
  // null while detection runs, so cards say "Checking" instead of flashing "Not found".
  const [harnesses, setHarnesses] = useState<{ provider: Harness; path: string }[] | null>(null);
  useEffect(() => {
    if (open) {
      setStatus(null);
      setKey('');
      setCustom(false);
      setHarnesses(null);
      void window.api.invoke('settings:get').then((v) => {
        setS(v);
        setSavedUrl(v.baseUrl);
      });
      void window.api
        .invoke('llm:harnesses')
        .then(setHarnesses)
        .catch((e) => {
          setHarnesses([]);
          setStatus(ipcMessage(e));
        });
    }
  }, [open]);
  if (!s) return null; // first open: wait for settings, then the dialog mounts already open
  const close = () => useUi.getState().set({ settingsOpen: false });
  const patch = (p: Partial<PublicSettings>) => setS({ ...s, ...p });
  const cli = s.provider === 'claude-code' || s.provider === 'codex';
  const keySaved = s.hasKey && URL.parse(s.baseUrl)?.origin === URL.parse(savedUrl)?.origin;
  const preset = custom ? undefined : PRESETS.find((p) => p.url === s.baseUrl.replace(/\/+$/, ''));
  const setHarness = (provider: Harness) =>
    patch({ provider, baseUrl: DEFAULT_URLS[provider], model: 'default', cliPath: '' });
  const setKind = (toCli: boolean) => {
    if (toCli === cli) return;
    setCustom(false);
    if (toCli) setHarness(harnesses?.[0]?.provider ?? 'claude-code');
    else patch({ provider: 'openai', baseUrl: PRESETS[0]!.url, model: '', cliPath: '' });
  };

  const persist = async () => {
    const { hasKey: _h, provider, ...rest } = s;
    const saved = await window.api.invoke('settings:set', {
      ...rest,
      provider: provider === 'lmstudio' ? 'openai' : provider, // type-only: main never returns 'lmstudio'
      ...(key ? { apiKey: key } : {}),
    });
    setS(saved);
    setSavedUrl(saved.baseUrl);
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
            : 'Connected, but the server lists no models. Load one, then test again.',
      );
    } catch (e) {
      setStatus(ipcMessage(e));
    }
  };

  return (
    <Modal
      open={open}
      title="Settings"
      className="settings"
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
          <div
            className="seg kind"
            role="radiogroup"
            aria-label="AI provider"
            data-active={cli ? 0 : 1}
            onKeyDown={arrows}
          >
            <button
              type="button"
              {...radio(cli)}
              data-autofocus={cli || undefined}
              onClick={() => setKind(true)}
            >
              Installed CLI
            </button>
            <button
              type="button"
              {...radio(!cli)}
              data-autofocus={!cli || undefined}
              onClick={() => setKind(false)}
            >
              API
            </button>
          </div>
          {/* Keyed by kind so the swapped region fades in (0 ms in test mode and reduced motion). */}
          <div className="provider-pane" key={cli ? 'cli' : 'api'}>
            {cli ? (
              <>
                <div className="field">
                  <span id="harness-label">Harness</span>
                  <div
                    className="choice-cards"
                    role="radiogroup"
                    aria-labelledby="harness-label"
                    onKeyDown={arrows}
                  >
                    {(Object.keys(HARNESS_LABELS) as Harness[]).map((h) => {
                      const found = harnesses?.find((x) => x.provider === h);
                      return (
                        <button
                          key={h}
                          type="button"
                          className="choice-card harness"
                          data-harness={h}
                          {...radio(s.provider === h)}
                          aria-label={HARNESS_LABELS[h]}
                          aria-describedby={`harness-${h}-status`}
                          onClick={() => setHarness(h)}
                        >
                          <span className="monogram" aria-hidden="true">
                            {MONOGRAMS[h]}
                            <span className="monogram-term">
                              <IconTerminal />
                            </span>
                          </span>
                          <span className="choice-text">
                            <span className="choice-name">{HARNESS_LABELS[h]}</span>
                            <span id={`harness-${h}-status`} className="harness-status">
                              {!harnesses ? (
                                <span className="badge">Checking…</span>
                              ) : found ? (
                                <>
                                  <span className="badge ok">
                                    <IconCheck />
                                    Installed
                                  </span>
                                  <span className="choice-hint" title={found.path}>
                                    {found.path}
                                  </span>
                                </>
                              ) : (
                                <>
                                  <span className="badge">Not found</span>
                                  <span className="choice-hint">Set its path below</span>
                                </>
                              )}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <label className="field">
                  <span>{HARNESS_LABELS[s.provider as Harness]} path</span>
                  <input
                    className="input"
                    value={s.cliPath}
                    placeholder={
                      harnesses?.find((h) => h.provider === s.provider)?.path ??
                      'Enter the executable path, or install the CLI and reopen Settings'
                    }
                    onChange={(e) => patch({ cliPath: e.target.value })}
                  />
                  <span className="field-note">Uses the CLI's saved login. No API key needed.</span>
                </label>
              </>
            ) : (
              <>
                <div className="field">
                  <span aria-hidden="true">Server</span>
                  <div
                    className="choice-cards presets"
                    role="radiogroup"
                    aria-label="Server preset"
                    onKeyDown={arrows}
                  >
                    {[...PRESETS, { name: 'Custom', url: '', hint: 'Your own URL' }].map((p) => {
                      const checked = p.url ? preset === p : !preset;
                      return (
                        <button
                          key={p.name}
                          type="button"
                          className="choice-card preset"
                          {...radio(checked)}
                          aria-label={p.name}
                          onClick={() => {
                            setCustom(!p.url);
                            if (p.url && p.url !== s.baseUrl) patch({ baseUrl: p.url, model: '' });
                          }}
                        >
                          <span className="choice-name">{p.name}</span>
                          <span className="choice-hint">{p.hint}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <label className="field">
                  <span>Base URL</span>
                  <input
                    className="input"
                    value={s.baseUrl}
                    onChange={(e) => {
                      setCustom(true);
                      patch({ baseUrl: e.target.value });
                    }}
                  />
                </label>
                <label className="field">
                  <span>
                    API key{' '}
                    <span className="field-hint">
                      {keySaved ? 'saved, leave empty to keep it' : 'optional'}
                    </span>
                  </span>
                  <input
                    className="input"
                    type="password"
                    autoComplete="off"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder={keySaved ? '••••••••' : 'Not needed for local servers'}
                  />
                </label>
              </>
            )}
          </div>
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
