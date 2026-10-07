import type { Box, Doc } from '../engine/types';

const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (c: Box, p: Box, slack = 1) =>
  c.x >= p.x - slack &&
  c.y >= p.y - slack &&
  c.x + c.width <= p.x + p.width + slack &&
  c.y + c.height <= p.y + p.height + slack;

/** Sibling overlaps (same containerId) and children outside their container, from measured boxes. */
export function checkLayout(
  doc: Doc,
  boxes: Record<string, Box>,
): { overlaps: [string, string][]; outside: string[] } {
  const overlaps: [string, string][] = [];
  const outside: string[] = [];
  const list = doc.entities.filter((e) => boxes[e.id]);
  for (let i = 0; i < list.length; i++) {
    const a = list[i]!;
    const parent = a.containerId ? boxes[a.containerId] : undefined;
    if (parent && !inside(boxes[a.id]!, parent)) outside.push(a.id);
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j]!;
      if ((a.containerId ?? null) !== (b.containerId ?? null)) continue;
      if (intersects(boxes[a.id]!, boxes[b.id]!)) overlaps.push([a.id, b.id]);
    }
  }
  return { overlaps, outside };
}
