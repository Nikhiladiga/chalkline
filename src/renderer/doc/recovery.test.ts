import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Doc } from '../engine/types';
import { fromRecovery, restoredTab, restoredTabs, toRecovery, watchRecovery } from './recovery';
import { activateTab, addTab, docApi, patchTab, removeTab, tabState, useDoc, useTabs } from './store';

const d = (n: number): Doc => ({ entities: [{ tag: 'Shape', id: `s${n}`, x: n, y: 0 }], connections: [] });
const snapshot = () => useTabs.getState();
const none = { recoveryVersion: 2, active: 0, tabs: [] };

beforeEach(() => {
  for (const t of snapshot().tabs) removeTab(t.id);
});

describe('toRecovery', () => {
  it('is null when nothing is unsaved, even with clean file tabs open', () => {
    docApi(snapshot().activeId).load(d(1), '/a.json');
    expect(toRecovery(snapshot().tabs, snapshot().activeId)).toBeNull();
  });

  it('keeps every tab with content in order, skips a pristine Untitled, and records the active tab', () => {
    const file = snapshot().activeId;
    docApi(file).load(d(1), '/a.json'); // clean, but has content
    addTab(); // pristine: skipped
    const drafted = addTab();
    docApi(drafted).setCodeDraft('{"entities": [');
    const edited = addTab();
    docApi(edited).commit(d(2));
    patchTab(edited, { busy: true }); // a running AI is never persisted
    activateTab(drafted);
    const saved = JSON.parse(toRecovery(snapshot().tabs, snapshot().activeId)!);
    expect(saved).toEqual({
      recoveryVersion: 2,
      active: 1,
      tabs: [
        { doc: d(1), codeDraft: null, filePath: '/a.json', dirty: false },
        { doc: { entities: [], connections: [] }, codeDraft: '{"entities": [', filePath: null, dirty: true },
        { doc: d(2), codeDraft: null, filePath: null, dirty: true },
      ],
    });
  });

  it('points at the first kept tab when the active tab is the pristine one', () => {
    const edited = snapshot().activeId;
    docApi(edited).commit(d(1));
    activateTab(addTab());
    expect(JSON.parse(toRecovery(snapshot().tabs, snapshot().activeId)!).active).toBe(0);
  });
});

describe('fromRecovery', () => {
  it('round-trips v2', () => {
    docApi(snapshot().activeId).commit(d(3));
    const text = toRecovery(snapshot().tabs, snapshot().activeId)!;
    expect(fromRecovery(text)).toEqual(JSON.parse(text));
  });

  it('migrates v1 (one document and its code draft)', () => {
    expect(fromRecovery(JSON.stringify({ recoveryVersion: 1, doc: d(1), codeDraft: '{' }))).toEqual({
      recoveryVersion: 2,
      active: 0,
      tabs: [{ doc: d(1), codeDraft: '{', filePath: null, dirty: true }],
    });
  });

  it('migrates the oldest format, a bare document', () => {
    expect(fromRecovery(JSON.stringify(d(4))).tabs).toEqual([
      { doc: d(4), codeDraft: null, filePath: null, dirty: true },
    ]);
  });

  it('sanitises v2 entries and clamps the active index', () => {
    const text = JSON.stringify({
      recoveryVersion: 2,
      active: 9,
      tabs: [
        null,
        { doc: d(1), codeDraft: 5, filePath: 7 },
        { doc: d(2), dirty: false, filePath: '/b.json' },
      ],
    });
    expect(fromRecovery(text)).toEqual({
      recoveryVersion: 2,
      active: 1,
      tabs: [
        { doc: d(1), codeDraft: null, filePath: null, dirty: true },
        { doc: d(2), codeDraft: null, filePath: '/b.json', dirty: false },
      ],
    });
  });

  it('ignores a corrupt file, an unknown future version and a non-object', () => {
    expect(fromRecovery('{"recoveryVersion": 2, "tabs": [')).toEqual(none);
    expect(fromRecovery(JSON.stringify({ recoveryVersion: 3, tabs: [{ doc: d(1) }] }))).toEqual(none);
    expect(fromRecovery('null')).toEqual(none);
    expect(fromRecovery('"text"')).toEqual(none);
  });
});

