import { useTabs } from '../doc/store';
import { CodePane } from './CodePane';
import { IconPalette } from './IconPalette';
import { PaneToggle } from './PaneToggle';
import { useUi } from './uiStore';

export function LeftSidebar() {
  const open = useUi((s) => s.showCode);
  const mode = useUi((s) => s.leftMode);
  const tabId = useTabs((s) => s.activeId);
  return (
    <section className="pane left" aria-label="Editor">
      <div className="pane-head" hidden={!open}>
        <div
          className="seg editor-tabs"
          data-active={mode === 'code' ? 1 : 0}
          role="tablist"
          aria-label="Left editor"
          onKeyDown={(e) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
            e.preventDefault();
            e.stopPropagation();
            const next =
              e.key === 'Home' ? 'icons' : e.key === 'End' ? 'code' : mode === 'icons' ? 'code' : 'icons';
            useUi.getState().set({ leftMode: next });
            document.getElementById(`editor-tab-${next}`)?.focus();
          }}
        >
          {(['icons', 'code'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              id={`editor-tab-${tab}`}
              aria-selected={mode === tab}
              aria-controls={`editor-${tab}`}
              tabIndex={mode === tab ? 0 : -1}
              onClick={() => useUi.getState().set({ leftMode: tab })}
            >
              {tab === 'icons' ? 'Icons' : 'Code'}
            </button>
          ))}
        </div>
        <span className="spacer" />
        {open && <PaneToggle side="left" open />}
      </div>
      <div
        className="pane-body left-editor"
        id="editor-icons"
        role="tabpanel"
        aria-labelledby="editor-tab-icons"
        hidden={!open || mode !== 'icons'}
      >
        <IconPalette />
      </div>
      <div
        className="pane-body left-editor"
        id="editor-code"
        role="tabpanel"
        aria-labelledby="editor-tab-code"
        hidden={!open || mode !== 'code'}
      >
        {/* One editor per visible tab: CodeMirror's own undo history must never cross tabs. */}
        <CodePane key={tabId} active={open && mode === 'code'} />
      </div>
      {!open && <PaneToggle side="left" open={false} />}
    </section>
  );
}
