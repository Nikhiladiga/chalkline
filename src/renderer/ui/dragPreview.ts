import type { Doc } from '../engine/types';

export interface Preview {
  /** Entities that move: the dragged roots and all their descendants. */
  moving: Set<string>;
  dx: number;
  dy: number;
  /** Alt-drag: the originals stay put and translucent copies move. */
  copy: boolean;
}

export interface PreviewTarget {
  /** The mounted `#eraser-scene`. */
  scene: HTMLElement;
  /** The canvas overlay with the `.hit[data-id]` boxes. */
  overlay: HTMLElement | null;
  /** An empty overlay `<svg>` for provisional connection lines. */
  lines: SVGSVGElement | null;
  doc: Doc;
  /** The render's connection id for each `doc.connections` index. */
  connectionIds: string[];
  geometry: Record<string, { points: [number, number][] } | undefined>;
  zoom: number;
}

const MARK = 'data-preview';
const CLONE = 'data-preview-clone';
const SVG = 'http://www.w3.org/2000/svg';

/** Undo every preview change: moved or hidden wrappers and hit boxes, clones and provisional lines. */
export function clearPreview(
  scene: HTMLElement | null,
  overlay: HTMLElement | null,
  lines: SVGSVGElement | null,
): void {
  for (const root of [scene, overlay]) {
    if (!root) continue;
    for (const el of root.querySelectorAll(`[${CLONE}]`)) el.remove();
    for (const el of root.querySelectorAll<HTMLElement>(`[${MARK}]`)) {
      el.style.transform = '';
      el.style.visibility = '';
      el.removeAttribute(MARK);
    }
  }
  lines?.replaceChildren();
}

/**
 * Show a drag without rendering (the engine render is what made large diagrams lag): translate the moving
 * entities' scene wrappers and hit boxes, carry connections whose ends both move, and swap connections with
 * one moving end for straight provisional lines. In copy mode the originals stay and clones move instead.
 */
export function showPreview(t: PreviewTarget, p: Preview): void {
  clearPreview(t.scene, t.overlay, t.lines);
  const move = `translate(${p.dx}px, ${p.dy}px)`;
  const carried = new Set<string>();
  const cut: { id: string; fromMoves: boolean }[] = [];
  t.doc.connections.forEach((c, i) => {
    const id = t.connectionIds[i];
    const a = p.moving.has(c.from);
    const b = p.moving.has(c.to);
    if (!id) return;
    if (a && b) carried.add(id);
    else if (a || b) cut.push({ id, fromMoves: a });
  });
  const cutIds = new Set(cut.map((c) => c.id));
  for (const w of t.scene.querySelectorAll<HTMLElement>('[data-mdp-id]')) {
    const id = w.dataset.mdpId!;
    if (p.moving.has(id) || carried.has(id)) {
      if (p.copy) {
        const clone = w.cloneNode(true) as HTMLElement;
        clone.removeAttribute('data-mdp-id');
        clone.setAttribute(CLONE, '');
        clone.style.transform = move;
        clone.style.opacity = '0.6';
        clone.style.pointerEvents = 'none';
        t.scene.append(clone);
      } else {
        w.style.transform = move;
        w.setAttribute(MARK, '');
      }
    } else if (!p.copy && cutIds.has(id)) {
      w.style.visibility = 'hidden';
      w.setAttribute(MARK, '');
    }
  }
  if (p.copy) return;
  for (const h of t.overlay?.querySelectorAll<HTMLElement>('.hit[data-id]') ?? []) {
    if (!p.moving.has(h.dataset.id!)) continue;
    h.style.transform = move;
    h.setAttribute(MARK, '');
  }
  for (const { id, fromMoves } of cut) {
    const pts = t.geometry[id]?.points;
    if (!t.lines || !pts || pts.length < 2) continue;
    const [a, b] = [pts[0]!, pts.at(-1)!];
    const line = document.createElementNS(SVG, 'line');
    line.setAttribute('class', 'preview-line');
    line.setAttribute('data-conn-id', id);
    line.setAttribute('x1', String(a[0] + (fromMoves ? p.dx : 0)));
    line.setAttribute('y1', String(a[1] + (fromMoves ? p.dy : 0)));
    line.setAttribute('x2', String(b[0] + (fromMoves ? 0 : p.dx)));
    line.setAttribute('y2', String(b[1] + (fromMoves ? 0 : p.dy)));
    line.setAttribute('stroke-width', String(2 / t.zoom));
    t.lines.append(line);
  }
}
