import { describe, expect, it } from 'vitest';
import { toDiagramJson } from './measured';

const layout = {
  boxes: { a: { x: 10, y: 20, width: 100, height: 50 } },
  connections: {
    c1: {
      d: 'M0 0',
      points: [
        [110, 45],
        [200, 45],
      ] as [number, number][],
      label: { x: 150, y: 45 },
      labelBox: { x: 140.4, y: 37.6, width: 20.2, height: 16 },
    },
  },
  scene: { x: 0, y: 0, width: 300, height: 100 },
};

describe('toDiagramJson', () => {
  it('overlays the measured box on entities', () => {
    const out = toDiagramJson(
      [{ id: 'a', kind: 'entity', source: { tag: 'Shape', id: 'a', x: 1, y: 2 } }],
      layout,
    );
    expect(out.entities[0]).toEqual({ tag: 'Shape', id: 'a', x: 10, y: 20, width: 100, height: 50 });
  });

  it('writes connection points relative to the first point and rounds the label box', () => {
    const out = toDiagramJson([{ id: 'c1', kind: 'connection', source: { from: 'a', to: 'b' } }], layout);
    expect(out.connections[0]).toEqual({
      from: 'a',
      to: 'b',
      x: 110,
      y: 45,
      points: [
        { x: 0, y: 0 },
        { x: 90, y: 0 },
      ],
      labelPlacement: { x: 30, y: -7, width: 20, height: 16 },
    });
  });

  it('leaves unmeasured elements exactly as authored', () => {
    const source = { tag: 'Shape', id: 'z', x: 5, y: 5 };
    const out = toDiagramJson([{ id: 'z', kind: 'entity', source }], layout);
    expect(out.entities[0]).toEqual(source);
    expect(out.entities[0]).not.toBe(source);
  });
});
