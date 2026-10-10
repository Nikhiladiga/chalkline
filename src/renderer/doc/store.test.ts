import { beforeEach, describe, expect, it } from 'vitest';
import type { Doc } from '../engine/types';
import {
  activateTab,
  addTab,
  docApi,
  isPristine,
  moveTab,
  patchTab,
  removeTab,
  tabState,
  tabTitle,
  useDoc,
  useTabs,
} from './store';

const d = (n: number): Doc => ({ entities: [{ tag: 'Shape', id: `s${n}`, x: n, y: 0 }], connections: [] });
const s = () => useDoc.getState();

beforeEach(() => s().load(d(0), null));

describe('document store', () => {
  it('undoes and redoes commits', () => {
    s().commit(d(1));
    s().commit(d(2));
    s().undo();
    expect(s().doc).toEqual(d(1));
    s().redo();
    expect(s().doc).toEqual(d(2));
  });

  it('a new commit clears the redo stack', () => {
    s().commit(d(1));
    s().undo();
    s().commit(d(3));
    s().redo();
    expect(s().doc).toEqual(d(3));
  });

  it('records a whole drag gesture as one undo step', () => {
    s().beginGesture();
    s().replace(d(1));
    s().replace(d(2));
    s().endGesture();
    expect(s().doc).toEqual(d(2));
    s().undo();
    expect(s().doc).toEqual(d(0));
  });

  it('a gesture that changed nothing adds no undo step', () => {
    s().commit(d(1));
    s().beginGesture();
    s().endGesture();
    s().undo();
    expect(s().doc).toEqual(d(0));
  });

  it('tracks dirty state and clears it on save', () => {
    expect(s().dirty).toBe(false);
    s().commit(d(1));
    expect(s().dirty).toBe(true);
    s().markSaved('/tmp/a.json');
    expect(s()).toMatchObject({ dirty: false, filePath: '/tmp/a.json' });
  });

  it('keeps edits made during a save dirty', () => {
    s().commit(d(1));
    const saved = s();
    s().commit(d(2));
    s().markSaved('/tmp/a.json', saved.revision, saved.session);
    expect(s()).toMatchObject({ dirty: true, filePath: '/tmp/a.json', doc: d(2) });
  });

  it('a save completion cannot rename a different document', () => {
    const saved = s();
    s().load(d(5), '/tmp/b.json');
    s().markSaved('/tmp/a.json', saved.revision, saved.session);
    expect(s()).toMatchObject({ dirty: false, filePath: '/tmp/b.json', doc: d(5) });
  });

  it('preserves an invalid code draft across canvas edits until discarded', () => {
    s().setCodeDraft('{"entities":[');
    expect(s().dirty).toBe(true);
    s().commit(d(1));
    expect(s().codeDraft).toBe('{"entities":[');
    s().discardCodeDraft();
    expect(s().codeDraft).toBeNull();
    expect(s().doc).toEqual(d(1));
  });

  it('ignores stale code validation results', () => {
    s().setCodeDraft('old');
    s().setCodeDraft('new');
    s().acceptCodeDraft(d(1), 'old');
    expect(s().codeDraft).toBe('new');
    expect(s().doc).toEqual(d(0));
    s().acceptCodeDraft(d(2), 'new');
    expect(s().codeDraft).toBeNull();
    expect(s().doc).toEqual(d(2));
  });

  it('code validation cannot replace a newer canvas edit', () => {
    s().setCodeDraft('code');
    const revision = s().revision;
    s().commit(d(2));
    s().acceptCodeDraft(d(1), 'code', revision);
    expect(s().doc).toEqual(d(2));
    expect(s().codeDraft).toBe('code');
  });

  it('load resets history and selection', () => {
    s().commit(d(1));
    s().select({ entities: ['s1'], connections: [] });
    s().load(d(5), '/x.json');
    s().undo();
    expect(s().doc).toEqual(d(5));
    expect(s().selection.entities).toEqual([]);
  });

  it('caps history at 200 entries', () => {
    for (let i = 1; i <= 250; i++) s().commit(d(i));
    expect(s().past).toHaveLength(200);
  });

  it('drops selected ids that no longer exist after undo', () => {
    s().commit(d(1));
    s().select({ entities: ['s1'], connections: [] });
    s().undo();
    expect(s().selection.entities).toEqual([]);
  });
});

const empty: Doc = { entities: [], connections: [] };
const ids = () => useTabs.getState().tabs.map((t) => t.id);
const active = () => useTabs.getState().activeId;

