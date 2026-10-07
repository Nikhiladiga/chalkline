import {
  type Direction,
  type LayoutConnection,
  LayoutManager,
  routeCorridorConnectionBatch,
} from '@eraserlabs/layout';
import type { ResolvedConnection, ResolvedEntity } from '@eraserlabs/protocol';
import type { SceneLayout } from '@eraserlabs/render';
import { isPort, PORT_POSITIONS, type Port, portPoint } from './ports';
import type { Box } from './types';

const center = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
function face(port: Port, box: Box, other: Box): Direction {
  if (port === 'top') return 'up';
  if (port === 'bottom') return 'down';
  if (port === 'left' || port === 'right') return port;
  const a = portPoint(box, port);
  const b = center(other);
  return Math.abs(b.x - a.x) > Math.abs(b.y - a.y)
    ? port.includes('left')
      ? 'left'
      : 'right'
    : port.includes('top')
      ? 'up'
      : 'down';
}

/** Route explicit anchors with the existing corridor router, then pin its geometry for painting. */
export function routeAnchors(
  entities: ResolvedEntity[],
  connections: ResolvedConnection[],
  layout: SceneLayout,
): ResolvedConnection[] {
  const anchored = connections.filter(
    (c) => c.tag === 'Relationship' && isPort(c.props.fromPort) && isPort(c.props.toPort),
  );
  if (!anchored.length) return connections;
  const manager = new LayoutManager({
    entities: entities.flatMap((e) => {
      const b = layout.boxes[e.id];
      return b ? [{ ...b, id: e.id, containerId: e.containerId, isContainer: e.isContainer }] : [];
    }),
    connections: connections.map((c) => {
      const points = layout.connections[c.id]?.points ?? [];
      const [x, y] = points[0] ?? [0, 0];
      return {
        id: c.id,
        from: c.props.from,
        to: c.props.to,
        x,
        y,
        points: points.map(([px, py]) => [px - x, py - y] as [number, number]),
      };
    }),
  });
  const routed: LayoutConnection[] = [];
  for (const c of anchored) {
    const a = layout.boxes[c.props.from];
    const b = layout.boxes[c.props.to];
    if (!a || !b) continue;
    const from = c.props.fromPort as Port;
    const to = c.props.toPort as Port;
    if (c.props.connectorStyle === 'straight') {
      const start = portPoint(a, from);
      const end = portPoint(b, to);
      const existing = layout.connections[c.id]?.points ?? [];
      const first = existing[0];
      const last = existing.at(-1);
      const keepAuthored =
        Array.isArray(c.props.points) &&
        existing.length >= 2 &&
        first?.[0] === start.x &&
        first[1] === start.y &&
        last?.[0] === end.x &&
        last[1] === end.y;
      manager.updateConnection(c.id, {
        x: start.x,
        y: start.y,
        points: keepAuthored
          ? existing.map(([x, y]) => [x - start.x, y - start.y] as [number, number])
          : [
              [0, 0],
              [end.x - start.x, end.y - start.y],
            ],
        ...(layout.connections[c.id]?.labelBox ? { textPlacement: layout.connections[c.id]!.labelBox } : {}),
      });
      continue;
    }
    const geo = layout.connections[c.id];
    routed.push({
      id: c.id,
      from: c.props.from,
      to: c.props.to,
      x: 0,
      y: 0,
      points: [],
      relativeFromPort: PORT_POSITIONS[from],
      relativeToPort: PORT_POSITIONS[to],
      authoredFromFace: face(from, a, b),
      authoredToFace: face(to, b, a),
      fromArrowhead: Boolean(c.props.startArrowhead),
      toArrowhead: Boolean(c.props.endArrowhead),
      ...(geo?.labelBox ? { textPlacement: geo.labelBox } : {}),
    });
  }
  if (routed.length)
    routeCorridorConnectionBatch({
      layoutManager: manager,
      connectionsToRoute: routed,
      options: { repair: true, labels: true, preservePorts: true, pinUnaffectedRoutes: true },
    });
  const fixed = new Set(anchored.map((c) => c.id));
  return connections.map((c) => {
    if (!fixed.has(c.id)) return c;
    const result = manager.getConnectionById(c.id);
    if (!result?.points.length) return c;
    const label = result.textPlacement;
    return {
      ...c,
      x: result.x,
      y: result.y,
      props: {
        ...c.props,
        connectorStyle: 'straight',
        points: result.points.map(([x, y]) => ({ x, y })),
        ...(label
          ? {
              labelPlacement: {
                x: label.x - result.x,
                y: label.y - result.y,
                width: label.width,
                height: label.height,
              },
            }
          : {}),
      },
    };
  });
}
