import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { Box, Doc, Entity } from '../engine/types';

const elk = new ELK();
const TITLE_PAD = 56;
const DEFAULT = { width: 120, height: 60 };
const ANNOTATIONS = new Set(['Textbox', 'Legend']);
const CONTAINER_TAGS = new Set(['Group', 'Lane', 'Pool']);
const MARGIN = 40;
// Lines between tiers carry labels such as "2 · consume": leave them room.
const TIER_GAP = 90;

// ELK applies layout options per graph level, so containers need them too (else 20px defaults).
const SPACING = {
  'elk.spacing.nodeNode': '60',
  'elk.layered.spacing.nodeNodeBetweenLayers': '100',
  'elk.spacing.edgeNode': '30',
};
const CONTAINER_OPTIONS = {
  ...SPACING,
  'elk.padding': `[top=${TITLE_PAD},left=40,bottom=40,right=40]`,
};
// Deep scans: every group is its own left-to-right layered graph (edges lifted to it, see
// `lifted`), so sibling groups line up as columns instead of drifting to straighten one edge.
// Tighter rows (fan-outs stack), longer runs between layers for edge labels; edgeless siblings
// form one column rather than a packed grid.
const DEEP_OPTIONS = {
  ...SPACING,
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.spacing.nodeNode': '40',
  'elk.layered.spacing.nodeNodeBetweenLayers': '160',
  'elk.separateConnectedComponents': 'false',
  'elk.layered.nodePlacement.strategy': 'LINEAR_SEGMENTS',
};
const LAYER = 'elk.layered.layering.layerConstraint';
const ROOT = '__root';

