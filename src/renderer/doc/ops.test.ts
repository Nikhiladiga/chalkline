import { describe, expect, it } from 'vitest';
import type { Doc } from '../engine/types';
import {
  addEntity,
  alignEntities,
  clampDelta,
  connect,
  copyElements,
  deleteElements,
  descendants,
  distributeEntities,
  dragEntities,
  duplicateEntities,
  getPrimaryText,
  insertIcon,
  moveEntities,
  pasteElements,
  reconnect,
  reparent,
  selectionRoots,
  setConnectionLabel,
  setPrimaryText,
  setProp,
  settleMove,
  snap,
  uniqueId,
} from './ops';

const doc = (): Doc => ({
  entities: [
    { tag: 'Group', id: 'vpc', x: 0, y: 0, width: 400, height: 300, title: { text: 'VPC' } },
    { tag: 'Icon', id: 'api', x: 40, y: 60, icon: 'server', containerId: 'vpc', texts: [{ text: 'API' }] },
    { tag: 'Group', id: 'sub', x: 200, y: 60, width: 150, height: 150, containerId: 'vpc' },
    { tag: 'Icon', id: 'db', x: 220, y: 100, icon: 'postgres', containerId: 'sub' },
    { tag: 'Shape', id: 'web', x: 500, y: 60, texts: [{ text: 'Web' }] },
  ],
  connections: [
    {
      from: 'web',
      to: 'api',
      x: 500,
      y: 80,
      points: [
        { x: 0, y: 0 },
        { x: -400, y: 0 },
      ],
      labelPlacement: { x: 1, y: 1, width: 2, height: 2 },
    },
    {
      from: 'api',
      to: 'db',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    },
  ],
});

describe('descendants', () => {
  it('collects nested children', () => {
    expect(descendants(doc(), 'vpc').sort()).toEqual(['api', 'db', 'sub']);
  });
});

describe('moveEntities', () => {
  it('moves a group together with all its descendants', () => {
    const out = moveEntities(doc(), ['vpc'], 10, 20);
    expect(out.entities.map((e) => [e.id, e.x, e.y])).toEqual([
      ['vpc', 10, 20],
      ['api', 50, 80],
      ['sub', 210, 80],
      ['db', 230, 120],
      ['web', 500, 60],
    ]);
  });

  it('drops stale routes only on connections touching moved entities', () => {
    const out = moveEntities(doc(), ['web'], 10, 0);
    expect(out.connections[0]).toEqual({ from: 'web', to: 'api' });
    expect(out.connections[1]!.points).toBeDefined();
  });

  it('drops routes when both ends move inside a moved group', () => {
    const out = moveEntities(doc(), ['vpc'], 5, 5);
    expect(out.connections[1]!.points).toBeUndefined();
  });

  it('clamps coordinates at zero and rounds to integers', () => {
    const out = moveEntities(doc(), ['web'], -900, 0.6);
    expect(out.entities[4]).toMatchObject({ x: 0, y: 61 });
  });

  it('keeps children fixed relative to their group when the move hits the canvas edge', () => {
    const out = moveEntities(doc(), ['vpc'], -40, -100);
    const vpc = out.entities[0]!;
    const api = out.entities[1]!;
    expect([vpc.x, vpc.y]).toEqual([0, 0]);
    expect([api.x - vpc.x, api.y - vpc.y]).toEqual([40, 60]);
  });

  it('clampDelta limits a delta so no moving entity goes below zero', () => {
    expect(clampDelta(doc(), ['api'], -100, -10)).toEqual({ dx: -40, dy: -10 });
  });

  it('does not mutate the input', () => {
    const d = doc();
    moveEntities(d, ['vpc'], 10, 10);
    expect(d.entities[0]!.x).toBe(0);
  });
});

