import { describe, expect, it } from 'vitest';
import type { Box, Doc } from '../engine/types';
import { autoLayout } from './elk';
import { checkLayout } from './quality';

const doc: Doc = {
  entities: [
    { tag: 'Group', id: 'g', x: 0, y: 0, width: 200, height: 200 },
    { tag: 'Shape', id: 'a', x: 10, y: 40, containerId: 'g' },
    { tag: 'Shape', id: 'b', x: 50, y: 60, containerId: 'g' },
    { tag: 'Shape', id: 'c', x: 300, y: 0 },
  ],
  connections: [
    { from: 'a', to: 'b' },
    {
      from: 'b',
      to: 'c',
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ],
    },
  ],
};
const boxes: Record<string, Box> = {
  g: { x: 0, y: 0, width: 200, height: 200 },
  a: { x: 10, y: 40, width: 100, height: 50 },
  b: { x: 50, y: 60, width: 100, height: 50 },
  c: { x: 300, y: 0, width: 100, height: 50 },
};

describe('checkLayout', () => {
  it('reports overlapping siblings in the same container', () => {
    expect(checkLayout(doc, boxes).overlaps).toEqual([['a', 'b']]);
  });

  it('does not count a container overlapping its own child', () => {
    expect(checkLayout(doc, boxes).overlaps.flat()).not.toContain('g');
  });

  it('reports children that stick out of their container', () => {
    const out = checkLayout(doc, { ...boxes, b: { x: 150, y: 60, width: 100, height: 50 } });
    expect(out.outside).toEqual(['b']);
  });

  it('reports nothing for a clean layout', () => {
    const clean = {
      ...boxes,
      b: { x: 10, y: 120, width: 100, height: 50 },
      c: { x: 300, y: 0, width: 100, height: 50 },
    };
    expect(checkLayout(doc, clean)).toEqual({ overlaps: [], outside: [] });
  });
});

describe('autoLayout', () => {
  it('produces an overlap-free layout with children inside containers', async () => {
    const out = await autoLayout(doc, boxes);
    const sized: Record<string, Box> = {};
    for (const e of out.entities)
      sized[e.id] = {
        x: e.x,
        y: e.y,
        width: e.width ?? boxes[e.id]!.width,
        height: e.height ?? boxes[e.id]!.height,
      };
    expect(checkLayout(out, sized)).toEqual({ overlaps: [], outside: [] });
  });

  it('flows left to right along connections', async () => {
    const out = await autoLayout(doc, boxes);
    const x = (id: string) => out.entities.find((e) => e.id === id)!.x;
    expect(x('a')).toBeLessThan(x('b'));
    expect(x('b')).toBeLessThan(x('c'));
  });

  it('writes integer, non-negative coordinates and drops stale routes', async () => {
    const out = await autoLayout(doc, boxes);
    for (const e of out.entities) {
      expect(Number.isInteger(e.x) && e.x >= 0 && Number.isInteger(e.y) && e.y >= 0).toBe(true);
    }
    expect(out.connections[1]!.points).toBeUndefined();
  });
});

describe('autoLayout inside containers and for tiered diagrams', () => {
  const card = (id: string, containerId: string) => ({
    tag: 'Shape',
    id,
    x: 0,
    y: 0,
    width: 220,
    height: 96,
    containerId,
  });
  const tiered: Doc = {
    entities: [
      { tag: 'Textbox', id: 'title', x: 500, y: 500, text: '## Title' },
      { tag: 'Legend', id: 'legend', x: 0, y: 900, entries: [{ text: 'a' }] },
      { tag: 'Group', id: 't1', x: 0, y: 0, width: 10, height: 10, title: { text: 'One' } },
      card('a', 't1'),
      card('b', 't1'),
      { tag: 'Group', id: 't2', x: 0, y: 0, width: 10, height: 10, title: { text: 'Two' } },
      card('c', 't2'),
      card('d', 't2'),
    ],
    connections: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'd' },
    ],
  };
  const boxesOf = (d: Doc): Record<string, Box> =>
    Object.fromEntries(
      d.entities.map((e) => [
        e.id,
        { x: e.x, y: e.y, width: (e.width as number) ?? 200, height: (e.height as number) ?? 40 },
      ]),
    );

  it('keeps a wide gap between cards inside a group, so edge labels fit', async () => {
    const out = await autoLayout(tiered, boxesOf(tiered));
    const a = out.entities.find((e) => e.id === 'a')!;
    const b = out.entities.find((e) => e.id === 'b')!;
    expect(b.x - (a.x + 220)).toBeGreaterThanOrEqual(80);
  });

  it('puts unconnected cards of a tier in one row', async () => {
    const d: Doc = {
      entities: [
        { tag: 'Group', id: 't1', x: 0, y: 0, title: { text: 'One' } },
        card('p', 't1'),
        { tag: 'Group', id: 't2', x: 0, y: 0, title: { text: 'Data' } },
        card('x', 't2'),
        card('y', 't2'),
        card('z', 't2'),
      ],
      connections: [
        { from: 'p', to: 'x' },
        { from: 'p', to: 'y' },
        { from: 'p', to: 'z' },
      ],
    };
    const out = await autoLayout(d, boxesOf(d));
    const ys = ['x', 'y', 'z'].map((id) => out.entities.find((e) => e.id === id)!.y);
    expect(new Set(ys).size).toBe(1);
  });

  it('leaves room between tiers for labels on lines that cross them', async () => {
    const out = await autoLayout(tiered, boxesOf(tiered));
    const t1 = out.entities.find((e) => e.id === 't1')!;
    const t2 = out.entities.find((e) => e.id === 't2')!;
    expect(t2.y - (t1.y + (t1.height as number))).toBeGreaterThanOrEqual(80);
  });

  it('stacks top-level groups as full-width tiers under the title, legend top-right', async () => {
    const out = await autoLayout(tiered, boxesOf(tiered));
    const by = (id: string) => out.entities.find((e) => e.id === id)!;
    const [t1, t2, title, legend] = [by('t1'), by('t2'), by('title'), by('legend')];
    expect(t1.x).toBe(t2.x);
    expect(t1.width).toBe(t2.width);
    expect(t2.y).toBeGreaterThan(t1.y + (t1.height as number));
    expect(title.y).toBeLessThan(t1.y);
    expect(legend.y).toBeLessThan(t1.y);
    expect(legend.x).toBeGreaterThan(t1.x + (t1.width as number) / 2);
    // children stay inside their tier
    for (const id of ['c', 'd']) expect(by(id).y).toBeGreaterThan(t2.y);
  });
});

