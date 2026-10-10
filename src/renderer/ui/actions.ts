import { buildHtmlDocument } from '@eraserlabs/render';
import type { OpenedFile } from '../../shared/ipc';
import { fitContainers } from '../ai/merge';
import { docFromJson, toSplit } from '../ai/parse';
import { deleteElements, duplicateEntities, insertIcon, moveEntities } from '../doc/ops';
import {
  activateTab,
  addTab,
  DEFAULT_VIEW,
  docApi,
  isPristine,
  patchTab,
  removeTab,
  tabState,
  tabTitle,
  useDoc,
  useTabs,
} from '../doc/store';
import { serialize, validate } from '../engine/engine';
import { toSvg } from '../engine/svg';
import { groundOf } from '../engine/theme';
import { type Doc, SHEET_PAD } from '../engine/types';
import { autoLayout } from '../layout/elk';
import { iconNames } from './iconCatalog';
import { isMac } from './platform';
import { requestFitAfterRender, setPane, toast, useUi } from './uiStore';

const availableIcons = new Set(iconNames);

export function insertIconAt(name: string, point: { x: number; y: number }): void {
  if (!availableIcons.has(name)) return;
  const store = useDoc.getState();
  const ui = useUi.getState();
  const inserted = insertIcon(store.doc, name, point, ui.render?.boxes ?? {});
  ui.set({ pan: { x: ui.pan.x - inserted.offset.x * ui.zoom, y: ui.pan.y - inserted.offset.y * ui.zoom } });
  store.commit(fitContainers(inserted.doc, inserted.boxes));
  store.select({ entities: [inserted.id], connections: [] });
}

export function insertIconAtCenter(name: string): void {
  const rect = document.querySelector('.canvas')?.getBoundingClientRect();
  if (!rect) return;
  const { pan, zoom } = useUi.getState();
  insertIconAt(name, { x: (rect.width / 2 - pan.x) / zoom, y: (rect.height / 2 - pan.y) / zoom });
}

const api = () => window.api;
/** ipcRenderer.invoke wraps main errors; show only the message. */
export const ipcMessage = (e: unknown) =>
  String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

/** Before another tab shows: commit a focused field to this tab, cancel a canvas drag, keep pan/zoom. */
function leaveActiveTab(): void {
  (document.activeElement as HTMLElement | null)?.blur?.();
  window.dispatchEvent(new Event('blur')); // Canvas cancels an in-flight drag on window blur.
  const { zoom, pan } = useUi.getState();
  patchTab(useTabs.getState().activeId, { view: { zoom, pan } });
}

/** Activate a tab and give the canvas its view; the render loop picks up its document. */
function showTab(id: string): void {
  activateTab(id);
  const view = tabState(id)?.view ?? null;
  const ui = useUi.getState();
  ui.set({
    ...(view ?? DEFAULT_VIEW),
    render: null,
    errors: [],
    warnings: [],
    fitPending: view === null,
    renderTick: ui.renderTick + 1,
  });
}

export function switchTab(id: string): void {
  if (id === useTabs.getState().activeId || !tabState(id)) return;
  leaveActiveTab();
  showTab(id);
}

export function newTab(): void {
  leaveActiveTab();
  showTab(addTab());
}

/** Close a tab (default: the active one). Closing the last tab leaves a fresh Untitled; the window stays. */
export function closeTab(id = useTabs.getState().activeId): void {
  const t = tabState(id);
  if (!t) return;
  const title = tabTitle(t);
  const ask = t.busy
    ? `An AI run is still going in “${title}”. Stop it and close the tab?${t.dirty ? ' Unsaved changes will be lost.' : ''}`
    : t.dirty
      ? `Discard unsaved changes to “${title}”?`
      : null;
  // Removing the tab unmounts its AI panel, which cancels the run.
  if (ask && !window.confirm(ask)) return;
  const wasActive = id === useTabs.getState().activeId;
  if (wasActive) leaveActiveTab();
  const next = removeTab(id);
  if (wasActive) showTab(next);
  // Interim until the recovery watcher (Task 5): nothing unsaved is left, so nothing to recover.
  if (!useTabs.getState().tabs.some((x) => x.dirty)) void api().invoke('recovery:clear');
}