describe('restoredTab', () => {
  it('restores the snapshot with its title as an edited Untitled, fitted on first show', () => {
    expect(
      restoredTab({ doc: { title: 'T', ...d(1) }, codeDraft: '{', filePath: '/a.json', dirty: true }),
    ).toEqual({ doc: { title: 'T', ...d(1) }, codeDraft: '{', filePath: null, dirty: true, view: null });
  });

  it('never drops a tab: an unreadable document comes back as a code draft', () => {
    expect(restoredTab({ doc: 'garbage', codeDraft: null, filePath: null, dirty: true })).toEqual({
      filePath: null,
      dirty: true,
      view: null,
      codeDraft: '"garbage"',
    });
  });
});

describe('restoredTabs', () => {
  const file = (path: string, doc: Doc) => ({ path, content: JSON.stringify(doc), key: path.toLowerCase() });

  it('reloads clean file tabs from disk and restores edited tabs from their snapshot', async () => {
    const read = vi.fn(async (path: string) => file(path, d(9)));
    const { tabs, missing } = await restoredTabs(
      fromRecovery(
        JSON.stringify({
          recoveryVersion: 2,
          active: 0,
          tabs: [
            { doc: d(1), codeDraft: null, filePath: '/A.json', dirty: false },
            { doc: d(2), codeDraft: '{', filePath: '/b.json', dirty: true },
          ],
        }),
      ),
      read,
    );
    expect(read).toHaveBeenCalledTimes(1);
    expect(missing).toEqual([]);
    expect(tabs).toEqual([
      { doc: d(9), codeDraft: null, filePath: '/A.json', fileKey: '/a.json', dirty: false, view: null },
      { doc: d(2), codeDraft: '{', filePath: null, dirty: true, view: null },
    ]);
  });

  it('falls back to the snapshot when a clean file is gone or unreadable', async () => {
    const entry = { doc: d(1), codeDraft: null, filePath: '/gone.json', dirty: false };
    const gone = await restoredTabs({ recoveryVersion: 2, active: 0, tabs: [entry] }, async () => {
      throw new Error('ENOENT');
    });
    expect(gone).toEqual({ tabs: [restoredTab(entry)], missing: ['/gone.json'] });
    const garbled = await restoredTabs({ recoveryVersion: 2, active: 0, tabs: [entry] }, async (p) => ({
      path: p,
      content: 'not json',
      key: p,
    }));
    expect(garbled.missing).toEqual(['/gone.json']);
  });
});

describe('watchRecovery', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const io = () => ({
    write: vi.fn(async (_text: string) => {}),
    clear: vi.fn(async () => {}),
  });

  it('writes all tabs 2 s after the last change, skips identical text, and clears once all is saved', () => {
    const w = io();
    const off = watchRecovery(w, () => {});
    useDoc.getState().commit(d(1));
    vi.advanceTimersByTime(1999);
    expect(w.write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(w.write).toHaveBeenCalledTimes(1);
    expect(JSON.parse(w.write.mock.calls[0]![0]).tabs).toHaveLength(1);
    useDoc.getState().select({ entities: ['s1'], connections: [] }); // same recovery text
    vi.advanceTimersByTime(2000);
    expect(w.write).toHaveBeenCalledTimes(1);
    useDoc.getState().markSaved('/tmp/a.json');
    vi.advanceTimersByTime(2000);
    expect(w.clear).toHaveBeenCalledTimes(1);
    off();
  });

  it('never clears a crash file just because the app started clean', () => {
    const w = io();
    const off = watchRecovery(w, () => {});
    activateTab(addTab());
    vi.advanceTimersByTime(5000);
    expect(w.clear).not.toHaveBeenCalled();
    expect(w.write).not.toHaveBeenCalled();
    off();
  });

  it('reports a failed write', async () => {
    const errors: unknown[] = [];
    const off = watchRecovery(
      { write: async () => Promise.reject(new Error('disk full')), clear: async () => {} },
      (e) => errors.push(e),
    );
    useDoc.getState().commit(d(1));
    await vi.advanceTimersByTimeAsync(2000);
    expect(String(errors[0])).toContain('disk full');
    off();
    expect(tabState(snapshot().activeId)?.dirty).toBe(true);
  });
});
