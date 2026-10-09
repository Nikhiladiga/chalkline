import { useEffect } from 'react';
import { useDoc } from './doc/store';
import * as engine from './engine/engine';
import { render } from './engine/engine';
import { applyTheme } from './engine/theme';
import { checkLayout } from './layout/quality';
import { AiPanel } from './ui/AiPanel';
import * as actions from './ui/actions';
import {
  deleteSelection,
  duplicateSelection,
  exportPng,
  exportSvg,
  newDoc,
  nudge,
  openFile,
  restoreRecovery,
  save,
} from './ui/actions';
import { Canvas } from './ui/Canvas';
import { IconPicker } from './ui/IconPicker';
import { Inspector } from './ui/Inspector';
import { LeftSidebar } from './ui/LeftSidebar';
import { PaneToggle } from './ui/PaneToggle';
import { Settings } from './ui/Settings';
import { Toolbar } from './ui/Toolbar';
import { requestFit, useUi } from './ui/uiStore';

const testMode = new URLSearchParams(location.search).has('test');
if (import.meta.env.DEV || testMode) {
  (window as any).__dg = { ...engine, actions, checkLayout, doc: useDoc, ui: useUi };
}

/** Re-render on every document change; keep the last good render when the document has errors. */
function useRenderLoop(): void {
  const doc = useDoc((s) => s.doc);
  const tick = useUi((s) => s.renderTick);
  const theme = useUi((s) => s.theme);
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick forces a re-render of the same doc.
  useEffect(() => {
    void render(applyTheme(doc, theme)).then((r) => {
      if (!r.ok && r.stale) return;
      const ui = useUi.getState();
      if (r.ok) ui.set({ render: { ...r }, errors: [], warnings: r.warnings });
      else ui.set({ errors: r.errors, warnings: r.warnings });
    });
  }, [doc, tick, theme]);
}

function useShortcuts(): void {
  useEffect(() => {
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName) || !!t.closest('.cm-editor'));
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || useUi.getState().settingsOpen || useUi.getState().iconPick) return;
      const mod = e.metaKey || e.ctrlKey;
      const store = useDoc.getState();
      const step = e.shiftKey ? 10 : 1;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') store[e.shiftKey ? 'redo' : 'undo']();
      else if (mod && k === 'y') store.redo();
      else if (mod && k === 'd') duplicateSelection();
      else if (mod && k === 'a')
        store.select({ entities: store.doc.entities.map((x) => x.id), connections: [] });
      else if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) deleteSelection();
      else if (e.key === 'Escape') store.select({ entities: [], connections: [] });
      else if (e.key === 'ArrowLeft') nudge(-step, 0);
      else if (e.key === 'ArrowRight') nudge(step, 0);
      else if (e.key === 'ArrowUp') nudge(0, -step);
      else if (e.key === 'ArrowDown') nudge(0, step);
      else if (e.shiftKey && e.code === 'Digit1') requestFit();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function useMenuAndFiles(): void {
  useEffect(() => {
    const off = window.api.on('menu', (action: string) => {
      if (action === 'new') newDoc();
      else if (action === 'open') void openFile();
      else if (action === 'save') void save();
      else if (action === 'saveAs') void save(true);
      else if (action === 'exportPng') void exportPng(2, false);
      else if (action === 'exportSvg') void exportSvg();
    });
    void window.api
      .invoke('settings:get')
      .then((s: { theme: 'dark' | 'light' }) => useUi.getState().set({ theme: s.theme }));
    // Offer recovery of an unsaved diagram from the last session.
    if (!testMode) {
      void window.api.invoke('recovery:read').then((text: string | null) => {
        if (!text || useDoc.getState().dirty || useDoc.getState().session !== 0) return;
        if (window.confirm('Restore the unsaved diagram from your last session?')) restoreRecovery(text);
        else void window.api.invoke('recovery:clear');
      });
    }
    return off;
  }, []);

  // Autosave to the recovery file after 2 s idle; report dirty state to main for the close prompt.
  const doc = useDoc((s) => s.doc);
  const dirty = useDoc((s) => s.dirty);
  const filePath = useDoc((s) => s.filePath);
  const codeDraft = useDoc((s) => s.codeDraft);
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(
      () =>
        void window.api
          .invoke(
            'recovery:write',
            JSON.stringify({
              recoveryVersion: 1,
              doc,
              codeDraft,
            }),
          )
          .catch((e: unknown) =>
            useUi.getState().set({ toast: `Recovery failed: ${actions.ipcMessage(e)}` }),
          ),
      2000,
    );
    return () => clearTimeout(t);
  }, [doc, dirty, codeDraft]);
  useEffect(() => {
    void window.api.invoke('app:dirty', dirty);
    document.title = `${filePath?.split(/[\\/]/).pop() ?? 'Untitled'}${dirty ? ' (edited)' : ''} — Chalkline`;
  }, [dirty, filePath]);
}

export function App() {
  useRenderLoop();
  useShortcuts();
  useMenuAndFiles();
  const showCode = useUi((s) => s.showCode);
  const showAi = useUi((s) => s.showAi);
  const r = useUi((s) => s.render);
  const errors = useUi((s) => s.errors);
  const warnings = useUi((s) => s.warnings);
  const toastMsg = useUi((s) => s.toast);
  const count = useDoc((s) => s.doc.entities.length);
  const theme = useUi((s) => s.theme);

  return (
    <div className={`app${testMode ? ' test-mode' : ''}`} data-theme={theme}>
      <Toolbar />
      <main className={`workspace${showCode ? '' : ' no-code'}${showAi ? '' : ' no-ai'}`}>
        <LeftSidebar />
        <Canvas />
        <aside className="pane right" aria-label="Inspector and AI">
          {showAi ? (
            <>
              <div className="pane-head">
                Details
                <span className="spacer" />
                <PaneToggle side="right" open />
              </div>
              <div className="pane-body">
                <Inspector />
                <AiPanel />
              </div>
            </>
          ) : (
            <PaneToggle side="right" open={false} />
          )}
        </aside>
      </main>
      <footer className="status">
        <span className={errors.length ? 'bad' : 'ok'}>
          {errors.length ? `${errors.length} error${errors.length > 1 ? 's' : ''}` : 'Valid'}
          {warnings.length ? `, ${warnings.length} warning${warnings.length > 1 ? 's' : ''}` : ''}
        </span>
        <span>
          {count} element{count === 1 ? '' : 's'}
        </span>
        {r && <span>Rendered in {r.ms} ms</span>}
        <span style={{ flex: 1 }} />
        <span>Drag to move · Space-drag to pan · ⌘-scroll to zoom · double-click to edit text</span>
      </footer>
      <Settings />
      <IconPicker />
      {toastMsg && (
        <div className="toast" role="status">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
