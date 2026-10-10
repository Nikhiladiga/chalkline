import { useShallow } from 'zustand/react/shallow';
import { tabTitle, useTab, useTabs } from '../doc/store';
import { closeTab, newTab, switchTab } from './actions';
import { IconClose, IconPlus } from './icons';
import { isMac, mod } from './platform';

const ctl = isMac ? 'Meta' : 'Control';

/** Chrome-style document tabs in the title bar. Empty strip space stays a window drag region. */
export function TabStrip() {
  const ids = useTabs(useShallow((s) => s.tabs.map((t) => t.id)));
  const activeId = useTabs((s) => s.activeId);
  return (
    <div className="tabstrip">
      <div className="tabs" role="tablist" aria-label="Open diagrams">
        {ids.map((id) => (
          <DocTab key={id} id={id} active={id === activeId} />
        ))}
      </div>
      <button
        type="button"
        className="btn icon tab-new"
        aria-label="New tab"
        data-tip="New tab"
        data-kbd={`${mod}T`}
        aria-keyshortcuts={`${ctl}+T`}
        onClick={() => newTab()}
      >
        <IconPlus />
      </button>
    </div>
  );
}

function DocTab({ id, active }: { id: string; active: boolean }) {
  const title = useTab(id, tabTitle);
  const path = useTab(id, (t) => t.filePath);
  const dirty = useTab(id, (t) => t.dirty);
  const busy = useTab(id, (t) => t.busy);
  if (title === undefined) return null;
  return (
    <div className="doc-tab" data-active={active || undefined}>
      <button
        type="button"
        role="tab"
        id={`doc-tab-${id}`}
        className="tab-main"
        aria-selected={active}
        aria-controls="doc-panel"
        tabIndex={active ? 0 : -1}
        title={path ?? title}
        onClick={(e) => {
          switchTab(id);
          e.currentTarget.focus(); // switching blurs the field being left; keep focus on the tab
        }}
        onMouseDown={(e) => {
          if (e.button === 1) e.preventDefault(); // no autoscroll cursor
        }}
        onAuxClick={(e) => {
          if (e.button === 1) closeTab(id);
        }}
      >
        {busy && <span className="spinner" aria-hidden="true" />}
        <span className="tab-title">{title}</span>
        {busy && <span className="sr-only"> — AI running</span>}
        {dirty && (
          <span className="dirty-dot">
            <span className="sr-only"> — edited</span>
          </span>
        )}
      </button>
      {/* Mouse affordance only; keyboard users close with ⌘W (and Delete, Task 7). */}
      <button
        type="button"
        className="tab-close"
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => closeTab(id)}
      >
        <IconClose />
      </button>
    </div>
  );
}
