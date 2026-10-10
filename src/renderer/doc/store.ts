import { create } from 'zustand';
import { type Doc, emptyDoc } from '../engine/types';

export interface Selection {
  entities: string[];
  connections: number[];
}

export interface View {
  zoom: number;
  pan: { x: number; y: number };
}

/** One open document: everything the single-document store held, plus tab metadata. */
export interface Tab {
  id: string;
  doc: Doc;
  past: Doc[];
  future: Doc[];
  selection: Selection;
  filePath: string | null;
  /** Main's identity for the opened file (realpath, case-folded on macOS/Windows); null if unknown. */
  fileKey: string | null;
  dirty: boolean;
  codeDraft: string | null;
  /** From one global counter: a revision or session captured in one tab never matches another tab. */
  revision: number;
  session: number;
  gestureStart: Doc | null;
  /** "Untitled N" number, fixed when the tab opens. */
  untitled: number;
  /** Canvas pan/zoom when the tab was last shown; null = fit once its next render lands. */
  view: View | null;
  /** An AI run or code-folder scan started in this tab is in progress. */
  busy: boolean;
}

export interface DocActions {
  /** New document version, one undo step. */
  commit(next: Doc): void;
  /** Live preview (drag frames) — no undo step of its own. */
  replace(next: Doc): void;
  beginGesture(): void;
  endGesture(): void;
  undo(): void;
  redo(): void;
  select(sel: Selection): void;
  load(doc: Doc, path: string | null): void;
  markSaved(path: string, revision?: number, session?: number, key?: string): void;
  setCodeDraft(text: string): void;
  acceptCodeDraft(doc: Doc, text: string, revision?: number): void;
  discardCodeDraft(): void;
}

export type DocState = Tab & DocActions;
export type TabInit = Partial<Pick<Tab, 'doc' | 'filePath' | 'fileKey' | 'codeDraft' | 'dirty' | 'view'>>;
export type TabPatch = Partial<Omit<Tab, 'id'>>;

interface TabsState {
  /** Display order; never empty. */
  tabs: Tab[];
  /** Always the id of a tab in `tabs`. */
  activeId: string;
}

const LIMIT = 200;
const none: Selection = { entities: [], connections: [] };
export const DEFAULT_VIEW: View = { zoom: 1, pan: { x: 40, y: 40 } };

let clock = 0;
const tick = () => ++clock;
let lastId = 0;

/** Keep only selected things that still exist in `doc`. */
const prune = (sel: Selection, doc: Doc): Selection => ({
  entities: sel.entities.filter((id) => doc.entities.some((e) => e.id === id)),
  connections: sel.connections.filter((i) => i < doc.connections.length),
});

function freshTab(untitled: number, init: TabInit = {}): Tab {
  return {
    id: `tab-${++lastId}`,
    doc: emptyDoc(),
    past: [],
    future: [],
    selection: none,
    filePath: null,
    fileKey: null,
    dirty: false,
    codeDraft: null,
    revision: tick(),
    session: tick(),
    gestureStart: null,
    untitled,
    view: DEFAULT_VIEW,
    busy: false,
    ...init,
  };
}

