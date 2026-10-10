import { useEffect } from 'react';
import { watchRecovery } from './doc/recovery';
import { tabTitle, useDoc, useTabs } from './doc/store';
import * as engine from './engine/engine';
import { render } from './engine/engine';
import { applyTheme } from './engine/theme';
import { checkLayout } from './layout/quality';
import * as actions from './ui/actions';
import {
  closeTab,
  copySelection,
  cycleTab,
  deleteSelection,
  duplicateSelection,
  exportPng,
  exportSvg,
  newTab,
  nudge,
  offerRecovery,
  openFile,
  pasteClipboard,
  save,
  tabKey,
} from './ui/actions';
import { Canvas } from './ui/Canvas';
import { DetailsPane } from './ui/DetailsPane';
import { IconPicker } from './ui/IconPicker';
import { LeftSidebar } from './ui/LeftSidebar';
import { togglePane } from './ui/PaneToggle';
import { Settings } from './ui/Settings';
import { StatusBar } from './ui/StatusBar';
import { Toolbar } from './ui/Toolbar';
import { requestFit, useUi } from './ui/uiStore';

const testMode = new URLSearchParams(location.search).has('test');
if (import.meta.env.DEV || testMode) {
  (window as any).__dg = { ...engine, actions, checkLayout, doc: useDoc, tabs: useTabs, ui: useUi };
}

/** Re-render on every document change; keep the last good render when the document has errors. */
function useRenderLoop(): void {
  const doc = useDoc((s) => s.doc);
  const tick = useUi((s) => s.renderTick);
  const theme = useUi((s) => s.theme);
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick forces a re-render of the same doc.
  useEffect(() => {
    void render(applyTheme(doc, theme)).then((r) => {
      if ((!r.ok && r.stale) || useDoc.getState().doc !== doc) return; // switched tabs mid-render
      const ui = useUi.getState();
      if (r.ok) ui.set({ render: { ...r }, errors: [], warnings: r.warnings });
      else ui.set({ errors: r.errors, warnings: r.warnings, fitPending: false });
    });
  }, [doc, tick, theme]);
}

const modalOpen = () => useUi.getState().settingsOpen || !!useUi.getState().iconPick;

function useShortcuts(): void {
  useEffect(() => {
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName) || !!t.closest('.cm-editor'));
    const onKey = (e: KeyboardEvent) => {
      // Tab switching works from text fields too, like a browser: none of these keys types anything.
      // While a modal is open they do nothing, and are swallowed so they do not fall through.
      const tab = tabKey(e);
      if (tab) {
        e.preventDefault();
        if (!modalOpen()) tab();
        return;
      }
      if (modalOpen()) return;
      if (typing(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const store = useDoc.getState();
      const step = e.shiftKey ? 10 : 1;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') store[e.shiftKey ? 'redo' : 'undo']();
      else if (mod && k === 'y') store.redo();
      else if (mod && (k === 'c' || k === 'x') && store.selection.entities.length)
        void copySelection(k === 'x');
      else if (mod && k === 'v') void pasteClipboard();
      else if (mod && k === 'd') duplicateSelection();
      else if (mod && k === 'a')
        store.select({ entities: store.doc.entities.map((x) => x.id), connections: [] });
      else if (mod && e.key === ',') useUi.getState().set({ settingsOpen: true });
      else if (!mod && e.key === '[') togglePane('left');
      else if (!mod && e.key === ']') togglePane('right');
      else if (!mod && e.key === '?')
        document.querySelector<HTMLButtonElement>('[data-testid="shortcuts-menu"]')?.click();
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
      // Tab-changing actions wait for the modal: the icon picker writes into the tab on screen.
      if (modalOpen() && /^(new|newTab|closeTab|nextTab|prevTab|open)$/.test(action)) return;
      if (action === 'new' || action === 'newTab') newTab();
      else if (action === 'closeTab') closeTab();
      else if (action === 'nextTab') cycleTab(1);
      else if (action === 'prevTab') cycleTab(-1);
      else if (action === 'open') void openFile();
      else if (action === 'save') void save();
      else if (action === 'saveAs') void save(true);
      else if (action === 'exportPng') void exportPng(2, false);
      else if (action === 'exportSvg') void exportSvg();
    });
    void window.api
      .invoke('settings:get')
      .then((s: { theme: 'dark' | 'light' }) => useUi.getState().set({ theme: s.theme }));
    // Offer recovery of unsaved tabs from the last session.
    if (!testMode) void offerRecovery();
    return off;
  }, []);

  // Keep the recovery file in step with every tab (2 s after the last change).
  useEffect(
    () =>
      watchRecovery(
        {
          write: (text) => window.api.invoke('recovery:write', text),
          clear: () => window.api.invoke('recovery:clear'),
        },
        (e) => useUi.getState().set({ toast: `Recovery failed: ${actions.ipcMessage(e)}` }),
      ),
    [],
  );
  // Main's close prompt must know about unsaved work in background tabs, and about running AI
  // work (closing the window would abort it), so busy counts as "needs confirm" too.
  const needsConfirm = useTabs((s) => s.tabs.some((t) => t.dirty || t.busy));
  useEffect(() => {
    void window.api.invoke('app:dirty', needsConfirm);
  }, [needsConfirm]);
  const title = useDoc(tabTitle);
  const dirty = useDoc((s) => s.dirty);
  useEffect(() => {
    document.title = `${title}${dirty ? ' (edited)' : ''} — Chalkline`;
  }, [title, dirty]);
}

export function App() {
  useRenderLoop();
  useShortcuts();
  useMenuAndFiles();
  const showCode = useUi((s) => s.showCode);
  const showAi = useUi((s) => s.showAi);
  const toastMsg = useUi((s) => s.toast);
  const theme = useUi((s) => s.theme);
  const activeId = useTabs((s) => s.activeId);

  return (
    <div className={`app${testMode ? ' test-mode' : ''}`} data-theme={theme}>
      <Toolbar />
      <main className={`workspace${showCode ? '' : ' no-code'}${showAi ? '' : ' no-ai'}`}>
        <div id="doc-panel" role="tabpanel" aria-labelledby={`doc-tab-${activeId}`} className="tabpanel">
          <LeftSidebar />
          <Canvas />
          <DetailsPane />
        </div>
        {toastMsg && (
          <div className="toast" role="status">
            {toastMsg}
          </div>
        )}
      </main>
      <StatusBar />
      <Settings />
      <IconPicker />
    </div>
  );
}
