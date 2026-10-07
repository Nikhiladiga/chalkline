import { beforeEach, describe, expect, it } from 'vitest';
import type { Doc } from '../engine/types';
import { useDoc } from './store';

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