/** The smallest "Untitled N" number no open untitled tab uses. */
export function nextUntitled(tabs: Tab[]): number {
  const used = new Set(tabs.filter((t) => t.filePath === null).map((t) => t.untitled));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

const first = freshTab(1);
export const useTabs = create<TabsState>(() => ({ tabs: [first], activeId: first.id }));

const find = (s: TabsState, id: string) => s.tabs.find((t) => t.id === id);
const activeOf = (s: TabsState) => find(s, s.activeId)!;

/**
 * Change one tab. A null patch, a patch that changes no value, or a tab that is gone (closed
 * mid-request) changes nothing, so idle bookkeeping (e.g. `busy: false`) never wakes subscribers.
 */
function update(id: string, fn: (t: Tab) => TabPatch | null): void {
  useTabs.setState((s) => {
    const i = s.tabs.findIndex((t) => t.id === id);
    const tab = s.tabs[i];
    const patch = tab ? fn(tab) : null;
    if (!tab || !patch) return s;
    if ((Object.keys(patch) as (keyof Tab)[]).every((k) => Object.is((patch as Partial<Tab>)[k], tab[k])))
      return s;
    const tabs = s.tabs.slice();
    tabs[i] = { ...tab, ...patch };
    return { tabs };
  });
}

export const patchTab = (id: string, patch: TabPatch): void => update(id, () => patch);

const bound = new Map<string, DocActions>();

/** One tab's document actions, bound by id: safe to keep across awaits and tab switches. */
export function docApi(id: string): DocActions {
  const known = bound.get(id);
  if (known) return known;
  const up = (fn: (t: Tab) => TabPatch | null) => update(id, fn);
  const a: DocActions = {
    commit: (next) =>
      up((s) => ({
        doc: next,
        past: [...s.past, s.doc].slice(-LIMIT),
        future: [],
        dirty: true,
        revision: tick(),
        selection: prune(s.selection, next),
      })),
    replace: (next) => up((s) => ({ doc: next, revision: tick(), selection: prune(s.selection, next) })),
    beginGesture: () => up((s) => ({ gestureStart: s.doc })),
    endGesture: () =>
      up((s) => {
        if (!s.gestureStart) return null;
        if (s.gestureStart === s.doc) return { gestureStart: null };
        return {
          gestureStart: null,
          past: [...s.past, s.gestureStart].slice(-LIMIT),
          future: [],
          dirty: true,
        };
      }),
    undo: () =>
      up((s) => {
        const prev = s.past.at(-1);
        if (!prev) return null;
        return {
          doc: prev,
          past: s.past.slice(0, -1),
          future: [s.doc, ...s.future],
          dirty: true,
          revision: tick(),
          selection: prune(s.selection, prev),
        };
      }),
    redo: () =>
      up((s) => {
        const next = s.future[0];
        if (!next) return null;
        return {
          doc: next,
          past: [...s.past, s.doc],
          future: s.future.slice(1),
          dirty: true,
          revision: tick(),
          selection: prune(s.selection, next),
        };
      }),
    select: (selection) => up(() => ({ selection })),
    load: (doc, filePath) =>
      up(() => ({
        doc,
        filePath,
        fileKey: null,
        past: [],
        future: [],
        dirty: false,
        codeDraft: null,
        revision: tick(),
        session: tick(),
        selection: none,
        gestureStart: null,
      })),
    markSaved: (filePath, revision, session, key) =>
      up((s) =>
        (session ?? s.session) !== s.session
          ? null
          : {
              filePath,
              fileKey: key ?? (filePath === s.filePath ? s.fileKey : null),
              dirty: (revision ?? s.revision) !== s.revision || s.codeDraft !== null,
            },
      ),
    setCodeDraft: (codeDraft) =>
      up((s) => (codeDraft === s.codeDraft ? null : { codeDraft, dirty: true, revision: tick() })),
    acceptCodeDraft: (doc, text, revision) => {
      const s = tabState(id);
      if (!s || s.codeDraft !== text || (revision ?? s.revision) !== s.revision) return;
      if (JSON.stringify(doc) !== JSON.stringify(s.doc)) a.commit(doc);
      up(() => ({ codeDraft: null }));
    },
    discardCodeDraft: () => up(() => ({ codeDraft: null, revision: tick() })),
  };
  bound.set(id, a);
  return a;
}

// One state object per tab version, so selectors and subscribers see stable identities.
const views = new WeakMap<Tab, DocState>();
function viewOf(t: Tab): DocState {
  let v = views.get(t);
  if (!v) {
    v = { ...t, ...docApi(t.id) };
    views.set(t, v);
  }
  return v;
}

/** A tab's current state with its bound actions, or undefined once it is closed. */
export function tabState(id: string): DocState | undefined {
  const t = find(useTabs.getState(), id);
  return t && viewOf(t);
}

/** Select from one tab (undefined once it is closed). */
export function useTab<T>(id: string, selector: (t: Tab) => T): T | undefined {
  return useTabs((s) => {
    const t = find(s, id);
    return t ? selector(t) : undefined;
  });
}

export interface UseDoc {
  <T>(selector: (s: DocState) => T): T;
  getState(): DocState;
  setState(patch: TabPatch): void;
  subscribe(listener: (state: DocState, prev: DocState) => void): () => void;
}

/** The document on screen: the active tab. Actions from getState() stay bound to that tab. */
export const useDoc: UseDoc = Object.assign(
  <T>(selector: (s: DocState) => T): T => useTabs((s) => selector(viewOf(activeOf(s)))),
  {
    getState: () => viewOf(activeOf(useTabs.getState())),
    setState: (patch: TabPatch) => patchTab(useTabs.getState().activeId, patch),
    subscribe: (listener: (state: DocState, prev: DocState) => void) =>
      useTabs.subscribe((s, p) => {
        const now = viewOf(activeOf(s));
        const before = viewOf(activeOf(p));
        if (now !== before) listener(now, before);
      }),
  },
);

/** Append a tab (not activated) and return its id. */
export function addTab(init: TabInit = {}): string {
  const t = freshTab(nextUntitled(useTabs.getState().tabs), init);
  useTabs.setState((s) => ({ tabs: [...s.tabs, t] }));
  return t.id;
}

export function activateTab(id: string): void {
  if (find(useTabs.getState(), id)) useTabs.setState({ activeId: id });
}

/**
 * Remove a tab and return the active id afterwards: the right neighbour (else the left) replaces a
 * closed active tab, and closing the last tab leaves one fresh Untitled tab.
 */
export function removeTab(id: string): string {
  const s = useTabs.getState();
  const i = s.tabs.findIndex((t) => t.id === id);
  if (i < 0) return s.activeId;
  bound.delete(id);
  const rest = s.tabs.filter((t) => t.id !== id);
  const tabs = rest.length ? rest : [freshTab(1)];
  const activeId = s.activeId !== id ? s.activeId : tabs[Math.min(i, tabs.length - 1)]!.id;
  useTabs.setState({ tabs, activeId });
  return activeId;
}

export function moveTab(id: string, to: number): void {
  useTabs.setState((s) => {
    const tab = find(s, id);
    if (!tab) return s;
    const rest = s.tabs.filter((t) => t !== tab);
    rest.splice(Math.max(0, Math.min(to, rest.length)), 0, tab);
    return { tabs: rest };
  });
}

/** File base name without `.json`, or "Untitled" / "Untitled N". */
export function tabTitle(t: Pick<Tab, 'filePath' | 'untitled'>): string {
  if (t.filePath) return (t.filePath.split(/[\\/]/).pop() ?? t.filePath).replace(/\.json$/i, '');
  return t.untitled > 1 ? `Untitled ${t.untitled}` : 'Untitled';
}

/** Untitled, unedited, empty and idle: Open may reuse it, and startup may restore into it. */
export const isPristine = (t: Tab): boolean =>
  t.filePath === null &&
  !t.dirty &&
  !t.busy &&
  t.codeDraft === null &&
  t.past.length === 0 &&
  t.future.length === 0 &&
  t.doc.entities.length === 0 &&
  t.doc.connections.length === 0;
