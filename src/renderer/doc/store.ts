import { create } from 'zustand';
import { type Doc, emptyDoc } from '../engine/types';

export interface Selection {
  entities: string[];
  connections: number[];
}

interface DocState {
  doc: Doc;
  past: Doc[];
  future: Doc[];
  selection: Selection;
  filePath: string | null;
  dirty: boolean;
  codeDraft: string | null;
  revision: number;
  session: number;
  gestureStart: Doc | null;
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
  markSaved(path: string, revision?: number, session?: number): void;
  setCodeDraft(text: string): void;
  acceptCodeDraft(doc: Doc, text: string, revision?: number): void;
  discardCodeDraft(): void;
}

const LIMIT = 200;
const none: Selection = { entities: [], connections: [] };

/** Keep only selected things that still exist in `doc`. */
const prune = (sel: Selection, doc: Doc): Selection => ({
  entities: sel.entities.filter((id) => doc.entities.some((e) => e.id === id)),
  connections: sel.connections.filter((i) => i < doc.connections.length),
});

export const useDoc = create<DocState>((set, get) => ({
  doc: emptyDoc(),
  past: [],
  future: [],
  selection: none,
  filePath: null,
  dirty: false,
  codeDraft: null,
  revision: 0,
  session: 0,
  gestureStart: null,

  commit: (next) =>
    set((s) => ({
      doc: next,
      past: [...s.past, s.doc].slice(-LIMIT),
      future: [],
      dirty: true,
      revision: s.revision + 1,
      selection: prune(s.selection, next),
    })),

  replace: (next) =>
    set((s) => ({ doc: next, revision: s.revision + 1, selection: prune(s.selection, next) })),

  beginGesture: () => set((s) => ({ gestureStart: s.doc })),

  endGesture: () => {
    const { gestureStart, doc } = get();
    if (!gestureStart) return;
    if (gestureStart === doc) return set({ gestureStart: null });
    set((s) => ({
      gestureStart: null,
      past: [...s.past, gestureStart].slice(-LIMIT),
      future: [],
      dirty: true,
    }));
  },

  undo: () =>
    set((s) => {
      const prev = s.past.at(-1);
      if (!prev) return s;
      return {
        doc: prev,
        past: s.past.slice(0, -1),
        future: [s.doc, ...s.future],
        dirty: true,
        revision: s.revision + 1,
        selection: prune(s.selection, prev),
      };
    }),

  redo: () =>
    set((s) => {
      const next = s.future[0];
      if (!next) return s;
      return {
        doc: next,
        past: [...s.past, s.doc],
        future: s.future.slice(1),
        dirty: true,
        revision: s.revision + 1,
        selection: prune(s.selection, next),
      };
    }),

  select: (selection) => set({ selection }),

  load: (doc, filePath) =>
    set((s) => ({
      doc,
      filePath,
      past: [],
      future: [],
      dirty: false,
      codeDraft: null,
      revision: s.revision + 1,
      session: s.session + 1,
      selection: none,
      gestureStart: null,
    })),

  markSaved: (filePath, revision = get().revision, session = get().session) =>
    set((s) =>
      session !== s.session ? s : { filePath, dirty: revision !== s.revision || s.codeDraft !== null },
    ),

  setCodeDraft: (codeDraft) =>
    set((s) => (codeDraft === s.codeDraft ? s : { codeDraft, dirty: true, revision: s.revision + 1 })),

  acceptCodeDraft: (doc, text, revision = get().revision) => {
    if (get().codeDraft !== text || get().revision !== revision) return;
    if (JSON.stringify(doc) !== JSON.stringify(get().doc)) get().commit(doc);
    set({ codeDraft: null });
  },

  discardCodeDraft: () => set((s) => ({ codeDraft: null, revision: s.revision + 1 })),
}));