describe('layout with painted footprints (icon + caption)', () => {
  // An Icon glyph at (100,100) 50x50 whose caption paints 20px wider on each side and 30px below.
  const icons: Doc = {
    entities: [
      { tag: 'Icon', id: 'p', x: 100, y: 100, icon: 'docker', texts: [{ text: 'Container 1' }] },
      { tag: 'Icon', id: 'q', x: 100, y: 160, icon: 'docker', texts: [{ text: 'Container 2' }] },
    ],
    connections: [],
  };
  const painted: Record<string, Box> = {
    p: { x: 80, y: 100, width: 90, height: 85 },
    q: { x: 80, y: 160, width: 90, height: 85 },
  };

  it('a caption running into the next icon counts as an overlap', () => {
    expect(checkLayout(icons, painted).overlaps).toEqual([['p', 'q']]);
  });

  it('auto-layout places the glyph, not the footprint, at x/y', async () => {
    const out = await autoLayout(icons, painted);
    const [p, q] = out.entities;
    // The footprint sits 20px left of the glyph; ELK places footprints at x >= 40.
    expect(p!.x).toBeGreaterThanOrEqual(60);
    // Footprints (85px tall) do not overlap after layout.
    const fp = (e: typeof p) => ({ x: e!.x - 20, y: e!.y, width: 90, height: 85 });
    expect(checkLayout(out, { p: fp(p), q: fp(q) }).overlaps).toEqual([]);
  });
});

describe('autoLayout header and empty groups', () => {
  const head = (extra: Doc['entities']): Doc => ({
    entities: [
      { tag: 'Textbox', id: 'title', x: 0, y: 900, width: 760, text: '## Title' },
      { tag: 'Legend', id: 'legend', x: 0, y: 900, width: 200, entries: [{ text: 'a' }] },
      ...extra,
    ],
    connections: [],
  });
  const sized = (d: Doc): Record<string, Box> =>
    Object.fromEntries(
      d.entities.map((e) => [
        e.id,
        { x: e.x, y: e.y, width: (e.width as number) ?? 120, height: (e.height as number) ?? 60 },
      ]),
    );

  it('puts the title and legend on top even with a single group', async () => {
    const d = head([
      { tag: 'Group', id: 'g', x: 0, y: 0, title: { text: 'G' } },
      { tag: 'Shape', id: 'a', x: 0, y: 0, width: 220, height: 96, containerId: 'g' },
    ]);
    const out = await autoLayout(d, sized(d));
    const by = (id: string) => out.entities.find((e) => e.id === id)!;
    expect(by('title').y).toBeLessThan(by('g').y);
    expect(by('legend').y).toBeLessThan(by('g').y);
  });

  it('never lets the legend overlap a wide title', async () => {
    const d = head([{ tag: 'Shape', id: 'a', x: 0, y: 0, width: 220, height: 96 }]);
    const out = await autoLayout(d, sized(d));
    const by = (id: string) => out.entities.find((e) => e.id === id)!;
    expect(by('legend').x).toBeGreaterThanOrEqual(by('title').x + 760);
  });

  it('lays out an empty group as a small container, not as a huge leaf', async () => {
    const d = head([
      { tag: 'Group', id: 'empty', x: 0, y: 0, width: 1300, height: 400, title: { text: 'E' } },
      { tag: 'Group', id: 'g', x: 0, y: 0, title: { text: 'G' } },
      { tag: 'Shape', id: 'a', x: 0, y: 0, width: 220, height: 96, containerId: 'g' },
    ]);
    const out = await autoLayout(d, sized(d));
    expect(out.entities.find((e) => e.id === 'empty')!.height).toBeLessThan(200);
  });
});
