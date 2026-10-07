import { useMemo, useState } from 'react';
import { findIcons } from './iconCatalog';
import { IconClose } from './icons';
import { useUi } from './uiStore';

export function IconPicker() {
  const pick = useUi((s) => s.iconPick);
  const [q, setQ] = useState('');
  const results = useMemo(() => findIcons(q).slice(0, 240), [q]);
  if (!pick) return null;
  const close = () => useUi.getState().set({ iconPick: null });
  return (
    <div className="scrim" onPointerDown={close}>
      <div
        className="modal wide icons"
        role="dialog"
        aria-label="Choose an icon"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          Choose an icon
          <button type="button" className="btn icon" aria-label="Close" onClick={close}>
            <IconClose />
          </button>
        </div>
        <div className="modal-body">
          <input
            className="input"
            autoFocus
            placeholder="Search 3,800+ icons — try “lambda”, “postgres”, “user”"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="icon-grid">
            {!results.length && (
              <p className="muted" style={{ gridColumn: '1 / -1' }}>
                No icon matches “{q}”.
              </p>
            )}
            {results.map((n) => (
              <button
                key={n}
                type="button"
                className="icon-cell"
                title={n}
                onClick={() => {
                  pick(n);
                  close();
                }}
              >
                <img src={`icons://i/${n}.svg`} alt="" loading="lazy" />
                <span>{n.replace(/-/g, ' ')}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
