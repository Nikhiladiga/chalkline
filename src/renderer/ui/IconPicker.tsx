import { useMemo, useState } from 'react';
import { findIcons } from './iconCatalog';
import { Modal } from './Modal';
import { useUi } from './uiStore';

export function IconPicker() {
  const pick = useUi((s) => s.iconPick);
  const [q, setQ] = useState('');
  const results = useMemo(() => findIcons(q).slice(0, 240), [q]);
  const close = () => useUi.getState().set({ iconPick: null });
  return (
    <Modal open={!!pick} title="Choose an icon" className="wide icons" onClose={close}>
      <div className="modal-body">
        <input
          className="input"
          data-autofocus
          placeholder="Search 3,800+ icons — try “lambda”, “postgres”, “user”"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="icon-grid">
          {!results.length && <p className="muted">No icon matches “{q}”.</p>}
          {results.map((n) => (
            <button
              key={n}
              type="button"
              className="icon-cell"
              title={n}
              onClick={() => {
                pick?.(n); // null only during the exit animation
                close();
              }}
            >
              <img src={`icons://i/${n}.svg`} alt="" loading="lazy" />
              <span>{n.replace(/-/g, ' ')}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
