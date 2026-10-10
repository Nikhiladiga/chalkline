import { fitContainers } from '../ai/merge';
import type { Port } from '../engine/ports';
import type { Box, Connection, Doc, Entity } from '../engine/types';

/** Stock container tags (resolver registry marks exactly these as containers). */
export const CONTAINER_TAGS = new Set(['Group', 'Lane', 'Pool']);
const ROUTE_KEYS = ['points', 'labelPlacement', 'x', 'y'] as const;

const clone = (doc: Doc): Doc => structuredClone(doc);

export function descendants(doc: Doc, id: string): string[] {
  const out: string[] = [];
  const walk = (parent: string) => {
    for (const e of doc.entities) {
      if (e.containerId === parent && !out.includes(e.id)) {
        out.push(e.id);
        walk(e.id);
      }
    }
  };
  walk(id);
  return out;
}

/** The ids plus every descendant, deduped. */
export function withDescendants(doc: Doc, ids: string[]): Set<string> {
  const set = new Set(ids);
  for (const id of ids) for (const d of descendants(doc, id)) set.add(d);
  return set;
}

/** The ids not inside another listed id: what a move or an align acts on (descendants follow). */
export function selectionRoots(doc: Doc, ids: string[]): string[] {
  // Walk each id's ancestors (O(n·depth)); runs per Inspector render, so per marquee move.
  const set = new Set(ids);
  const parent = new Map(doc.entities.map((e) => [e.id, e.containerId]));
  return ids.filter((x) => {
    // The step bound only matters for a (validator-rejected) containment cycle.
    for (let p = parent.get(x), d = 0; p && d < parent.size; p = parent.get(p), d++)
      if (p !== x && set.has(p)) return false;
    return true;
  });
}

/** Authored routes pin a connection's path; drop them so the router re-routes after a move. */
function dropRoutes(connections: Connection[], moved: Set<string>): void {
  for (const c of connections) {
    if (moved.has(c.from) || moved.has(c.to)) for (const k of ROUTE_KEYS) delete c[k];
  }
}

/** Limit a move so no moving entity (descendants included) crosses x/y = 0; rounds to integers. */
export function clampDelta(doc: Doc, ids: string[], dx: number, dy: number): { dx: number; dy: number } {
  const moving = doc.entities.filter((e) => withDescendants(doc, ids).has(e.id));
  if (!moving.length) return { dx: Math.round(dx), dy: Math.round(dy) };
  return {
    dx: Math.round(Math.max(dx, -Math.min(...moving.map((e) => e.x)))),
    dy: Math.round(Math.max(dy, -Math.min(...moving.map((e) => e.y)))),
  };
}

export function moveEntities(doc: Doc, ids: string[], rawDx: number, rawDy: number): Doc {
  const out = clone(doc);
  const moving = withDescendants(doc, ids);
  // One delta for the whole set, so children never drift relative to their container.
  const { dx, dy } = clampDelta(doc, ids, rawDx, rawDy);
  for (const e of out.entities) {
    if (!moving.has(e.id)) continue;
    e.x = Math.round(e.x) + dx;
    e.y = Math.round(e.y) + dy;
  }
  dropRoutes(out.connections, moving);
  return out;
}

/** Keep schema coordinates positive while allowing a drag past the document origin.
 * Subtract offset * zoom from the canvas pan to keep stationary entities in place. */
export function dragEntities(
  doc: Doc,
  ids: string[],
  rawDx: number,
  rawDy: number,
): { doc: Doc; offset: { x: number; y: number } } {
  const dx = Math.round(rawDx);
  const dy = Math.round(rawDy);
  const moving = withDescendants(doc, ids);
  const offset = {
    x: Math.max(0, ...doc.entities.map((e) => -(e.x + (moving.has(e.id) ? dx : 0)))),
    y: Math.max(0, ...doc.entities.map((e) => -(e.y + (moving.has(e.id) ? dy : 0)))),
  };
  const base =
    offset.x || offset.y
      ? moveEntities(
          doc,
          doc.entities.map((e) => e.id),
          offset.x,
          offset.y,
        )
      : doc;
  return { doc: moveEntities(base, ids, dx, dy), offset };
}