export function cycleTab(delta: number): void {
  const { tabs, activeId } = useTabs.getState();
  const i = tabs.findIndex((t) => t.id === activeId);
  switchTab(tabs[(i + delta + tabs.length) % tabs.length]!.id);
}

/**
 * Ctrl+Tab / Ctrl+Shift+Tab, ⌘⇧] / ⌘⇧[ (macOS only: Ctrl+Shift+[ folds code in CodeMirror elsewhere),
 * mod+1–8 and mod+9 for the last tab. Returns the switch for a tab key, else null (so a modal can swallow it).
 */
export function tabKey(e: KeyboardEvent): (() => void) | null {
  const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (e.altKey) return null;
  if (e.ctrlKey && !e.metaKey && e.key === 'Tab') return () => cycleTab(e.shiftKey ? -1 : 1);
  if (isMac && e.metaKey && e.shiftKey && (e.code === 'BracketRight' || e.code === 'BracketLeft'))
    return () => cycleTab(e.code === 'BracketRight' ? 1 : -1);
  if (mod && !e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
    const { tabs } = useTabs.getState();
    const n = Number(e.code.slice(5));
    const target = n === 9 ? tabs.at(-1) : tabs[n - 1];
    return () => target && switchTab(target.id);
  }
  return null;
}

const baseName = () =>
  (useDoc.getState().filePath?.split(/[\\/]/).pop() ?? 'diagram').replace(/\.json$/i, '');

/**
 * Load text into the tab on screen (tests, recovery). A busy tab (AI run or scan) is never replaced:
 * the text opens in a new tab instead.
 */
export function loadText(text: string, path: string | null): void {
  let doc: Doc;
  try {
    doc = docFromJson(JSON.parse(text));
  } catch (e) {
    toast(`Could not open: ${(e as Error).message}`);
    return;
  }
  if (useDoc.getState().busy) newTab();
  useDoc.getState().load(doc, path);
  void api().invoke('recovery:clear');
  requestFitAfterRender();
}

/** Recovery is internal app state; public diagram files retain the plain document format. */
export function restoreRecovery(text: string): void {
  try {
    const value = JSON.parse(text);
    const snapshot = value.recoveryVersion === 1 ? value : { doc: value, codeDraft: null };
    loadText(JSON.stringify(snapshot.doc), null);
    if (typeof snapshot.codeDraft === 'string') {
      useDoc.getState().setCodeDraft(snapshot.codeDraft);
      useUi.getState().set({ leftMode: 'code' });
      setPane('left', true);
    }
    useDoc.setState({ dirty: true });
  } catch (e) {
    toast(`Could not restore: ${ipcMessage(e)}`);
  }
}

/** Show a file in a tab: focus the tab that has it already, reuse an untouched idle Untitled, else add one. */
export function openInTab(text: string, path: string, key: string | null = null): void {
  const same = useTabs
    .getState()
    .tabs.find((t) => (key !== null && t.fileKey === key) || t.filePath === path);
  if (same) {
    switchTab(same.id);
    return;
  }
  let doc: Doc;
  try {
    doc = docFromJson(JSON.parse(text));
  } catch (e) {
    toast(`Could not open: ${(e as Error).message}`);
    return;
  }
  if (!isPristine(useDoc.getState())) newTab();
  const id = useTabs.getState().activeId;
  docApi(id).load(doc, path);
  patchTab(id, { fileKey: key });
  requestFitAfterRender();
}

export async function openFile(): Promise<void> {
  try {
    const f: OpenedFile | null = await api().invoke('file:open');
    if (f) openInTab(f.content, f.path, f.key);
  } catch (e) {
    toast(`Could not open: ${ipcMessage(e)}`);
  }
}