describe('dragEntities', () => {
  it('creates space left and above the origin without changing the stationary diagram spacing', () => {
    const d = doc();
    const { doc: out, offset } = dragEntities(d, ['api'], -180, -150);
    expect(offset).toEqual({ x: 140, y: 90 });
    expect(out.entities.find((e) => e.id === 'api')).toMatchObject({ x: 0, y: 0 });
    expect(out.entities.find((e) => e.id === 'vpc')).toMatchObject({ x: 140, y: 90 });
    expect(out.entities.find((e) => e.id === 'web')).toMatchObject({ x: 640, y: 150 });
    expect(d.entities.find((e) => e.id === 'api')).toMatchObject({ x: 40, y: 60 });
    const boxes = {
      vpc: { x: 140, y: 90, width: 400, height: 300 },
      api: { x: 0, y: 0, width: 48, height: 48 },
    };
    expect(reparent(out, 'api', boxes).entities.find((e) => e.id === 'api')?.containerId).toBeUndefined();
    expect(out.connections.map((c) => [c.from, c.to])).toEqual(d.connections.map((c) => [c.from, c.to]));
  });

  it('moves all descendants together across the origin and leaves ordinary moves unchanged', () => {
    const d = doc();
    const { doc: out, offset } = dragEntities(d, ['sub'], -300, -160);
    expect(offset).toEqual({ x: 100, y: 100 });
    expect(out.entities.find((e) => e.id === 'sub')).toMatchObject({ x: 0, y: 0 });
    expect(out.entities.find((e) => e.id === 'db')).toMatchObject({ x: 20, y: 40, containerId: 'sub' });
    expect(dragEntities(d, ['web'], 10.4, 15.8)).toEqual({
      doc: moveEntities(d, ['web'], 10.4, 15.8),
      offset: { x: 0, y: 0 },
    });
  });
});

describe('insertIcon', () => {
  it('centers the icon, uses unique ids and joins the smallest containing group', () => {
    const d = doc();
    const boxes = {
      vpc: { x: 0, y: 0, width: 400, height: 300 },
      sub: { x: 200, y: 60, width: 150, height: 150 },
    };
    const out = insertIcon(d, 'user', { x: 250, y: 130 }, boxes);
    expect(out.doc.entities.at(-1)).toMatchObject({
      tag: 'Icon',
      id: 'user',
      icon: 'user',
      x: 226,
      y: 106,
      containerId: 'sub',
    });
    expect(out.offset).toEqual({ x: 0, y: 0 });
    expect(insertIcon(out.doc, 'user', { x: 600, y: 400 }, boxes).id).toBe('user-2');
    expect(d.entities).toHaveLength(5);
  });

  it('makes room for a drop before the origin without trapping it inside the group', () => {
    const out = insertIcon(
      doc(),
      'user',
      { x: -70, y: -50 },
      {
        vpc: { x: 0, y: 0, width: 400, height: 300 },
      },
    );
    expect(out.offset).toEqual({ x: 94, y: 74 });
    expect(out.doc.entities.at(-1)).toMatchObject({ x: 0, y: 0 });
    expect(out.doc.entities.at(-1)?.containerId).toBeUndefined();
    expect(out.doc.entities[0]).toMatchObject({ x: 94, y: 74 });
    expect(out.doc.connections.map((c) => [c.from, c.to])).toEqual(
      doc().connections.map((c) => [c.from, c.to]),
    );
  });
});

describe('deleteElements', () => {
  it('removes connections attached to deleted entities', () => {
    const out = deleteElements(doc(), ['web'], []);
    expect(out.connections).toEqual([doc().connections[1]]);
  });

  it('re-homes children of a deleted container to its parent', () => {
    const out = deleteElements(doc(), ['sub'], []);
    expect(out.entities.find((e) => e.id === 'db')!.containerId).toBe('vpc');
  });

  it('removes a connection by index', () => {
    expect(deleteElements(doc(), [], [0]).connections).toHaveLength(1);
  });
});

describe('duplicateEntities', () => {
  it('copies with fresh ids and an offset', () => {
    const { doc: out, newIds } = duplicateEntities(doc(), ['web']);
    expect(newIds).toEqual(['web-2']);
    expect(out.entities.at(-1)).toMatchObject({ id: 'web-2', x: 520, y: 80 });
  });

  it('keeps copied children inside the copied container', () => {
    const { doc: out } = duplicateEntities(doc(), ['sub']);
    const copy = out.entities.find((e) => e.id === 'db-2')!;
    expect(copy.containerId).toBe('sub-2');
  });
});