export function resizeEntity(doc: Doc, id: string, width: number, height: number): Doc {
  const out = clone(doc);
  const e = out.entities.find((x) => x.id === id);
  if (e) {
    e.width = Math.max(8, Math.round(width));
    e.height = Math.max(8, Math.round(height));
    dropRoutes(out.connections, new Set([id]));
  }
  return out;
}

export function deleteElements(doc: Doc, entityIds: string[], connectionIdx: number[]): Doc {
  const out = clone(doc);
  const gone = new Set(entityIds);
  const byId = new Map(out.entities.map((e) => [e.id, e]));
  for (const e of out.entities) {
    // Re-home orphans to the nearest surviving ancestor.
    let parent = e.containerId ?? undefined;
    while (parent && gone.has(parent)) parent = byId.get(parent)?.containerId ?? undefined;
    if (parent) e.containerId = parent;
    else delete e.containerId;
  }
  out.entities = out.entities.filter((e) => !gone.has(e.id));
  out.connections = out.connections.filter(
    (c, i) => !connectionIdx.includes(i) && !gone.has(c.from) && !gone.has(c.to),
  );
  return out;
}

export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'node'
  );
}

export function uniqueId(doc: Doc, base: string): string {
  const taken = new Set(doc.entities.map((e) => e.id));
  const root = slug(base);
  if (!taken.has(root)) return root;
  let n = 2;
  while (taken.has(`${root}-${n}`)) n++;
  return `${root}-${n}`;
}

export function addEntity(doc: Doc, e: Entity): Doc {
  const out = clone(doc);
  out.entities.push({ ...structuredClone(e), id: uniqueId(doc, e.id) });
  return out;
}

/** The selection as a standalone diagram: the entities with their descendants and the connections
 *  between them, without routes or connection ids (those belong to the source document). */
export function copyElements(doc: Doc, ids: string[]): Doc {
  const set = withDescendants(doc, ids);
  return {
    entities: doc.entities.filter((e) => set.has(e.id)).map((e) => structuredClone(e)),
    connections: doc.connections
      .filter((c) => set.has(c.from) && set.has(c.to))
      .map((c) => {
        const copy = structuredClone(c);
        for (const k of [...ROUTE_KEYS, 'id'] as const) delete copy[k];
        return copy;
      }),
  };
}

/**
 * Add a copied diagram with fresh ids, shifted by (dx, dy). A copied root keeps its container only when
 * `keepContainers` is set and that container exists in `doc`; connections whose ends were not copied are
 * dropped. Returns the new roots and the old -> new id map.
 */
export function pasteElements(
  doc: Doc,
  clip: Doc,
  dx: number,
  dy: number,
  keepContainers: boolean,
): { doc: Doc; newIds: string[]; idMap: Map<string, string> } {
  const out = clone(doc);
  const idMap = new Map<string, string>();
  const taken = new Set(doc.entities.map((e) => e.id)); // built once: uniqueId per entity is quadratic
  for (const e of clip.entities) {
    const root = slug(e.id);
    let id = root;
    for (let n = 2; taken.has(id); n++) id = `${root}-${n}`;
    taken.add(id);
    idMap.set(e.id, id);
    out.entities.push({ ...structuredClone(e), id, x: Math.round(e.x + dx), y: Math.round(e.y + dy) });
  }
  const here = new Set(doc.entities.map((e) => e.id));
  const newIds: string[] = [];
  for (const e of out.entities.slice(doc.entities.length)) {
    const parent = e.containerId ?? undefined;
    if (parent && idMap.has(parent)) {
      e.containerId = idMap.get(parent);
      continue;
    }
    newIds.push(e.id);
    if (!(keepContainers && parent && here.has(parent))) delete e.containerId;
  }
  for (const c of clip.connections) {
    const from = idMap.get(c.from);
    const to = idMap.get(c.to);
    if (!from || !to) continue;
    const copy = structuredClone(c); // foreign JSON may carry ids and routes of another document
    for (const k of [...ROUTE_KEYS, 'id'] as const) delete copy[k];
    out.connections.push({ ...copy, from, to });
  }
  return { doc: out, newIds, idMap };
}

