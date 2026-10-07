import type { Box, Doc } from '../engine/types';

/** Edit mode: existing ids keep their previous x/y unless the user allows the model to move them. */
export function mergePositions(prev: Doc, next: Doc, allowMove: boolean): Doc {
  if (allowMove) return next;
  const old = new Map(prev.entities.map((e) => [e.id, e]));
  return {
    ...next,
    entities: next.entities.map((e) => {
      const p = old.get(e.id);
      return p ? { ...e, x: p.x, y: p.y } : e;
    }),
  };
}

const hit = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const GAP = 60;

/**
 * Move each overlapping new entity to the nearest free slot beside its first connected neighbor.
 * `boxes` are painted footprints (an icon plus its caption), so moves are applied as deltas.
 */
export function placeNew(doc: Doc, boxes: Record<string, Box>, newIds: string[]): Doc {
  const out = structuredClone(doc);
  const live = { ...boxes };
  for (const id of newIds) {
    const e = out.entities.find((x) => x.id === id);
    const box = live[id];
    if (!e || !box) continue;
    const siblings = out.entities.filter(
      (o) => o.id !== id && (o.containerId ?? null) === (e.containerId ?? null) && live[o.id],
    );
    const blocked = (b: Box) => siblings.some((o) => hit(b, live[o.id]!));
    if (!blocked(box)) continue;
    const link = out.connections.find((c) => (c.from === id && live[c.to]) || (c.to === id && live[c.from]));
    const nb = link ? live[link.from === id ? link.to : link.from]! : undefined;
    const right = Math.max(...siblings.map((o) => live[o.id]!.x + live[o.id]!.width));
    const slot = nb
      ? { ...box, x: nb.x + nb.width + GAP, y: nb.y }
      : { ...box, x: right + GAP, y: Math.min(...siblings.map((o) => live[o.id]!.y)) };
    for (let i = 0; i < 50 && blocked(slot); i++) slot.y += box.height + 40;
    e.x = Math.round(e.x + slot.x - box.x);
    e.y = Math.round(e.y + slot.y - box.y);
    live[id] = slot;
  }
  return out;
}

/** Grow containers (never shrink or move them) so every child box fits with padding. */
export function fitContainers(doc: Doc, boxes: Record<string, Box>, pad = 32): Doc {
  const out = structuredClone(doc);
  const live = { ...boxes };
  const byId = new Map(out.entities.map((e) => [e.id, e]));
  const depth = (id: string): number => {
    let d = 0;
    for (let cur = byId.get(id)?.containerId; cur && d < 50; cur = byId.get(cur)?.containerId) d++;
    return d;
  };
  // Innermost containers first, so a grown child group then grows its parent.
  const containers = out.entities
    .filter((c) => out.entities.some((k) => k.containerId === c.id))
    .sort((a, b) => depth(b.id) - depth(a.id));
  for (const c of containers) {
    const cb = live[c.id];
    const kids = out.entities.filter((k) => k.containerId === c.id && live[k.id]);
    if (!cb || !kids.length) continue;
    const right = Math.max(...kids.map((k) => live[k.id]!.x + live[k.id]!.width)) + pad;
    const bottom = Math.max(...kids.map((k) => live[k.id]!.y + live[k.id]!.height)) + pad;
    if (right > cb.x + cb.width) c.width = Math.round(right - c.x);
    if (bottom > cb.y + cb.height) c.height = Math.round(bottom - c.y);
    live[c.id] = {
      ...cb,
      width: Math.max(cb.width, (c.width as number) ?? 0),
      height: Math.max(cb.height, (c.height as number) ?? 0),
    };
  }
  return out;
}