describe('ids and text', () => {
  it('uniqueId appends a counter', () => {
    expect(uniqueId(doc(), 'api')).toBe('api-2');
    expect(uniqueId(doc(), 'New Thing!')).toBe('new-thing');
  });

  it('reads and writes the primary text for each text slot', () => {
    let d = setPrimaryText(doc(), 'web', 'Frontend');
    d = setPrimaryText(d, 'vpc', 'Main VPC');
    expect(getPrimaryText(d.entities[4]!)).toBe('Frontend');
    expect(getPrimaryText(d.entities[0]!)).toBe('Main VPC');
    const tb = setPrimaryText(
      addEntity(d, { tag: 'Textbox', id: 'note', x: 0, y: 0, text: 'a' }),
      'note',
      'b',
    );
    expect(getPrimaryText(tb.entities.at(-1)!)).toBe('b');
  });

  it('uses label for Divider and leaves Legend text alone', () => {
    let d = addEntity(doc(), { tag: 'Divider', id: 'div', x: 0, y: 0, orientation: 'horizontal' });
    d = addEntity(d, { tag: 'Legend', id: 'leg', x: 0, y: 0, entries: [{ text: 'a' }] });
    d = setPrimaryText(setPrimaryText(d, 'div', 'Zone'), 'leg', 'x');
    expect(d.entities.at(-2)!.label).toBe('Zone');
    expect(d.entities.at(-1)).toEqual({ tag: 'Legend', id: 'leg', x: 0, y: 0, entries: [{ text: 'a' }] });
  });

  it('setProp deletes a key when given undefined', () => {
    const d = setProp(doc(), { entity: 'web' }, 'texts', undefined);
    expect('texts' in d.entities[4]!).toBe(false);
    expect(setProp(doc(), { connection: 1 }, 'label', 'SQL').connections[1]!.label).toBe('SQL');
  });

  it('addEntity renames a clashing id', () => {
    const d = addEntity(doc(), { tag: 'Shape', id: 'web', x: 1, y: 1 });
    expect(d.entities.at(-1)!.id).toBe('web-2');
  });
});

describe('connect', () => {
  it('adds a connection once and ignores self-links and duplicates', () => {
    let d = connect(doc(), 'db', 'web');
    expect(d.connections.at(-1)).toEqual({ from: 'db', to: 'web' });
    d = connect(d, 'db', 'web');
    d = connect(d, 'db', 'db');
    expect(d.connections).toHaveLength(3);
  });

  it('retains chosen ports, permits distinct port pairs, and ignores exact duplicates and self-links', () => {
    const d = connect(doc(), 'db', 'web', { fromPort: 'top-left', toPort: 'bottom-right' });
    expect(d.connections.at(-1)).toMatchObject({
      from: 'db',
      to: 'web',
      fromPort: 'top-left',
      toPort: 'bottom-right',
    });
    expect(connect(d, 'db', 'web', { fromPort: 'top-left', toPort: 'bottom-right' })).toBe(d);
    expect(connect(d, 'db', 'web', { fromPort: 'left', toPort: 'right' }).connections).toHaveLength(
      d.connections.length + 1,
    );
    expect(connect(d, 'db', 'db', { fromPort: 'left', toPort: 'right' })).toBe(d);
    expect(moveEntities(d, ['db'], 30, 40).connections.at(-1)).toMatchObject({
      fromPort: 'top-left',
      toPort: 'bottom-right',
    });
  });
});

describe('reparent', () => {
  const boxes = {
    vpc: { x: 0, y: 0, width: 400, height: 300 },
    sub: { x: 200, y: 60, width: 150, height: 150 },
    api: { x: 40, y: 60, width: 50, height: 70 },
    db: { x: 220, y: 100, width: 50, height: 70 },
    web: { x: 230, y: 90, width: 100, height: 40 },
  };

  it('puts an entity into the smallest container under its center', () => {
    expect(reparent(doc(), 'web', boxes).entities[4]!.containerId).toBe('sub');
  });

  it('moves an entity out to the root when no container holds it', () => {
    const out = reparent(doc(), 'api', { ...boxes, api: { x: 900, y: 900, width: 10, height: 10 } });
    expect(out.entities[1]!.containerId).toBeUndefined();
  });

  it('never nests a container inside its own descendant', () => {
    const out = reparent(doc(), 'vpc', { ...boxes, vpc: { x: 210, y: 70, width: 20, height: 20 } });
    expect(out.entities[0]!.containerId).toBeUndefined();
  });
});

