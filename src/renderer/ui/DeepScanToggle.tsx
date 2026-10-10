import { useId } from 'react';
import type { Provider } from '../../shared/ipc';

/** Opt-in switch that lets the CLI read the chosen folder itself (the isolation exception in AGENTS.md). */
export function DeepScanToggle({
  provider,
  checked,
  busy,
  onChange,
}: {
  provider: Provider;
  checked: boolean;
  busy: boolean;
  onChange(on: boolean): void;
}) {
  const desc = useId();
  return (
    <>
      <label className="check">
        <input
          type="checkbox"
          role="switch"
          aria-checked={checked}
          aria-describedby={desc}
          checked={checked}
          disabled={busy}
          onChange={(e) => onChange(e.target.checked)}
        />
        Deep scan
      </label>
      {provider === 'codex' ? (
        <p id={desc} className="note bad">
          Lets Codex read this folder (read-only). Codex can't block secret files like .env — only use on
          folders without secrets. Uses your plan's quota and takes longer.
        </p>
      ) : (
        <p id={desc} className="muted">
          Lets Claude Code read this folder (read-only). Secret files like .env and keys are blocked. Uses
          your plan's quota and takes longer.
        </p>
      )}
    </>
  );
}
