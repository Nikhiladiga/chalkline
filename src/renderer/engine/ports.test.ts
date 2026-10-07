import { createResolver } from '@eraserlabs/resolve';
import { describe, expect, it } from 'vitest';
import { routeAnchors } from './anchors';
import { diagramLibrary } from './library';
import { nearestPort, PORTS, portPoint } from './ports';

const boxes = {
  a: { x: 100, y: 100, width: 48, height: 48 },
  b: { x: 350, y: 220, width: 48, height: 48 },
  blocker: { x: 230, y: 130, width: 60, height: 100 },
};
const entities = Object.entries(boxes).map(([id, b]) => ({ tag: 'Icon', id, props: {}, ...b }));

describe('fixed connection ports', () => {
  it('preserves authored straight polylines when their endpoints match the ports', () => {
    const points: [number, number][] = [
      [148, 124],
      [200, 124],
      [200, 244],
      [350, 244],
    ];
    const [c] = routeAnchors(
      entities,
      [
        {
          tag: 'Relationship',
          id: 'c',
          x: 0,
          y: 0,
          props: {
            from: 'a',
            to: 'b',
            fromPort: 'right',
            toPort: 'left',
            connectorStyle: 'straight',
            points: points.map(([x, y]) => ({ x, y })),
          },
        },
      ],
      {
        boxes,
        scene: { x: 0, y: 0, width: 500, height: 400 },
        connections: { c: { points, d: '', label: { x: 200, y: 180 } } },
      },
    );
    expect((c!.props.points as { x: number; y: number }[]).map((p) => [c!.x! + p.x, c!.y! + p.y])).toEqual(
      points,
    );
  });

  it('keeps a manually placed straight-line label at its absolute position', () => {
    const [c] = routeAnchors(
      entities,
      [
        {
          tag: 'Relationship',
          id: 'c',
          x: 0,
          y: 0,
          props: {
            from: 'a',
            to: 'b',
            fromPort: 'right',
            toPort: 'left',
            connectorStyle: 'straight',
            labelPlacement: { x: 220, y: 130, width: 60, height: 20 },
          },
        },
      ],
      {
        boxes,
        scene: { x: 0, y: 0, width: 500, height: 400 },
        connections: {
          c: {
            points: [
              [148, 124],
              [350, 244],
            ],
            d: '',
            label: { x: 250, y: 140 },
            labelBox: { x: 220, y: 130, width: 60, height: 20 },
          },
        },
      },
    );
    const placement = c!.props.labelPlacement as { x: number; y: number };
    expect({ x: c!.x! + placement.x, y: c!.y! + placement.y }).toEqual({ x: 220, y: 130 });
  });

  it('exposes four corners and four midpoints and snaps to the nearest point', () => {
    expect(PORTS).toHaveLength(8);
    expect(portPoint(boxes.a, 'top-left')).toEqual({ x: 100, y: 100 });
    expect(portPoint(boxes.a, 'right')).toEqual({ x: 148, y: 124 });
    expect(nearestPort(boxes.a, { x: 145, y: 101 })).toBe('top-right');
  });

  it('validates corner ports while keeping ordinary documents valid', async () => {
    const resolver = await createResolver({ library: diagramLibrary });
    const doc = {
      entities: [
        { tag: 'Shape', id: 'a', x: 100, y: 100 },
        { tag: 'Shape', id: 'b', x: 350, y: 220 },
      ],
      connections: [] as object[],
    };
    for (const port of PORTS) {
      doc.connections = [{ from: 'a', to: 'b', fromPort: port, toPort: port }];
      expect((await resolver.validate(doc)).ok).toBe(true);
    }
    expect((await resolver.validate({ ...doc, connections: [{ from: 'a', to: 'b' }] })).ok).toBe(true);
    expect(
      (await resolver.validate({ ...doc, connections: [{ from: 'a', to: 'b', fromPort: 'unknown' }] })).ok,
    ).toBe(false);
  });

  it('routes from each exact anchor, avoids other icon bodies, and follows changed boxes', () => {
    for (const port of PORTS) {
      const connections = [
        {
          tag: 'Relationship',
          id: 'c',
          props: { from: 'a', to: 'b', fromPort: port, toPort: 'bottom-left' },
        },
      ];
      const layout = {
        boxes,
        connections: {
          c: {
            points: [
              [148, 124],
              [350, 244],
            ] as [number, number][],
            d: '',
            label: { x: 249, y: 184 },
          },
        },
        scene: { x: 0, y: 0, width: 500, height: 400 },
      };
      const routed = routeAnchors(entities, connections, layout);
      const c = routed[0]!;
      const points = (c.props.points as { x: number; y: number }[]).map((p) => [c.x! + p.x, c.y! + p.y]);
      const from = portPoint(boxes.a, port);
      expect(points[0]).toEqual([from.x, from.y]);
      expect(points.at(-1)).toEqual([350, 268]);
      for (let i = 1; i < points.length; i++) {
        const [a, b] = [points[i - 1]!, points[i]!];
        expect(a[0] === b[0] || a[1] === b[1]).toBe(true);
        expect(
          Math.min(a[0]!, b[0]!) < 290 &&
            Math.max(a[0]!, b[0]!) > 230 &&
            Math.min(a[1]!, b[1]!) < 230 &&
            Math.max(a[1]!, b[1]!) > 130,
        ).toBe(false);
      }
      const changed = { ...boxes, a: { x: 60, y: 70, width: 80, height: 80 } };
      const next = routeAnchors(entities, connections, { ...layout, boxes: changed })[0]!;
      const expected = portPoint(changed.a, port);
      expect([next.x, next.y]).toEqual([expected.x, expected.y]);
    }
  });
});