describe('snap', () => {
  it('aligns left edges inside the threshold and reports a guide', () => {
    const r = snap({ x: 103, y: 300, width: 50, height: 50 }, [{ x: 100, y: 0, width: 80, height: 40 }]);
    expect(r.dx).toBe(-3);
    expect(r.guides).toContainEqual({ x: 100 });
  });

  it('aligns vertical centers', () => {
    const r = snap({ x: 400, y: 14, width: 50, height: 50 }, [{ x: 0, y: 20, width: 80, height: 40 }]);
    expect(r.dy).toBe(1);
    expect(r.guides).toContainEqual({ y: 40 });
  });

  it('does nothing outside the threshold', () => {
    expect(
      snap({ x: 300, y: 300, width: 50, height: 50 }, [{ x: 100, y: 0, width: 80, height: 40 }]),
    ).toEqual({
      dx: 0,
      dy: 0,
      guides: [],
    });
  });
});

describe('selectionRoots', () => {
  it('drops ids that sit inside another selected id', () => {
    expect(selectionRoots(doc(), ['vpc', 'api', 'db', 'web'])).toEqual(['vpc', 'web']);
    expect(selectionRoots(doc(), ['sub', 'api'])).toEqual(['sub', 'api']);
  });
});

describe('copyElements / pasteElements', () => {
  it('copies descendants and inner connections without routes or ids', () => {
    const clip = copyElements(doc(), ['vpc']);
    expect(clip.entities.map((e) => e.id)).toEqual(['vpc', 'api', 'sub', 'db']);
    expect(clip.connections).toEqual([{ from: 'api', to: 'db' }]);
    expect(copyElements(doc(), ['sub']).connections).toEqual([]);
  });

  it('pastes with fresh ids and an offset, remapping containers and connection ends', () => {
    const { doc: out, newIds, idMap } = pasteElements(doc(), copyElements(doc(), ['vpc']), 20, 20, true);
    expect(newIds).toEqual(['vpc-2']);
    expect(idMap.get('db')).toBe('db-2');
    expect(out.entities.find((e) => e.id === 'db-2')).toMatchObject({ containerId: 'sub-2', x: 240, y: 120 });
    expect(out.connections.at(-1)).toEqual({ from: 'api-2', to: 'db-2' });
  });

  it('keeps a root in its container only when asked and the container exists', () => {
    const clip = copyElements(doc(), ['api']);
    expect(pasteElements(doc(), clip, 0, 0, true).doc.entities.at(-1)!.containerId).toBe('vpc');
    expect(pasteElements(doc(), clip, 0, 0, false).doc.entities.at(-1)!.containerId).toBeUndefined();
    const empty: Doc = { entities: [], connections: [] };
    const into = pasteElements(empty, clip, 0, 0, true);
    expect(into.doc.entities).toEqual(
      [{ ...clip.entities[0], id: 'api' }].map(({ containerId: _, ...e }) => e),
    );
  });

  it('drops pasted connections whose ends were not pasted', () => {
    const clip: Doc = {
      entities: [{ tag: 'Shape', id: 'x', x: 0, y: 0 }],
      connections: [{ from: 'x', to: 'missing' }],
    };
    expect(pasteElements(doc(), clip, 0, 0, false).doc.connections).toHaveLength(2);
  });

  it('strips foreign connection ids and routes, and pastes 2,000 elements quickly', () => {
    const clip: Doc = {
      entities: Array.from({ length: 2000 }, (_, i) => ({ tag: 'Shape', id: `n${i}`, x: i, y: 0 })),
      connections: [{ from: 'n0', to: 'n1', id: 'k', points: [[1, 1]] } as never],
    };
    const t0 = performance.now();
    const { doc: out } = pasteElements(doc(), clip, 0, 0, false);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(new Set(out.entities.map((e) => e.id)).size).toBe(out.entities.length);
    expect(out.connections.at(-1)).toEqual({ from: 'n0', to: 'n1' });
  });
});