interface Placed {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

/**
 * ELK layered layout over the containment tree; writes absolute integer x/y back into the doc.
 * `boxes` should be painted footprints (RenderOk.painted) so captions get room.
 * With 2+ top-level groups the diagram is treated as tiers: each group is laid out on its own
 * and the groups are stacked full-width under the title, legend top-right.
 * `deep` (code-folder deep scans): one left-to-right flow, sources (clients, schedulers) first,
 * sinks outside service groups (stores, external APIs) in a right-hand column, root text notes
 * below the diagram instead of a title on top.
 */
export async function autoLayout(
  doc: Doc,
  boxes: Record<string, Box>,
  { deep = false }: { deep?: boolean } = {},
): Promise<Doc> {
  const ids = new Set(doc.entities.map((e) => e.id));
  const byId = new Map(doc.entities.map((e) => [e.id, e]));
  const isRoot = (e: Entity) => !e.containerId || !ids.has(e.containerId);
  // Container tags count even when empty, so an empty group gets ELK-sized, not kept huge.
  const containers = new Set([
    ...doc.entities.map((e) => e.containerId).filter((c): c is string => !!c && ids.has(c)),
    ...doc.entities.filter((e) => CONTAINER_TAGS.has(e.tag)).map((e) => e.id),
  ]);
  // Each connection, as an edge between the two children of the endpoints' nearest common
  // container (or the root) that hold them; deduplicated. Edges inside one child are skipped.
  const chain = (id: string) => {
    const out = [id];
    for (let p = byId.get(id)?.containerId; p && ids.has(p); p = byId.get(p)?.containerId) out.push(p);
    return [...out, ROOT];
  };
  const liftedBy = new Map<string, Map<string, { id: string; sources: string[]; targets: string[] }>>();
  for (const c of doc.connections) {
    if (!ids.has(c.from) || !ids.has(c.to)) continue;
    const a = chain(c.from);
    const b = chain(c.to);
    const lca = a.find((x) => b.includes(x))!;
    const s = a[a.indexOf(lca) - 1];
    const t = b[b.indexOf(lca) - 1];
    if (!s || !t) continue;
    const level = liftedBy.get(lca) ?? new Map();
    if (!level.has(`${s}>${t}`))
      level.set(`${s}>${t}`, { id: `e${level.size}-${lca}`, sources: [s], targets: [t] });
    liftedBy.set(lca, level);
  }
  const lifted = (id: string) => [...(liftedBy.get(id)?.values() ?? [])];

  // Deep: sinks outside service groups (groups holding no groups) — stores, external APIs —
  // go in the last layer; anything with no incoming edge at its own level goes first.
  const layer = new Map<string, string>();
  if (deep) {
    const service = new Set(
      [...containers].filter((c) => !doc.entities.some((e) => e.containerId === c && containers.has(e.id))),
    );
    const fed = new Set([...liftedBy.values()].flatMap((l) => [...l.values()].map((e) => e.targets[0])));
    for (const e of doc.entities) {
      if (ANNOTATIONS.has(e.tag)) continue;
      const sink =
        !containers.has(e.id) &&
        !(e.containerId && service.has(e.containerId)) &&
        doc.connections.some((c) => c.to === e.id) &&
        !doc.connections.some((c) => c.from === e.id);
      if (sink) layer.set(e.id, 'LAST');
      else if (!fed.has(e.id)) layer.set(e.id, 'FIRST');
    }
  }
  // Footprint → glyph offset: a caption wider than its icon starts left of the icon's x.
  const pad = new Map<string, { dx: number; dy: number }>();

  const node = (id: string): ElkNode => {
    if (containers.has(id)) {
      return {
        id,
        children: doc.entities.filter((e) => e.containerId === id).map((e) => node(e.id)),
        ...(deep
          ? {
              layoutOptions: {
                ...CONTAINER_OPTIONS,
                ...DEEP_OPTIONS,
                ...(layer.has(id) ? { [LAYER]: layer.get(id)! } : {}),
              },
              edges: lifted(id),
            }
          : { layoutOptions: CONTAINER_OPTIONS }),
      };
    }
    const b = boxes[id];
    const e = byId.get(id);
    if (b && e) pad.set(id, { dx: (e.x ?? b.x) - b.x, dy: (e.y ?? b.y) - b.y });
    const at = layer.get(id);
    return {
      id,
      width: (b ?? DEFAULT).width,
      height: (b ?? DEFAULT).height,
      ...(at ? { layoutOptions: { [LAYER]: at } } : {}),
    };
  };

  const within = (members: Set<string>) =>
    doc.connections
      .filter((c) => members.has(c.from) && members.has(c.to))
      .map((c, i) => ({ id: `e${i}`, sources: [c.from], targets: [c.to] }));

  const subtree = (id: string): Set<string> => {
    const out = new Set([id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const e of doc.entities) {
        if (e.containerId && out.has(e.containerId) && !out.has(e.id)) {
          out.add(e.id);
          grew = true;
        }
      }
    }
    return out;
  };

  /** Lay out a graph and collect positions relative to (ox, oy). */
  const run = async (graph: ElkNode, ox: number, oy: number, pos: Map<string, Placed>) => {
    const laid = await elk.layout(graph);
    const walk = (n: ElkNode, x0: number, y0: number) => {
      for (const c of n.children ?? []) {
        const x = x0 + (c.x ?? 0);
        const y = y0 + (c.y ?? 0);
        pos.set(c.id, { x, y, ...(containers.has(c.id) ? { width: c.width, height: c.height } : {}) });
        walk(c, x, y);
      }
    };
    walk(laid, ox, oy);
    return laid;
  };

  const rootOptions = {
    'elk.algorithm': 'layered',
    'elk.direction': 'RIGHT',
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    ...SPACING,
  };
  const pos = new Map<string, Placed>();
  const roots = doc.entities.filter(isRoot);
  const tiers = roots.filter((e) => containers.has(e.id));
  const notes = roots.filter((e) => ANNOTATIONS.has(e.tag));
  // The diagram title (first root Textbox) and legend form a header row above everything else.
  // A deep scan's root Textbox is its source note: it goes below the diagram.
  const title = deep ? undefined : notes.find((e) => e.tag === 'Textbox');
  const below = deep ? notes.filter((e) => e.tag === 'Textbox') : [];
  const legend = notes.find((e) => e.tag === 'Legend');
  const headH = Math.max(
    title ? (boxes[title.id]?.height ?? 40) : 0,
    legend ? (boxes[legend.id]?.height ?? 60) : 0,
  );
  const top = headH ? MARGIN / 2 + headH + MARGIN : MARGIN;
  let W = 0;

  if (tiers.length >= 2 && !deep) {
    const loose = roots.filter((e) => !containers.has(e.id) && !ANNOTATIONS.has(e.tag));
    // Each tier (and any loose root nodes, as one row) is its own layered graph.
    const rows: { members: Set<string>; graph: ElkNode; group?: string }[] = [];
    if (loose.length) {
      const members = new Set(loose.map((e) => e.id));
      rows.push({
        members,
        graph: {
          id: '__loose',
          layoutOptions: { ...rootOptions, 'elk.padding': '[top=0,left=0,bottom=0,right=0]' },
          children: loose.map((e) => node(e.id)),
          edges: within(members),
        },
      });
    }
    for (const t of tiers) {
      const members = subtree(t.id);
      // ELK stacks edge-less nodes in one layer (a column). Chain the tier's unconnected direct
      // children with invisible edges, in document order, so they form a row instead.
      const edges = within(members);
      const linked = new Set(edges.flatMap((e) => [...e.sources, ...e.targets]));
      const lone = doc.entities.filter((e) => e.containerId === t.id && !linked.has(e.id)).map((e) => e.id);
      for (let i = 1; i < lone.length; i++) {
        edges.push({ id: `__chain-${t.id}-${i}`, sources: [lone[i - 1]!], targets: [lone[i]!] });
      }
      rows.push({
        members,
        group: t.id,
        graph: {
          id: `__tier-${t.id}`,
          layoutOptions: { ...rootOptions, 'elk.padding': '[top=0,left=0,bottom=0,right=0]' },
          children: [node(t.id)],
          edges,
        },
      });
    }
    let y = top;
    const laid: {
      row: (typeof rows)[number];
      w: number;
      h: number;
      y: number;
      local: Map<string, Placed>;
    }[] = [];
    for (const row of rows) {
      const local = new Map<string, Placed>();
      const g = await run(row.graph, 0, 0, local);
      laid.push({ row, w: g.width ?? 0, h: g.height ?? 0, y, local });
      y += (g.height ?? 0) + TIER_GAP;
    }
    W = Math.max(...laid.map((l) => l.w));
    for (const l of laid) {
      for (const [id, p] of l.local) pos.set(id, { ...p, x: p.x + MARGIN, y: p.y + l.y });
      if (l.row.group) pos.set(l.row.group, { ...pos.get(l.row.group)!, width: W });
    }
    // Remaining annotations go under the last tier.
    for (const n of notes.filter((e) => e !== title && e !== legend)) {
      pos.set(n.id, { x: MARGIN, y });
      y += (boxes[n.id]?.height ?? 40) + TIER_GAP;
    }
  } else {
    const body = roots.filter((e) => e !== title && e !== legend && !below.includes(e));
    const inBody = new Set(body.map((e) => e.id));
    const laid = await run(
      {
        id: ROOT,
        layoutOptions: {
          ...(deep ? DEEP_OPTIONS : rootOptions),
          'elk.padding': `[top=${top},left=${MARGIN},bottom=${MARGIN},right=${MARGIN}]`,
        },
        children: body.map((e) => node(e.id)),
        edges: deep
          ? lifted(ROOT).filter((e) => inBody.has(e.sources[0]!) && inBody.has(e.targets[0]!))
          : within(ids),
      },
      0,
      0,
      pos,
    );
    W = (laid.width ?? 0) - 2 * MARGIN;
    let y = laid.height ?? 0;
    for (const n of below) {
      pos.set(n.id, { x: MARGIN, y });
      y += (boxes[n.id]?.height ?? 40) + MARGIN;
    }
  }
  if (title) pos.set(title.id, { x: MARGIN, y: MARGIN / 2 });
  if (legend) {
    const titleRight = title ? MARGIN + (boxes[title.id]?.width ?? 0) + MARGIN : MARGIN;
    pos.set(legend.id, {
      x: Math.max(titleRight, MARGIN + W - (boxes[legend.id]?.width ?? 180)),
      y: MARGIN / 2,
    });
  }

  const out = structuredClone(doc);
  for (const e of out.entities) {
    const p = pos.get(e.id);
    if (!p) continue;
    const off = pad.get(e.id) ?? { dx: 0, dy: 0 };
    e.x = Math.max(0, Math.round(p.x + off.dx));
    e.y = Math.max(0, Math.round(p.y + off.dy));
    if (p.width !== undefined) e.width = Math.round(p.width);
    if (p.height !== undefined) e.height = Math.round(p.height);
  }
  for (const c of out.connections) {
    delete c.points;
    delete c.labelPlacement;
    delete c.x;
    delete c.y;
  }
  return out;
}