describe('tabs', () => {
  beforeEach(() => {
    for (const id of ids()) removeTab(id); // closing the last tab leaves one fresh tab
    s().load(d(0), null);
  });

  it('keeps each tab’s document, history and dirty state apart', () => {
    const a = active();
    s().commit(d(1));
    const b = addTab();
    activateTab(b);
    expect(s()).toMatchObject({ doc: empty, dirty: false });
    s().commit(d(2));
    s().commit(d(3));
    s().undo();
    expect(s().doc).toEqual(d(2));
    activateTab(a);
    expect(s().doc).toEqual(d(1));
    s().undo();
    expect(s().doc).toEqual(d(0));
    s().undo(); // a has nothing left: must not reach into b
    expect(s().doc).toEqual(d(0));
    expect(tabState(b)).toMatchObject({ doc: d(2), dirty: true, future: [d(3)] });
  });

  it('actions taken from getState stay bound to their tab after a switch', () => {
    const a = active();
    const { commit, markSaved, session } = s();
    activateTab(addTab());
    commit(d(7));
    markSaved('/tmp/a.json', tabState(a)!.revision, session);
    expect(tabState(a)).toMatchObject({ doc: d(7), filePath: '/tmp/a.json', dirty: false });
    expect(s()).toMatchObject({ doc: empty, filePath: null, dirty: false });
  });

  it('a revision or session from one tab never matches another tab', () => {
    const a = s();
    const b = tabState(addTab())!;
    expect(b.revision).not.toBe(a.revision);
    expect(b.session).not.toBe(a.session);
    docApi(b.id).setCodeDraft('x');
    docApi(b.id).acceptCodeDraft(d(4), 'x', a.revision);
    expect(tabState(b.id)).toMatchObject({ codeDraft: 'x', doc: empty });
  });

  it('numbers untitled tabs and reuses a freed number', () => {
    const b = addTab();
    const c = addTab();
    expect([active(), b, c].map((id) => tabTitle(tabState(id)!))).toEqual([
      'Untitled',
      'Untitled 2',
      'Untitled 3',
    ]);
    removeTab(b);
    expect(tabTitle(tabState(addTab())!)).toBe('Untitled 2');
  });

  it('titles a file tab by its base name, hiding only .json', () => {
    expect(tabTitle({ filePath: '/a/b/Payments.JSON', untitled: 1 })).toBe('Payments');
    expect(tabTitle({ filePath: 'C:\\work\\flow.diagram', untitled: 1 })).toBe('flow.diagram');
    expect(tabTitle({ filePath: null, untitled: 3 })).toBe('Untitled 3');
  });

  it('closing the active tab activates its right neighbour, else the left', () => {
    const a = active();
    const b = addTab();
    const c = addTab();
    activateTab(b);
    expect(removeTab(b)).toBe(c);
    expect(removeTab(c)).toBe(a);
    expect(active()).toBe(a);
  });

  it('closing a background tab keeps the active one', () => {
    const a = active();
    expect(removeTab(addTab())).toBe(a);
  });

  it('closing the last tab leaves one fresh Untitled tab', () => {
    s().commit(d(1));
    const old = active();
    const next = removeTab(old);
    expect(next).not.toBe(old);
    expect(ids()).toEqual([next]);
    expect(isPristine(tabState(next)!)).toBe(true);
    expect(tabTitle(tabState(next)!)).toBe('Untitled');
  });

  it('moves a tab', () => {
    const a = active();
    const b = addTab();
    const c = addTab();
    moveTab(c, 0);
    expect(ids()).toEqual([c, a, b]);
    moveTab(c, 99);
    expect(ids()).toEqual([a, b, c]);
  });

  it('a pristine tab is untitled, unedited, empty and idle', () => {
    const fresh = () => tabState(addTab())!;
    expect(isPristine(fresh())).toBe(true);
    expect(isPristine(s())).toBe(false); // has a shape
    const drafted = fresh();
    docApi(drafted.id).setCodeDraft('{');
    expect(isPristine(tabState(drafted.id)!)).toBe(false);
    const busy = fresh();
    patchTab(busy.id, { busy: true });
    expect(isPristine(tabState(busy.id)!)).toBe(false);
    const named = fresh();
    docApi(named.id).load(empty, '/x.json');
    expect(isPristine(tabState(named.id)!)).toBe(false);
    const undone = fresh();
    docApi(undone.id).commit(d(1));
    docApi(undone.id).undo();
    expect(isPristine(tabState(undone.id)!)).toBe(false);
  });

  it('useDoc follows the active tab and its subscribers see a switch, not background changes', () => {
    const seen: number[] = [];
    const off = useDoc.subscribe((now, prev) =>
      seen.push(now.doc.entities.length - prev.doc.entities.length),
    );
    const b = addTab();
    docApi(b).commit(d(5));
    activateTab(b);
    off();
    expect(seen).toEqual([0]); // one event, for the switch (1 entity → 1 entity)
    expect(useDoc.getState().id).toBe(b);
  });

  it('acting on a closed tab changes nothing', () => {
    const b = addTab();
    const ops = docApi(b);
    removeTab(b);
    ops.commit(d(9));
    expect(tabState(b)).toBeUndefined();
    expect(useTabs.getState().tabs.map((t) => t.doc)).toEqual([d(0)]);
  });

  it('useDoc.setState patches only the active tab', () => {
    const a = active();
    const b = addTab();
    useDoc.setState({ dirty: true });
    expect(tabState(a)!.dirty).toBe(true);
    expect(tabState(b)!.dirty).toBe(false);
  });
});