describe('setConnectionLabel', () => {
  it('sets, trims and removes a label and its stale box, with no change for the same text', () => {
    const d = doc();
    const set = setConnectionLabel(d, 0, '  HTTP  ');
    expect(set.connections[0]!.label).toBe('HTTP');
    expect(set.connections[0]).not.toHaveProperty('labelPlacement');
    expect(setConnectionLabel(set, 0, 'HTTP')).toBe(set);
    expect(setConnectionLabel(set, 0, '   ').connections[0]).not.toHaveProperty('label');
    expect(setConnectionLabel(d, 7, 'x')).toBe(d);
  });
});

describe('reconnect', () => {
  it('moves one end, drops the stale route and keeps the rest', () => {
    const d = doc();
    d.connections[0]!.label = 'calls';
    const out = reconnect(d, 0, 'to', 'db');
    expect(out.connections[0]).toEqual({ from: 'web', to: 'db', label: 'calls' });
    expect(d.connections[0]!.to).toBe('api'); // input untouched
  });

  it('sets ports on both ends or on neither', () => {
    const pinned = reconnect(doc(), 0, 'to', 'db', { fromPort: 'left', toPort: 'top' });
    expect(pinned.connections[0]).toMatchObject({ from: 'web', to: 'db', fromPort: 'left', toPort: 'top' });
    const floating = reconnect(pinned, 0, 'to', 'api');
    expect(floating.connections[0]).not.toHaveProperty('fromPort');
    expect(floating.connections[0]).not.toHaveProperty('toPort');
  });

  it('refuses self-links, missing targets or connections, no-ops and duplicates', () => {
    const d = doc();
    expect(reconnect(d, 0, 'to', 'web')).toBe(d); // web → web
    expect(reconnect(d, 0, 'to', 'nope')).toBe(d);
    expect(reconnect(d, 9, 'to', 'db')).toBe(d);
    expect(reconnect(d, 0, 'to', 'api')).toBe(d); // unchanged
    expect(reconnect(d, 0, 'from', 'api')).toBe(d); // api → api
    const twin = reconnect(d, 1, 'from', 'web'); // api → db becomes web → db
    expect(reconnect(twin, 0, 'to', 'db')).toBe(twin); // would duplicate web → db
  });

  it('treats duplicates as connect does: a floating pair duplicates any pinning, ports only their own', () => {
    const d = connect(doc(), 'web', 'db', { fromPort: 'left', toPort: 'top' });
    expect(reconnect(d, 0, 'to', 'db')).toBe(d); // web → db already exists
    expect(reconnect(d, 0, 'to', 'db', { fromPort: 'left', toPort: 'top' })).toBe(d);
    const other = reconnect(d, 0, 'to', 'db', { fromPort: 'bottom', toPort: 'right' });
    expect(other.connections[0]).toMatchObject({
      from: 'web',
      to: 'db',
      fromPort: 'bottom',
      toPort: 'right',
    });
    // Moving an end to another port of the same element is a change.
    const moved = reconnect(other, 0, 'to', 'db', { fromPort: 'bottom', toPort: 'left' });
    expect(moved.connections[0]).toMatchObject({ toPort: 'left' });
  });
});

