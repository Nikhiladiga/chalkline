import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { moveTab, tabTitle, useTab, useTabs } from '../doc/store';
import { closeTab, newTab, switchTab } from './actions';
import { IconClose, IconPlus } from './icons';
import { isMac, mod } from './platform';

const ctl = isMac ? 'Meta' : 'Control';
const TAB_MIME = 'application/x-chalkline-tab';

/** Chrome-style document tabs in the title bar. Empty strip space stays a window drag region. */
export function TabStrip() {
  const ids = useTabs(useShallow((s) => s.tabs.map((t) => t.id)));
  const activeId = useTabs((s) => s.activeId);

  // Tablist keys (automatic activation, wrapping); stopPropagation keeps the canvas shortcuts out.
  const onKeyDown = (e: KeyboardEvent) => {
    const i = ids.indexOf(activeId);
    const to =
      e.key === 'ArrowRight'
        ? i + 1
        : e.key === 'ArrowLeft'
          ? i - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? ids.length - 1
              : null;
    if (to === null && e.key !== 'Delete' && e.key !== 'Backspace') return;
    e.preventDefault();
    e.stopPropagation();
    if (to === null) closeTab(activeId);
    else switchTab(ids[(to + ids.length) % ids.length]!);
    document.getElementById(`doc-tab-${useTabs.getState().activeId}`)?.focus();
  };

  return (
    <div className="tabstrip">
      <div
        className="tabs"
        role="tablist"
        aria-label="Open diagrams"
        onKeyDown={onKeyDown}
        onWheel={(e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
        }}
      >
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
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<'src' | 'over' | null>(null);
  const title = useTab(id, tabTitle);
  const path = useTab(id, (t) => t.filePath);
  const dirty = useTab(id, (t) => t.dirty);
  const busy = useTab(id, (t) => t.busy);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);
  if (title === undefined) return null;
  return (
    <div className="doc-tab" data-active={active || undefined} data-drag={drag ?? undefined} ref={ref}>
      <button
        type="button"
        role="tab"
        id={`doc-tab-${id}`}
        className="tab-main"
        aria-selected={active}
        aria-controls="doc-panel"
        tabIndex={active ? 0 : -1}
        title={path ?? title}
        draggable
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
        onDragStart={(e) => {
          e.dataTransfer.setData(TAB_MIME, id);
          e.dataTransfer.effectAllowed = 'move';
          setDrag('src');
        }}
        onDragEnd={() => setDrag(null)}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(TAB_MIME)) return;
          e.preventDefault();
          setDrag((d) => d ?? 'over');
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag((d) => (d === 'over' ? null : d));
        }}
        onDrop={(e) => {
          setDrag(null);
          const from = e.dataTransfer.getData(TAB_MIME);
          if (!from) return;
          e.preventDefault();
          moveTab(
            from,
            useTabs.getState().tabs.findIndex((t) => t.id === id),
          );
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
      {/* Mouse affordance only; keyboard users close with ⌘W, or Delete on the focused tab. */}
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