export function duplicateEntities(doc: Doc, ids: string[], offset = 20): { doc: Doc; newIds: string[] } {
  return pasteElements(doc, copyElements(doc, ids), offset, offset, true);
}

export function connect(doc: Doc, from: string, to: string, ports?: { fromPort: Port; toPort: Port }): Doc {
  if (
    from === to ||
    doc.connections.some(
      (c) =>
        c.from === from &&
        c.to === to &&
        (!ports || (c.fromPort === ports.fromPort && c.toPort === ports.toPort)),
    )
  )
    return doc;
  const out = clone(doc);
  out.connections.push({ from, to, ...ports });
  return out;
}

/**
 * Move one end of connection `index` to entity `id`. Ports are set for both ends (`ports`) or removed from
 * both; stale routes go, id, label and style stay. Returns `doc` itself for a missing connection or target,
 * a self-link, no change, or a duplicate as `connect` sees one: the same pair with the same ports, or any
 * pinning of the pair when the result floats.
 */
export function reconnect(
  doc: Doc,
  index: number,
  end: 'from' | 'to',
  id: string,
  ports?: { fromPort: Port; toPort: Port },
): Doc {
  const c = doc.connections[index];
  if (!c || !doc.entities.some((e) => e.id === id)) return doc;
  const next: Connection = { ...structuredClone(c), [end]: id };
  delete next.fromPort;
  delete next.toPort;
  if (ports) Object.assign(next, ports);
  const same = (o: Connection, floats: boolean) =>
    o.from === next.from &&
    o.to === next.to &&
    (floats || (o.fromPort === next.fromPort && o.toPort === next.toPort));
  if (next.from === next.to || same(c, false)) return doc;
  if (doc.connections.some((o, i) => i !== index && same(o, !ports))) return doc;
  for (const k of ROUTE_KEYS) delete next[k];
  const out = clone(doc);
  out.connections[index] = next;
  return out;
}

/** Set connection `index`'s label, or remove it for blank text; a stale label box goes too.
 *  Returns `doc` itself when nothing changes. */
export function setConnectionLabel(doc: Doc, index: number, text: string): Doc {
  const c = doc.connections[index];
  const label = text.trim();
  if (!c || String(c.label ?? '') === label) return doc;
  const out = clone(doc);
  const next = out.connections[index]!;
  if (label) next.label = label;
  else delete next.label;
  delete next.labelPlacement;
  return out;
}

const center = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const contains = (b: Box, p: { x: number; y: number }) =>
  p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;

/** Put `id` into the smallest container whose box holds its center (or the root). */
export function reparent(doc: Doc, id: string, boxes: Record<string, Box>): Doc {
  const box = boxes[id];
  if (!box) return doc;
  const banned = withDescendants(doc, [id]);
  const p = center(box);
  let best: { id: string; area: number } | undefined;
  for (const e of doc.entities) {
    const b = boxes[e.id];
    if (!CONTAINER_TAGS.has(e.tag) || banned.has(e.id) || !b || !contains(b, p)) continue;
    const area = b.width * b.height;
    if (!best || area < best.area) best = { id: e.id, area };
  }
  const current = doc.entities.find((e) => e.id === id)?.containerId ?? undefined;
  if (current === best?.id) return doc;
  const out = clone(doc);
  const e = out.entities.find((x) => x.id === id)!;
  if (best) e.containerId = best.id;
  else delete e.containerId;
  return out;
}

/**
 * What a drop does once its boxes have moved: each root joins the smallest container under its centre
 * (or the root), then containers grow to hold their children. `boxes` are where everything now is.
 */
export function settleMove(doc: Doc, roots: string[], boxes: Record<string, Box>): Doc {
  let out = doc;
  for (const id of roots) out = reparent(out, id, boxes);
  return fitContainers(out, boxes);
}