describe('alignEntities / distributeEntities', () => {
  const row = (): Doc => ({
    entities: [
      { tag: 'Icon', id: 'p', x: 100, y: 100 },
      { tag: 'Icon', id: 'q', x: 220, y: 200 },
      { tag: 'Icon', id: 'r', x: 600, y: 300 },
    ],
    connections: [],
  });
  // Render boxes; the ops read only their sizes, positions come from the document.
  const boxes = {
    p: { x: 0, y: 0, width: 50, height: 50 },
    q: { x: 0, y: 0, width: 50, height: 50 },
    r: { x: 0, y: 0, width: 50, height: 50 },
  };
  const at = (d: Doc) => d.entities.map((e) => [e.x, e.y]);

  it('aligns edges and centres to the selection box', () => {
    expect(at(alignEntities(row(), ['p', 'q', 'r'], boxes, 'left'))).toEqual([
      [100, 100],
      [100, 200],
      [100, 300],
    ]);
    expect(at(alignEntities(row(), ['p', 'q', 'r'], boxes, 'center'))).toEqual([
      [350, 100],
      [350, 200],
      [350, 300],
    ]);
    expect(at(alignEntities(row(), ['p', 'q', 'r'], boxes, 'bottom'))).toEqual([
      [100, 300],
      [220, 300],
      [600, 300],
    ]);
  });

  it('moves a container with its children; a container plus its own child is one root, so nothing moves', () => {
    const sized = {
      vpc: { x: 0, y: 0, width: 400, height: 300 },
      api: { x: 40, y: 60, width: 48, height: 48 },
      sub: { x: 200, y: 60, width: 150, height: 150 },
      db: { x: 220, y: 100, width: 48, height: 48 },
      web: { x: 500, y: 60, width: 90, height: 40 },
    };
    const out = alignEntities(doc(), ['vpc', 'web'], sized, 'top');
    expect(out.entities.find((e) => e.id === 'web')!.y).toBe(0);
    const down = alignEntities(doc(), ['vpc', 'web'], sized, 'bottom');
    expect(at(down).slice(0, 4)).toEqual([
      [0, 0],
      [40, 60],
      [200, 60],
      [220, 100],
    ]);
    expect(down.entities.find((e) => e.id === 'web')!.y).toBe(260);
    const one = doc();
    expect(alignEntities(one, ['web'], sized, 'top')).toBe(one);
    expect(alignEntities(one, ['vpc', 'api', 'db'], sized, 'left')).toBe(one);
    expect(distributeEntities(one, ['vpc', 'sub', 'db', 'api'], sized, 'x')).toBe(one);
  });

  it('aligns across containers in absolute coordinates; grouping never changes, containers still grow', () => {
    const d: Doc = {
      entities: [
        { tag: 'Group', id: 'g', x: 0, y: 0, width: 200, height: 200 },
        { tag: 'Icon', id: 'k', x: 20, y: 20, containerId: 'g' },
        { tag: 'Icon', id: 'm', x: 150, y: 300 },
      ],
      connections: [],
    };
    const sized = {
      g: { x: 0, y: 0, width: 200, height: 200 },
      k: { x: 20, y: 20, width: 48, height: 48 },
      m: { x: 150, y: 300, width: 100, height: 40 },
    };
    // m's centre lands on g's edge: a drop would adopt it, align does not.
    const top = alignEntities(d, ['k', 'm'], sized, 'top');
    expect(top.entities[2]).toMatchObject({ x: 150, y: 20 });
    expect(top.entities[2]!.containerId).toBeUndefined();
    expect(top.entities[0]).toMatchObject({ x: 0, y: 0, width: 200, height: 200 });
    // k's centre leaves g: it stays g's child, and g grows to hold it with the 32 px drop padding.
    const right = alignEntities(d, ['k', 'm'], sized, 'right');
    expect(right.entities[1]).toMatchObject({ x: 202, y: 20, containerId: 'g' });
    expect(right.entities[0]).toMatchObject({ x: 0, y: 0, width: 282, height: 200 });
  });

  it('settleMove reparents every listed root, moved or not, then grows containers', () => {
    const boxes = {
      vpc: { x: 0, y: 0, width: 400, height: 300 },
      sub: { x: 200, y: 60, width: 150, height: 150 },
      api: { x: 40, y: 60, width: 48, height: 48 },
      db: { x: 220, y: 100, width: 48, height: 48 },
      web: { x: 230, y: 90, width: 100, height: 40 },
    };
    const out = settleMove(doc(), ['web'], boxes);
    expect(out.entities[4]!.containerId).toBe('sub');
    expect(settleMove(doc(), [], boxes).entities.map((e) => e.containerId)).toEqual(
      doc().entities.map((e) => e.containerId),
    );
  });

  it('distributes with equal gaps and leaves the ends in place; needs three roots', () => {
    expect(at(distributeEntities(row(), ['p', 'q', 'r'], boxes, 'x'))).toEqual([
      [100, 100],
      [350, 200],
      [600, 300],
    ]);
    expect(at(distributeEntities(row(), ['r', 'q', 'p'], boxes, 'y'))).toEqual([
      [100, 100],
      [220, 200],
      [600, 300],
    ]);
    const wide = { ...boxes, q: { x: 0, y: 0, width: 150, height: 50 } };
    expect(at(distributeEntities(row(), ['p', 'q', 'r'], wide, 'x'))[1]).toEqual([300, 200]);
    const two = row();
    expect(distributeEntities(two, ['p', 'q'], boxes, 'x')).toBe(two);
    expect(alignEntities(two, ['p', 'q', 'missing'], {}, 'left')).toBe(two);
  });
});
