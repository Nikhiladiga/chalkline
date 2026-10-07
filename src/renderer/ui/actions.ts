import { buildHtmlDocument } from '@eraserlabs/render';
import { fitContainers } from '../ai/merge';
import { toSplit } from '../ai/parse';
import { deleteElements, duplicateEntities, insertIcon, moveEntities } from '../doc/ops';
import { useDoc } from '../doc/store';
import { serialize, validate } from '../engine/engine';
import { toSvg } from '../engine/svg';
import { groundOf } from '../engine/theme';
import { emptyDoc, SHEET_PAD } from '../engine/types';
import { autoLayout } from '../layout/elk';
import { iconNames } from './iconCatalog';
import { requestFit, toast, useUi } from './uiStore';

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

const baseName = () =>
  (useDoc.getState().filePath?.split(/[\\/]/).pop() ?? 'diagram').replace(/\.json$/i, '');

export function confirmDiscard(): boolean {
  return !useDoc.getState().dirty || window.confirm('Discard unsaved changes?');
}

export function newDoc(): void {
  if (!confirmDiscard()) return;
  useUi.getState().set({ draft: null });
  useDoc.getState().load(emptyDoc(), null);
  void api().invoke('recovery:clear');
}

export function loadText(text: string, path: string | null): void {
  try {
    const json = JSON.parse(text);
    const doc = toSplit(json);
    useDoc.getState().load(typeof json.title === 'string' ? { title: json.title, ...doc } : doc, path);
    useUi.getState().set({ draft: null });
    void api().invoke('recovery:clear');
    requestFit();
  } catch (e) {
    toast(`Could not open: ${(e as Error).message}`);
  }
}

/** Recovery is internal app state; public diagram files retain the plain document format. */
export function restoreRecovery(text: string): void {
  try {
    const value = JSON.parse(text);
    const snapshot = value.recoveryVersion === 1 ? value : { doc: value, codeDraft: null };
    loadText(JSON.stringify(snapshot.doc), null);
    if (typeof snapshot.codeDraft === 'string') {
      useDoc.getState().setCodeDraft(snapshot.codeDraft);
      useUi.getState().set({ showCode: true, leftMode: 'code' });
    }
    useDoc.setState({ dirty: true });
  } catch (e) {
    toast(`Could not restore: ${ipcMessage(e)}`);
  }
}

export async function openFile(): Promise<void> {
  try {
    const session = useDoc.getState().session;
    const f = await api().invoke('file:open');
    if (f && useDoc.getState().session === session && confirmDiscard()) loadText(f.content, f.path);
  } catch (e) {
    toast(`Could not open: ${ipcMessage(e)}`);
  }
}

let saving = false;
export async function save(as = false): Promise<void> {
  if (saving) return;
  saving = true;
  try {
    const draftState = useDoc.getState();
    if (draftState.codeDraft !== null) {
      const text = draftState.codeDraft;
      const json = JSON.parse(text);
      const result = await validate(json);
      if (!result.ok) throw new Error('Fix the code errors before saving.');
      if (useDoc.getState().revision !== draftState.revision) return;
      const doc = toSplit(json);
      draftState.acceptCodeDraft(typeof json.title === 'string' ? { title: json.title, ...doc } : doc, text);
      useUi.getState().set({ draft: null });
    }
    const { doc, filePath, revision, session, markSaved } = useDoc.getState();
    const path = await api().invoke('file:save', {
      path: as ? null : filePath,
      content: `${JSON.stringify(doc, null, 2)}\n`,
    });
    if (path) {
      markSaved(path, revision, session);
      if (!useDoc.getState().dirty && useDoc.getState().session === session)
        await api().invoke('recovery:clear');
      toast(`Saved ${path.split(/[\\/]/).pop()}`);
    }
  } catch (e) {
    toast(
      useDoc.getState().codeDraft !== null
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
    if (useDoc.getState().revision !== store.revision)
      return toast('Layout not applied: the diagram changed.');
    store.commit(next);
  } catch (e) {
    return toast(`Layout failed: ${ipcMessage(e)}`);
  }
  requestFit();
}

export function deleteSelection(): void {
  const { doc, selection, commit, select } = useDoc.getState();
  if (!selection.entities.length && !selection.connections.length) return;
  commit(deleteElements(doc, selection.entities, selection.connections));
  select({ entities: [], connections: [] });
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