/** Insert a square icon centered at a canvas point, retaining valid document coordinates. */
export function insertIcon(
  doc: Doc,
  name: string,
  point: { x: number; y: number },
  boxes: Record<string, Box>,
) {
  const id = uniqueId(doc, name);
  const start = addEntity(doc, {
    tag: 'Icon',
    id,
    icon: name,
    x: 0,
    y: 0,
    texts: [{ text: name.replace(/-/g, ' ') }],
  });
  const moved = dragEntities(start, [id], point.x - 24, point.y - 24);
  const shifted = Object.fromEntries(
    Object.entries(boxes).map(([key, b]) => [
      key,
      {
        ...b,
        x: b.x + moved.offset.x,
        y: b.y + moved.offset.y,
      },
    ]),
  );
  const icon = moved.doc.entities.find((e) => e.id === id)!;
  shifted[id] = { x: icon.x, y: icon.y, width: 48, height: 48 };
  return { doc: reparent(moved.doc, id, shifted), id, offset: moved.offset, boxes: shifted };
}

type TextRun = { text: string; [k: string]: unknown };

/** Where each tag keeps its main text. Legend has only `entries`, so it has none. */
function textSlot(tag: string): 'title' | 'text' | 'label' | 'texts' | null {
  if (CONTAINER_TAGS.has(tag)) return 'title';
  if (tag === 'Textbox') return 'text';
  if (tag === 'DatabaseTable' || tag === 'Divider') return 'label';
  if (tag === 'Legend') return null;
  return 'texts';
}

export function getPrimaryText(e: Entity): string {
  const slot = textSlot(e.tag);
  if (slot === 'title') return (e.title as TextRun | undefined)?.text ?? '';
  if (slot === 'texts') return (e.texts as TextRun[] | undefined)?.[0]?.text ?? '';
  return slot ? ((e[slot] as string) ?? '') : '';
}

export function setPrimaryText(doc: Doc, id: string, text: string): Doc {
  const found = doc.entities.find((x) => x.id === id);
  const slot = found && textSlot(found.tag);
  if (!slot) return doc;
  const out = clone(doc);
  const e = out.entities.find((x) => x.id === id)!;
  if (slot === 'title') e.title = { ...((e.title as object) ?? {}), text };
  else if (slot === 'texts') {
    const runs = (e.texts as TextRun[] | undefined) ?? [];
    e.texts = runs.length ? [{ ...runs[0], text }, ...runs.slice(1)] : [{ text }];
  } else e[slot] = text;
  return out;
}

export function setProp(
  doc: Doc,
  ref: { entity?: string; connection?: number },
  key: string,
  value: unknown,
): Doc {
  const out = clone(doc);
  const target: Record<string, unknown> | undefined =
    ref.entity !== undefined
      ? out.entities.find((e) => e.id === ref.entity)
      : out.connections[ref.connection ?? -1];
  if (!target) return doc;
  if (value === undefined || value === '') delete target[key];
  else target[key] = value;
  return out;
}

/** Snap a moving box to other boxes' edges/centers. Returns the correction and guide lines. */
export function snap(
  moving: Box,
  others: Box[],
  threshold = 6,
): { dx: number; dy: number; guides: { x?: number; y?: number }[] } {
  const xs = (b: Box) => [b.x, b.x + b.width / 2, b.x + b.width];
  const ys = (b: Box) => [b.y, b.y + b.height / 2, b.y + b.height];
  const best = (mine: number[], pick: (b: Box) => number[]) => {
    let hit: { d: number; at: number } | undefined;
    for (const o of others)
      for (const at of pick(o))
        for (const m of mine) {
          const d = at - m;
          if (Math.abs(d) <= threshold && (!hit || Math.abs(d) < Math.abs(hit.d))) hit = { d, at };
        }
    return hit;
  };
  const hx = best(xs(moving), xs);
  const hy = best(ys(moving), ys);
  const guides: { x?: number; y?: number }[] = [];
  if (hx) guides.push({ x: hx.at });
  if (hy) guides.push({ y: hy.at });
  return { dx: hx?.d ?? 0, dy: hy?.d ?? 0, guides };
}