let saving = false;
export async function save(as = false): Promise<void> {
  if (saving) return;
  saving = true;
  const id = useTabs.getState().activeId;
  const ops = docApi(id);
  try {
    const draftState = tabState(id)!;
    if (draftState.codeDraft !== null) {
      const text = draftState.codeDraft;
      const json = JSON.parse(text);
      const result = await validate(json);
      if (!result.ok) throw new Error('Fix the code errors before saving.');
      if (tabState(id)?.revision !== draftState.revision) return;
      const doc = toSplit(json);
      ops.acceptCodeDraft(typeof json.title === 'string' ? { title: json.title, ...doc } : doc, text);
    }
    const tab = tabState(id);
    if (!tab) return;
    const { doc, filePath, revision, session } = tab;
    const path = await api().invoke('file:save', {
      path: as ? null : filePath,
      content: `${JSON.stringify(doc, null, 2)}\n`,
    });
    if (path) {
      ops.markSaved(path, revision, session);
      const now = tabState(id);
      if (now && !now.dirty && now.session === session) await api().invoke('recovery:clear');
      toast(`Saved ${path.split(/[\\/]/).pop()}`);
    }
  } catch (e) {
    toast(
      tabState(id)?.codeDraft != null
        ? 'Fix the code errors before saving.'
        : `Save failed: ${ipcMessage(e)}`,
    );
  } finally {
    saving = false;
  }
}

async function guard(label: string, run: () => Promise<string | null>): Promise<void> {
  if (!useUi.getState().render) return toast('Nothing to export yet.');
  try {
    const where = await run();
    if (where) toast(where === 'clipboard' ? 'PNG copied to the clipboard' : `${label} saved to ${where}`);
  } catch (e) {
    toast(`Export failed: ${ipcMessage(e)}`);
  }
}

export const exportPng = (scale: 1 | 2, transparent: boolean, clipboard = false) =>
  guard('PNG', () =>
    api().invoke('export:png', {
      doc: useDoc.getState().doc,
      scale,
      transparent,
      clipboard,
      theme: useUi.getState().theme,
    }),
  );

export const exportSvg = (background = true) =>
  guard('SVG', () =>
    api().invoke('export:save', {
      kind: 'svg',
      name: baseName(),
      content: toSvg(
        serialize(),
        useUi.getState().render!.bounds,
        background ? groundOf(useUi.getState().theme) : undefined,
      ),
    }),
  );

export const exportHtml = () =>
  guard('HTML', () => {
    const s = serialize();
    const content = buildHtmlDocument({
      title: baseName(),
      styles: [s.css, `body{margin:${SHEET_PAD}px;background:${groundOf(useUi.getState().theme)}}`],
      body: s.scene,
    });
    return api().invoke('export:save', { kind: 'html', name: baseName(), content });
  });

export const exportJson = () =>
  guard('Measured JSON', () =>
    api().invoke('export:save', {
      kind: 'json',
      name: `${baseName()}.measured`,
      content: JSON.stringify(useUi.getState().render!.measured, null, 2),
    }),
  );

export async function autoLayoutAll(): Promise<void> {
  const r = useUi.getState().render;
  const store = useDoc.getState();
  if (!r || !store.doc.entities.length) return;
  try {
    const next = await autoLayout(store.doc, r.painted);
    if (tabState(store.id)?.revision !== store.revision)
      return toast('Layout not applied: the diagram changed.');
    store.commit(next); // bound to the tab that was laid out
  } catch (e) {
    return toast(`Layout failed: ${ipcMessage(e)}`);
  }
  if (useTabs.getState().activeId === store.id) requestFitAfterRender();
  else patchTab(store.id, { view: null });
}

/** Synchronous, so the keyboard default (the tab on screen) is safe; the Inspector passes its own tab. */
export function deleteSelection(id = useTabs.getState().activeId): void {
  const t = tabState(id);
  if (!t || (!t.selection.entities.length && !t.selection.connections.length)) return;
  const ops = docApi(id);
  ops.commit(deleteElements(t.doc, t.selection.entities, t.selection.connections));
  ops.select({ entities: [], connections: [] });
}

export function duplicateSelection(): void {
  const { doc, selection, commit, select } = useDoc.getState();
  if (!selection.entities.length) return;
  const r = duplicateEntities(doc, selection.entities);
  commit(r.doc);
  select({ entities: r.newIds, connections: [] });
}

export function nudge(dx: number, dy: number): void {
  const { doc, selection, commit } = useDoc.getState();
  if (selection.entities.length) commit(moveEntities(doc, selection.entities, dx, dy));
}