export type Align = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** Selection roots with their boxes: document x/y (never stale) and rendered width/height. */
function rootBoxes(doc: Doc, ids: string[], boxes: Record<string, Box>): { id: string; b: Box }[] {
  return selectionRoots(doc, ids).flatMap((id) => {
    const e = doc.entities.find((x) => x.id === id);
    const s = boxes[id];
    return e && s ? [{ id, b: { x: e.x, y: e.y, width: s.width, height: s.height } }] : [];
  });
}

/**
 * Move each root by its own delta; containers grow to hold moved children, as on a drop, but grouping
 * never changes (draw.io). `doc` itself when nothing moves.
 */
function moveEach(
  doc: Doc,
  moves: { id: string; dx: number; dy: number }[],
  boxes: Record<string, Box>,
): Doc {
  let out = doc;
  for (const { id, dx, dy } of moves)
    if (Math.round(dx) || Math.round(dy)) out = moveEntities(out, [id], dx, dy);
  if (out === doc) return doc;
  const was = new Map(doc.entities.map((e) => [e.id, e]));
  const now = new Map(out.entities.map((e) => [e.id, e]));
  const moved = Object.fromEntries(
    Object.entries(boxes).map(([id, b]) => {
      const e0 = was.get(id);
      const e1 = now.get(id);
      return [id, e0 && e1 ? { ...b, x: b.x + e1.x - e0.x, y: b.y + e1.y - e0.y } : b];
    }),
  );
  return settleMove(out, [], moved);
}

/**
 * Line up the selection roots' edges or centres with the selection's bounding box (draw.io Arrange ›
 * Align). Coordinates are absolute, so roots in different containers align too. Needs two roots.
 */
export function alignEntities(doc: Doc, ids: string[], boxes: Record<string, Box>, how: Align): Doc {
  const items = rootBoxes(doc, ids, boxes);
  if (items.length < 2) return doc;
  const left = Math.min(...items.map(({ b }) => b.x));
  const right = Math.max(...items.map(({ b }) => b.x + b.width));
  const top = Math.min(...items.map(({ b }) => b.y));
  const bottom = Math.max(...items.map(({ b }) => b.y + b.height));
  // The line every root's edge or centre goes to, and where that line sits on the root (0 left/top, 1 right/bottom).
  const line = { left, center: (left + right) / 2, right, top, middle: (top + bottom) / 2, bottom }[how];
  const f = { left: 0, center: 0.5, right: 1, top: 0, middle: 0.5, bottom: 1 }[how];
  const across = how === 'left' || how === 'center' || how === 'right';
  return moveEach(
    doc,
    items.map(({ id, b }) => ({
      id,
      dx: across ? line - f * b.width - b.x : 0,
      dy: across ? 0 : line - f * b.height - b.y,
    })),
    boxes,
  );
}

/** Equal gaps between the selection roots along one axis; the first and last stay put. Needs three. */
export function distributeEntities(
  doc: Doc,
  ids: string[],
  boxes: Record<string, Box>,
  axis: 'x' | 'y',
): Doc {
  const len = axis === 'x' ? 'width' : 'height';
  const items = rootBoxes(doc, ids, boxes).sort((p, q) => p.b[axis] - q.b[axis]);
  if (items.length < 3) return doc;
  const first = items[0]!.b;
  const last = items.at(-1)!.b;
  const total = items.reduce((sum, { b }) => sum + b[len], 0);
  const gap = (last[axis] + last[len] - first[axis] - total) / (items.length - 1);
  let at = first[axis];
  const moves = items.map(({ id, b }) => {
    const d = at - b[axis];
    at += b[len] + gap;
    return { id, dx: axis === 'x' ? d : 0, dy: axis === 'y' ? d : 0 };
  });
  return moveEach(doc, moves, boxes);
}
