import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fitContainers } from '../ai/merge';
import {
  CONTAINER_TAGS,
  connect,
  copyElements,
  dragEntities,
  getPrimaryText,
  pasteElements,
  reconnect,
  reparent,
  resizeEntity,
  selectionRoots,
  setConnectionLabel,
  setPrimaryText,
  snap,
  withDescendants,
} from '../doc/ops';
import { docApi, tabState, useDoc, useTabs } from '../doc/store';
import { isPort, nearestPort, type Port, portPoint } from '../engine/ports';
import { groundOf } from '../engine/theme';
import { type Box, type Doc, SHEET_PAD } from '../engine/types';
import { insertIconAt } from './actions';
import { ConnectionPorts } from './ConnectionPorts';
import { clearPreview, showPreview } from './dragPreview';
import { ICON_MIME } from './iconCatalog';
import { IconMinus, IconPlus } from './icons';
import { isMac } from './platform';
import { easeView, type RenderInfo, requestFit, toast, useUi } from './uiStore';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; pan0: { x: number; y: number } }
  | {
      kind: 'move';
      /** The tab the drag started in: the drop commits there. */
      tabId: string;
      sx: number;
      sy: number;
      /** Selection roots; their descendants move with them. */
      ids: string[];
      /** The roots and all their descendants. */
      moving: Set<string>;
      doc0: Doc;
      /** The render the drag started from: snapping and the preview read its boxes and routes. */
      render0: RenderInfo;
      /** Current offset in document px, snapped and rounded. */
      dx: number;
      dy: number;
      /** Alt is held: the preview shows copies and the originals stay. */
      copy: boolean;
      moved: boolean;
      /** Shift-press on a selected element: deselect it on release unless the press became a drag. */
      toggle?: string;
    }
  | {
      kind: 'resize';
      tabId: string;
      sx: number;
      sy: number;
      id: string;
      doc0: Doc;
      box0: Box;
      /** The outline's size; the document changes only on release. */
      width: number;
      height: number;
    }
  | {
      kind: 'link';
      from: string;
      fromPort: Port;
      x: number;
      y: number;
      target: { id: string; port: Port } | null;
      keyboard: boolean;
    }
  | {
      kind: 'reconnect';
      tabId: string;
      /** The connection's index in the document. */
      index: number;
      /** The end being moved, and the element it was on. */
      end: 'from' | 'to';
      was: string;
      /** The element at the end that stays, and that end's point. */
      other: string;
      anchor: { x: number; y: number };
      x: number;
      y: number;
      /** `pinned`: the pointer is on one of the target's ports, so this end snaps to it. */
      target: { id: string; port: Port; pinned: boolean } | null;
      keyboard: boolean;
    }
  | { kind: 'marquee'; x0: number; y0: number; x: number; y: number; base: string[] };
type ReconnectGesture = Extract<Gesture, { kind: 'reconnect' }>;
type MoveGesture = Extract<Gesture, { kind: 'move' }>;
/**
 * The connection label editor: bound to its tab and to the connection's ends when it opened. `start` is the
 * field's opening text: an untouched field commits nothing, whatever the stored label holds.
 */
type LabelEdit = { tabId: string; index: number; from: string; to: string; value: string; start: string };

/** Containment depth, for paint/hit order: containers under their members. */
function depthOf(doc: Doc, id: string): number {
  const byId = new Map(doc.entities.map((e) => [e.id, e]));
  let d = 0;
  let cur = byId.get(id)?.containerId;
  while (cur && d < 50) {
    d++;
    cur = byId.get(cur)?.containerId;
  }
  return d;
}

function connectionTarget(point: { x: number; y: number }, from: string) {
  const { render, zoom } = useUi.getState();
  if (!render) return null;
  const tolerance = 12 / zoom;
  const entities = useDoc.getState().doc.entities;
  const target = entities
    .filter((e) => e.id !== from && !CONTAINER_TAGS.has(e.tag))
    .map((e) => ({ id: e.id, box: render.boxes[e.id] }))
    .filter(
      (e): e is { id: string; box: Box } =>
        !!e.box &&
        point.x >= e.box.x - tolerance &&
        point.x <= e.box.x + e.box.width + tolerance &&
        point.y >= e.box.y - tolerance &&
        point.y <= e.box.y + e.box.height + tolerance,
    )
    .sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height)[0];
  return target ? { id: target.id, port: nearestPort(target.box, point) } : null;
}

export function Canvas() {
  const [dropActive, setDropActive] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const doc = useDoc((s) => s.doc);
  const selection = useDoc((s) => s.selection);
  const render = useUi((s) => s.render);
  const zoom = useUi((s) => s.zoom);
  const pan = useUi((s) => s.pan);
  const errors = useUi((s) => s.errors);
  const fitRequest = useUi((s) => s.fitRequest);
  const theme = useUi((s) => s.theme);
  const ease = useUi((s) => s.ease);
  const view = useRef<HTMLDivElement>(null);
  const sceneHost = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const space = useRef(false);
  const [, force] = useState(0);
  const [guides, setGuides] = useState<{ x?: number; y?: number }[]>([]);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const lines = useRef<SVGSVGElement>(null);
  /** A committed drop whose render has not landed yet: its preview stays up until then. */
  const settle = useRef<{
    render: RenderInfo | null;
    errors: unknown;
    shift: { x: number; y: number } | null;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [sizing, setSizing] = useState<{ id: string; box: Box } | null>(null);
  const [labelEdit, setLabelEdit] = useState<LabelEdit | null>(null);
  // Commit reads the ref, so Escape (which clears it) can never be undone by the blur that follows.
  const labelRef = useRef<LabelEdit | null>(null);
  labelRef.current = labelEdit;
  // F2/Enter (in a mount-time key listener) reach the latest openLabel through this ref.
  const openLabelRef = useRef<(index: number) => void>(() => {});

  // The engine mounts a fresh #eraser-scene per render; adopt it.
  useLayoutEffect(() => {
    if (render && sceneHost.current && render.scene.parentElement !== sceneHost.current) {
      sceneHost.current.replaceChildren(render.scene);
    }
  }, [render]);

  const previewTarget = (g: MoveGesture) => {
    const r = useUi.getState().render ?? g.render0;
    return {
      scene: r.scene,
      overlay: overlay.current,
      lines: lines.current,
      doc: g.doc0,
      connectionIds: r.connectionIds,
      geometry: r.connections,
      zoom: useUi.getState().zoom,
    };
  };
  /** Compensate the document's origin shift on the CURRENT view, so a scroll or zoom meanwhile is kept. */
  const applyShift = (d: { x: number; y: number } | null) => {
    if (!d) return;
    const { pan: p, zoom: z, set } = useUi.getState();
    set({ pan: { x: p.x - d.x * z, y: p.y - d.y * z } });
  };
  const endPreview = () => {
    clearPreview(useUi.getState().render?.scene ?? null, overlay.current, lines.current);
    setDragging(false);
  };

  // A drop keeps its preview until its own render lands; otherwise the element would jump back for the
  // length of that render. A render that lands mid-drag gets the preview redrawn on its new scene.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the helpers only read refs and stores.
  useLayoutEffect(() => {
    const s = settle.current;
    if (s && (render !== s.render || errors !== s.errors)) {
      settle.current = null;
      applyShift(s.shift);
      endPreview();
    }
    const g = gesture.current;
    if (g?.kind === 'move' && g.moved && render)
      showPreview(previewTarget(g), { moving: g.moving, dx: g.dx, dy: g.dy, copy: g.copy });
  }, [render, errors]);

  const toDoc = useCallback((clientX: number, clientY: number) => {
    const rect = view.current!.getBoundingClientRect();
    const { pan: p, zoom: z } = useUi.getState();
    return { x: (clientX - rect.left - p.x) / z, y: (clientY - rect.top - p.y) / z };
  }, []);

  const fitView = useCallback(() => {
    const r = useUi.getState().render;
    const v = view.current;
    if (!r || !v) return;
    // Fit the whole sheet (diagram + margin), centred.
    const w = r.bounds.width + 2 * SHEET_PAD;
    const h = r.bounds.height + 2 * SHEET_PAD;
    const left = r.origin.x + r.bounds.x - SHEET_PAD;
    const top = r.origin.y + r.bounds.y - SHEET_PAD;
    const z = clampZoom(Math.min(1, (v.clientWidth - 48) / w, (v.clientHeight - 48) / h));
    useUi.getState().set({
      zoom: z,
      pan: {
        x: (v.clientWidth - w * z) / 2 - left * z,
        y: (v.clientHeight - h * z) / 2 - top * z,
      },
    });
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: fitView reruns on request, and on the first render.
  useEffect(() => {
    if (fitRequest) fitView();
  }, [fitRequest]);
  const hadRender = useRef(false);
  useEffect(() => {
    if (render && !hadRender.current) {
      hadRender.current = true;
      fitView();
    }
  }, [render, fitView]);
  // A fit asked for by a document change waits for that document's render.
  useEffect(() => {
    if (render && useUi.getState().fitPending) {
      useUi.setState({ fitPending: false });
      requestFit();
    }
  }, [render]);

  // Wheel: pan; ctrl/cmd + wheel (and trackpad pinch): zoom around the cursor.
  useEffect(() => {
    const v = view.current!;
    const onWheel = (e: WheelEvent) => {
      if (useUi.getState().ease) useUi.setState({ ease: null });
      e.preventDefault();
      const { zoom: z, pan: p, set } = useUi.getState();
      if (e.ctrlKey || e.metaKey) {
        const rect = v.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const nz = clampZoom(z * Math.exp(-e.deltaY * 0.01));
        set({ zoom: nz, pan: { x: cx - ((cx - p.x) * nz) / z, y: cy - ((cy - p.y) * nz) / z } });
      } else {
        set({ pan: { x: p.x - e.deltaX, y: p.y - e.deltaY } });
      }
    };
    v.addEventListener('wheel', onWheel, { passive: false });
    return () => v.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName));
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !typing(e.target) && !space.current) {
        space.current = true;
        force((n) => n + 1);
      }
      // F2 or Enter edits the one selected element's text or line's label (draw.io); several do nothing.
      // Enter only from the board, so a focused button keeps it.
      if ((e.key !== 'F2' && e.key !== 'Enter') || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      const onBoard =
        t === document.body || (t instanceof HTMLElement && !!t.closest('.canvas') && !t.closest('button'));
      const ui = useUi.getState();
      if (typing(t) || ui.settingsOpen || ui.iconPick || gesture.current || (e.key === 'Enter' && !onBoard))
        return;
      const { doc: d, selection: sel } = useDoc.getState();
      const one = sel.entities.length === 1 && !sel.connections.length;
      const entity = one ? d.entities.find((x) => x.id === sel.entities[0]) : undefined;
      if (entity) {
        e.preventDefault();
        setEditing({ id: entity.id, value: getPrimaryText(entity) });
      } else if (sel.connections.length === 1 && !sel.entities.length) {
        e.preventDefault();
        openLabelRef.current(sel.connections[0]!);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        space.current = false;
        force((n) => n + 1);
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const startPan = (e: React.PointerEvent) => {
    gesture.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, pan0: useUi.getState().pan };
    force((n) => n + 1);
  };

  /** Drop one element from a tab's selection (a Shift-click on a selected element). */
  const deselect = (tabId: string, id: string) =>
    docApi(tabId).select({
      entities: (tabState(tabId)?.selection.entities ?? []).filter((x) => x !== id),
      connections: [],
    });

  /** Commit a move, or with Alt a copy, as one undo step; the preview stays until this drop's render lands. */
  const drop = (g: MoveGesture, copy: boolean) => {
    const t = tabState(g.tabId);
    // Nothing moved, or the document changed under the drag (an AI result): keep the document as it is.
    if (!t || t.doc !== g.doc0 || (!g.dx && !g.dy)) return endPreview();
    let base = g.doc0;
    let roots = g.ids;
    const boxes0 = { ...g.render0.boxes };
    if (copy) {
      const pasted = pasteElements(g.doc0, copyElements(g.doc0, g.ids), 0, 0, true);
      base = pasted.doc;
      roots = pasted.newIds;
      for (const [from, to] of pasted.idMap) if (boxes0[from]) boxes0[to] = boxes0[from]!;
    }
    const moving = withDescendants(base, roots);
    const { doc: moved, offset } = dragEntities(base, roots, g.dx, g.dy);
    const boxes = Object.fromEntries(
      Object.entries(boxes0).map(([id, b]) => {
        const k = moving.has(id) ? 1 : 0;
        return [id, { ...b, x: b.x + offset.x + k * g.dx, y: b.y + offset.y + k * g.dy }];
      }),
    );
    // Membership changes on drop: each root joins the smallest container under its centre, or the root.
    let d = moved;
    for (const id of roots) d = reparent(d, id, boxes);
    const ui = useUi.getState();
    settle.current = {
      render: ui.render,
      errors: ui.errors,
      // A drop past x/y = 0 shifts the whole document; pan by the same amount (in diagram units) once its render lands.
      shift: offset.x || offset.y ? offset : null,
    };
    const api = docApi(g.tabId);
    api.commit(fitContainers(d, boxes));
    if (copy) api.select({ entities: roots, connections: [] });
  };

  // One window-level move/up pair drives every gesture.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the helpers only read refs and stores.
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g) return;
      const { zoom: z, set, render: r } = useUi.getState();
      if (g.kind === 'pan') {
        set({ pan: { x: g.pan0.x + e.clientX - g.sx, y: g.pan0.y + e.clientY - g.sy } });
      } else if (g.kind === 'move') {
        let dx = (e.clientX - g.sx) / z;
        let dy = (e.clientY - g.sy) / z;
        if (!g.moved && Math.hypot(dx, dy) < 3 / z) return;
        if (!g.moved) setDragging(true);
        g.moved = true;
        // Shift: move along the axis the pointer has travelled furthest (x locked → vertical move).
        const lock = e.shiftKey ? (Math.abs(dx) >= Math.abs(dy) ? 'y' : 'x') : null;
        if (lock === 'x') dx = 0;
        if (lock === 'y') dy = 0;
        const boxes0 = g.render0.boxes;
        const mine = g.ids.map((id) => boxes0[id]).filter((b): b is Box => !!b);
        let guides: { x?: number; y?: number }[] = [];
        // Alt drops a copy (the originals stay); ⌘ on macOS, Ctrl elsewhere, turns snapping off.
        g.copy = e.altKey;
        if (mine.length && !(isMac ? e.metaKey : e.ctrlKey)) {
          const left = Math.min(...mine.map((b) => b.x));
          const top = Math.min(...mine.map((b) => b.y));
          const bounds = {
            x: left + dx,
            y: top + dy,
            width: Math.max(...mine.map((b) => b.x + b.width)) - left,
            height: Math.max(...mine.map((b) => b.y + b.height)) - top,
          };
          const others = Object.entries(boxes0)
            .filter(([id]) => g.copy || !g.moving.has(id))
            .map(([, b]) => b);
          const s = snap(bounds, others, 6 / z);
          if (lock !== 'x') dx += s.dx;
          if (lock !== 'y') dy += s.dy;
          guides = s.guides.filter(
            (gd) => (gd.x === undefined || lock !== 'x') && (gd.y === undefined || lock !== 'y'),
          );
        }
        g.dx = Math.round(dx);
        g.dy = Math.round(dy);
        setGuides(guides);
        // No document change and no engine render per move: only the preview moves (dragPreview.ts).
        showPreview(previewTarget(g), { moving: g.moving, dx: g.dx, dy: g.dy, copy: g.copy });
      } else if (g.kind === 'resize') {
        // An outline follows the handle; the engine renders once, on release (as in draw.io).
        g.width = Math.max(8, Math.round(g.box0.width + (e.clientX - g.sx) / z));
        g.height = Math.max(8, Math.round(g.box0.height + (e.clientY - g.sy) / z));
        setSizing({ id: g.id, box: { ...g.box0, width: g.width, height: g.height } });
      } else if (g.kind === 'link' || g.kind === 'marquee' || g.kind === 'reconnect') {
        const p = toDoc(e.clientX, e.clientY);
        g.x = p.x;
        g.y = p.y;
        if (g.kind === 'reconnect') {
          const t = connectionTarget(p, g.other);
          const box = t ? r?.boxes[t.id] : undefined;
          const at = t && box ? portPoint(box, t.port) : null;
          g.target = t && at ? { ...t, pinned: Math.hypot(at.x - p.x, at.y - p.y) <= 12 / z } : null;
          if (g.target?.pinned && at) {
            g.x = at.x;
            g.y = at.y;
          }
        }
        if (g.kind === 'link') {
          g.target = connectionTarget(p, g.from);
          if (g.target && r?.boxes[g.target.id]) {
            const point = portPoint(r.boxes[g.target.id]!, g.target.port);
            g.x = point.x;
            g.y = point.y;
          }
        }
        if (g.kind === 'marquee' && r) {
          const rect = {
            x: Math.min(g.x0, g.x),
            y: Math.min(g.y0, g.y),
            w: Math.abs(g.x - g.x0),
            h: Math.abs(g.y - g.y0),
          };
          const inside = Object.entries(r.boxes)
            .filter(
              ([, b]) =>
                b.x >= rect.x &&
                b.y >= rect.y &&
                b.x + b.width <= rect.x + rect.w &&
                b.y + b.height <= rect.y + rect.h,
            )
            .map(([id]) => id);
          useDoc.getState().select({ entities: [...new Set([...g.base, ...inside])], connections: [] });
        }
        force((n) => n + 1);
      }
    };
    const up = (e: PointerEvent) => {
      const g = gesture.current;
      if ((g?.kind === 'link' || g?.kind === 'reconnect') && g.keyboard) return;
      gesture.current = null;
      setGuides([]);
      if (!g) return;
      const store = useDoc.getState();
      if (g.kind === 'move') {
        if (g.moved) drop(g, g.copy);
        else if (g.toggle) deselect(g.tabId, g.toggle);
      } else if (g.kind === 'resize') {
        setSizing(null);
        const t = tabState(g.tabId);
        if (t && t.doc === g.doc0 && (g.width !== g.box0.width || g.height !== g.box0.height))
          docApi(g.tabId).commit(resizeEntity(g.doc0, g.id, g.width, g.height));
      } else if (g.kind === 'link') {
        const p = toDoc(e.clientX, e.clientY);
        const target = connectionTarget(p, g.from);
        if (target) {
          const next = connect(store.doc, g.from, target.id, { fromPort: g.fromPort, toPort: target.port });
          if (next !== store.doc) {
            store.commit(next);
            store.select({ entities: [], connections: [next.connections.length - 1] });
          }
        }
      } else if (g.kind === 'reconnect') {
        finishReconnect(g, g.target);
      }
      force((n) => n + 1);
    };
    const cancel = () => {
      const g = gesture.current;
      gesture.current = null;
      setGuides([]);
      setDropActive(false);
      if (g?.kind === 'move') endPreview();
      if (g?.kind === 'resize') setSizing(null);
      if (g) force((n) => n + 1);
    };
    // Leaving the window or the tab also ends a drop's wait: apply its pan now, so the tab's saved view is right.
    const blur = () => {
      const s = settle.current;
      settle.current = null;
      if (s) applyShift(s.shift);
      if (s) endPreview();
      cancel();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    const dragEnd = () => setDropActive(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', blur);
    window.addEventListener('keydown', key);
    window.addEventListener('dragend', dragEnd);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', blur);
      window.removeEventListener('keydown', key);
      window.removeEventListener('dragend', dragEnd);
    };
  }, [toDoc]);

  const onEntityDown = (e: React.PointerEvent, id: string) => {
    commitText();
    if (e.button === 1 || space.current) return startPan(e);
    if (e.button !== 0) return;
    e.stopPropagation();
    const store = useDoc.getState();
    let ids = store.selection.entities;
    const tabId = useTabs.getState().activeId;
    // Shift adds at once; Shift on a selected element removes it on release, unless the press becomes a drag.
    const toggle = e.shiftKey && ids.includes(id) ? id : undefined;
    if (e.shiftKey && !toggle) {
      ids = [...ids, id];
      store.select({ entities: ids, connections: [] });
    } else if (!e.shiftKey && !ids.includes(id)) {
      ids = [id];
      store.select({ entities: ids, connections: [] });
    }
    const r = useUi.getState().render;
    // While a drop is still rendering, a press selects but does not start another move.
    if (!r || settle.current) {
      if (toggle) deselect(tabId, toggle);
      return;
    }
    // Move only selection roots: a selected child of a selected group moves with the group.
    const roots = selectionRoots(store.doc, ids);
    gesture.current = {
      kind: 'move',
      tabId,
      sx: e.clientX,
      sy: e.clientY,
      ids: roots,
      moving: withDescendants(store.doc, roots),
      doc0: store.doc,
      render0: r,
      dx: 0,
      dy: 0,
      copy: false,
      moved: false,
      toggle,
    };
  };

  const onBackgroundDown = (e: React.PointerEvent) => {
    if (e.button === 1 || space.current) return startPan(e);
    if (e.button !== 0) return;
    const p = toDoc(e.clientX, e.clientY);
    const base = e.shiftKey ? useDoc.getState().selection.entities : [];
    useDoc.getState().select({ entities: base, connections: [] });
    gesture.current = { kind: 'marquee', x0: p.x, y0: p.y, x: p.x, y: p.y, base };
    commitText();
  };

  const onResizeDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    const r = useUi.getState().render;
    const box0 = r?.boxes[id];
    if (!box0) return;
    gesture.current = {
      kind: 'resize',
      tabId: useTabs.getState().activeId,
      sx: e.clientX,
      sy: e.clientY,
      id,
      doc0: useDoc.getState().doc,
      box0,
      width: box0.width,
      height: box0.height,
    };
  };

  const onLinkDown = (e: React.PointerEvent, id: string, port: Port = 'right') => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    commitText();
    const box = useUi.getState().render?.boxes[id];
    if (!box) return;
    const p = portPoint(box, port);
    useDoc.getState().select({ entities: [id], connections: [] });
    gesture.current = {
      kind: 'link',
      from: id,
      fromPort: port,
      x: p.x,
      y: p.y,
      target: null,
      keyboard: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    force((n) => n + 1);
  };

  /** Grab one end of connection `index`; with `keyboard`, every icon shows its ports to pick from. */
  const startReconnect = (index: number, end: 'from' | 'to', keyboard: boolean): boolean => {
    const r = useUi.getState().render;
    const c = useDoc.getState().doc.connections[index];
    const pts = r?.connections[r.connectionIds[index] ?? '']?.points;
    if (!c || !pts || pts.length < 2) return false;
    commitText();
    const [ax, ay] = end === 'from' ? pts.at(-1)! : pts[0]!;
    const [x, y] = end === 'from' ? pts[0]! : pts.at(-1)!;
    gesture.current = {
      kind: 'reconnect',
      tabId: useTabs.getState().activeId,
      index,
      end,
      was: c[end],
      other: end === 'from' ? c.to : c.from,
      anchor: { x: ax, y: ay },
      x,
      y,
      target: null,
      keyboard,
    };
    force((n) => n + 1);
    return true;
  };

  /**
   * Re-attach the moved end. Ports are both-or-neither (precise routing needs both): a port drop pins this
   * end and, if the other end floats, pins it to its port nearest the new end; a body drop pins this end
   * only when the other end is pinned. An invalid target, a body drop on the element this end is already
   * on, or a connection whose ends changed meanwhile changes nothing.
   */
  const finishReconnect = (g: ReconnectGesture, target: ReconnectGesture['target']) => {
    const t = tabState(g.tabId);
    const c = t?.doc.connections[g.index];
    const r = useUi.getState().render;
    const otherEnd = g.end === 'from' ? 'to' : 'from';
    if (!t || !c || !r || !target || c[otherEnd] !== g.other || c[g.end] !== g.was) return;
    if (target.id === g.was && !target.pinned) return;
    const otherPort = c[`${otherEnd}Port`];
    const box = r.boxes[target.id];
    const otherBox = r.boxes[g.other];
    let ports: { fromPort: Port; toPort: Port } | undefined;
    if ((target.pinned || isPort(otherPort)) && box && otherBox) {
      const mine = target.port;
      const theirs = isPort(otherPort) ? otherPort : nearestPort(otherBox, portPoint(box, mine));
      ports = g.end === 'from' ? { fromPort: mine, toPort: theirs } : { fromPort: theirs, toPort: mine };
    }
    const next = reconnect(t.doc, g.index, g.end, target.id, ports);
    if (next !== t.doc) docApi(g.tabId).commit(next);
  };

  const onEndDown = (e: React.PointerEvent, index: number, end: 'from' | 'to') => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (startReconnect(index, end, false)) e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onKeyboardLink = (id: string, port: Port) => {
    const g = gesture.current;
    const store = useDoc.getState();
    if (g?.kind === 'reconnect' && g.keyboard) {
      if (id !== g.other) finishReconnect(g, { id, port, pinned: true });
      gesture.current = null;
      force((n) => n + 1);
      return;
    }
    if (g?.kind === 'link' && g.keyboard) {
      const next = connect(store.doc, g.from, id, { fromPort: g.fromPort, toPort: port });
      if (next !== store.doc) store.commit(next);
      gesture.current = null;
    } else {
      commitText();
      const box = useUi.getState().render?.boxes[id];
      if (!box) return;
      const p = portPoint(box, port);
      gesture.current = {
        kind: 'link',
        from: id,
        fromPort: port,
        x: p.x,
        y: p.y,
        target: null,
        keyboard: true,
      };
    }
    force((n) => n + 1);
  };

  const onPortFocus = (id: string, port: Port) => {
    const g = gesture.current;
    const box = useUi.getState().render?.boxes[id];
    if (g?.kind === 'reconnect' && g.keyboard && box && id !== g.other) {
      const p = portPoint(box, port);
      g.target = { id, port, pinned: true };
      g.x = p.x;
      g.y = p.y;
      force((n) => n + 1);
      return;
    }
    if (g?.kind !== 'link' || !g.keyboard || !box || id === g.from) return;
    const p = portPoint(box, port);
    g.target = { id, port };
    g.x = p.x;
    g.y = p.y;
    force((n) => n + 1);
  };

  const order = useMemo(() => {
    return doc.entities
      .map((e) => ({ e, key: depthOf(doc, e.id) * 2 + (CONTAINER_TAGS.has(e.tag) ? 0 : 1) }))
      .sort((a, b) => a.key - b.key)
      .map((x) => x.e);
  }, [doc]);

  const openLabel = (index: number) => {
    const c = useDoc.getState().doc.connections[index];
    if (!c) return;
    commitText();
    const value = typeof c.label === 'string' ? c.label : '';
    const next = { tabId: useTabs.getState().activeId, index, from: c.from, to: c.to, value, start: value };
    labelRef.current = next;
    setLabelEdit(next);
  };
  openLabelRef.current = openLabel;
  const cancelLabel = () => {
    labelRef.current = null;
    setLabelEdit(null);
  };
  const commitLabel = () => {
    const l = labelRef.current;
    if (!l) return;
    cancelLabel();
    if (l.value === l.start) return;
    const t = tabState(l.tabId);
    const c = t?.doc.connections[l.index];
    if (!t || !c) return;
    if (c.from !== l.from || c.to !== l.to) return toast('Label not saved: the connection changed.');
    const next = setConnectionLabel(t.doc, l.index, l.value);
    if (next !== t.doc) docApi(l.tabId).commit(next);
  };

  const commitText = () => {
    commitLabel();
    if (!editing) return;
    const store = useDoc.getState();
    const e = store.doc.entities.find((x) => x.id === editing.id);
    if (e && getPrimaryText(e) !== editing.value)
      store.commit(setPrimaryText(store.doc, editing.id, editing.value));
    setEditing(null);
  };

  const g = gesture.current;
  const single = selection.entities.length === 1 ? selection.entities[0]! : null;
  // While resizing, the handles follow the outline.
  const singleBox = single ? (sizing?.id === single ? sizing.box : render?.boxes[single]) : undefined;
  const singleIcon = doc.entities.find((e) => e.id === single)?.tag === 'Icon';
  const editBox = editing ? render?.boxes[editing.id] : undefined;
  // A selected connection (alone) shows a handle on each end for reconnecting.
  const selIndex =
    selection.connections.length === 1 && !selection.entities.length ? selection.connections[0]! : null;
  const selPoints =
    selIndex !== null && render
      ? render.connections[render.connectionIds[selIndex] ?? '']?.points
      : undefined;
  const portTarget =
    g?.kind === 'link' ? g.target : g?.kind === 'reconnect' && g.target?.pinned ? g.target : null;
  const labelAt =
    labelEdit && render ? render.connections[render.connectionIds[labelEdit.index] ?? '']?.label : undefined;

  return (
    <div
      ref={view}
      onPointerDownCapture={() => {
        if (useUi.getState().ease) useUi.setState({ ease: null }); // a gesture takes over 1:1
      }}
      className={`canvas ${theme}${space.current ? ' space' : ''}${g?.kind === 'pan' ? ' panning' : ''}${dropActive ? ' icon-drop-active' : ''}`}
      onPointerDown={onBackgroundDown}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(ICON_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDropActive(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropActive(false);
      }}
      onDrop={(e) => {
        setDropActive(false);
        if (!e.dataTransfer.types.includes(ICON_MIME)) return;
        e.preventDefault();
        commitText();
        insertIconAt(e.dataTransfer.getData(ICON_MIME), toDoc(e.clientX, e.clientY));
      }}
      data-testid="canvas"
    >
      <div
        className="stage"
        data-ease={ease ?? undefined}
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
      >
        {render && doc.entities.length > 0 && (
          <div
            className={`sheet ${theme}`}
            style={{
              // Dark: the canvas is the ground (eraser.io look); light: a white sheet.
              background: theme === 'dark' ? 'transparent' : groundOf(theme),
              left: render.origin.x + render.bounds.x - SHEET_PAD,
              top: render.origin.y + render.bounds.y - SHEET_PAD,
              width: render.bounds.width + 2 * SHEET_PAD,
              height: render.bounds.height + 2 * SHEET_PAD,
            }}
          >
            <div
              className="scene-host"
              ref={sceneHost}
              style={{ left: SHEET_PAD - render.bounds.x, top: SHEET_PAD - render.bounds.y }}
            />
          </div>
        )}
        {render && (
          <div className="overlay" ref={overlay}>
            {order.map((e) => {
              const b = render.boxes[e.id];
              if (!b) return null;
              const container = CONTAINER_TAGS.has(e.tag);
              return (
                <div
                  key={e.id}
                  data-id={e.id}
                  className={`hit${container ? ' container' : ''}${selection.entities.includes(e.id) ? ' sel' : ''}${(g?.kind === 'link' || g?.kind === 'reconnect') && g.target?.id === e.id ? ' connection-target' : ''}`}
                  style={{ left: b.x, top: b.y, width: b.width, height: b.height }}
                  onPointerDown={(ev) => onEntityDown(ev, e.id)}
                  onPointerEnter={() => setHovered(e.id)}
                  onPointerLeave={() => setHovered((id) => (id === e.id ? null : id))}
                  onDoubleClick={(ev) => {
                    ev.stopPropagation();
                    setEditing({ id: e.id, value: getPrimaryText(e) });
                  }}
                />
              );
            })}
            <svg className="conn-svg" width="1" height="1" aria-hidden="true">
              {render.connectionIds.map((cid, i) => {
                const geo = render.connections[cid];
                if (!geo) return null;
                const pick = (ev: React.PointerEvent) => {
                  ev.stopPropagation();
                  const sel = useDoc.getState().selection;
                  useDoc.getState().select({
                    entities: [],
                    connections: ev.shiftKey ? [...new Set([...sel.connections, i])] : [i],
                  });
                };
                const edit = (ev: React.MouseEvent) => {
                  ev.stopPropagation();
                  openLabel(i);
                };
                return (
                  <g key={cid}>
                    <path
                      data-conn={i}
                      d={geo.d}
                      className={`conn-hit${selection.connections.includes(i) ? ' sel' : ''}`}
                      onPointerDown={pick}
                      onDoubleClick={edit}
                    />
                    {geo.labelBox && (
                      <rect
                        className="conn-hit-label"
                        data-conn-label={i}
                        x={geo.labelBox.x}
                        y={geo.labelBox.y}
                        width={geo.labelBox.width}
                        height={geo.labelBox.height}
                        onPointerDown={pick}
                        onDoubleClick={edit}
                      />
                    )}
                  </g>
                );
              })}
            </svg>
            <svg className="preview-svg" ref={lines} width="1" height="1" aria-hidden="true" />
            {singleBox && !editing && !dragging && (
              <>
                <div
                  className="handle"
                  data-testid="resize-handle"
                  style={{
                    left: singleBox.x + singleBox.width + (singleIcon ? 16 / zoom : 0),
                    top: singleBox.y + singleBox.height + (singleIcon ? 16 / zoom : 0),
                    transform: `translate(-50%, -50%) scale(${1 / zoom})`,
                  }}
                  onPointerDown={(ev) => onResizeDown(ev, single!)}
                />
                {!singleIcon && (
                  <div
                    className="link-handle"
                    data-testid="link-handle"
                    title="Drag to another element to connect"
                    style={{
                      left: singleBox.x + singleBox.width + 10,
                      top: singleBox.y + singleBox.height / 2 - 7,
                      transform: `scale(${1 / zoom})`,
                    }}
                    onPointerDown={(ev) => onLinkDown(ev, single!)}
                  />
                )}
              </>
            )}
            {!editing &&
              !dragging &&
              order
                .filter((e) => e.tag === 'Icon')
                .map((e) => {
                  const box = render.boxes[e.id];
                  const visible =
                    hovered === e.id ||
                    selection.entities.includes(e.id) ||
                    (g?.kind === 'link' && (g.keyboard || g.from === e.id || g.target?.id === e.id)) ||
                    (g?.kind === 'reconnect' && (g.keyboard || g.target?.id === e.id));
                  if (!box || !visible) return null;
                  return (
                    <ConnectionPorts
                      key={e.id}
                      id={e.id}
                      box={box}
                      zoom={zoom}
                      target={portTarget?.id === e.id ? portTarget.port : undefined}
                      onStart={onLinkDown}
                      onKeyboard={onKeyboardLink}
                      onHover={setHovered}
                      onFocus={onPortFocus}
                    />
                  );
                })}
            {g?.kind === 'link' && render.boxes[g.from] && (
              <svg className="link-svg" data-testid="link-preview" width="1" height="1" aria-hidden="true">
                <line
                  x1={portPoint(render.boxes[g.from]!, g.fromPort).x}
                  y1={portPoint(render.boxes[g.from]!, g.fromPort).y}
                  x2={g.x}
                  y2={g.y}
                  stroke="#5e6ad2"
                  strokeWidth={2 / zoom}
                  strokeDasharray={g.target ? undefined : `${6 / zoom} ${4 / zoom}`}
                />
              </svg>
            )}
            {sizing && (
              <div
                className="resize-preview"
                data-testid="resize-preview"
                style={{
                  left: sizing.box.x,
                  top: sizing.box.y,
                  width: sizing.box.width,
                  height: sizing.box.height,
                }}
              />
            )}
            {selIndex !== null &&
              selPoints &&
              selPoints.length >= 2 &&
              !labelEdit &&
              (['from', 'to'] as const).map((end) => {
                const [x, y] = end === 'from' ? selPoints[0]! : selPoints.at(-1)!;
                return (
                  <button
                    key={end}
                    type="button"
                    className="conn-end"
                    data-testid={`conn-end-${end}`}
                    aria-label={
                      end === 'from'
                        ? 'Reconnect the start of this connection'
                        : 'Reconnect the end of this connection'
                    }
                    title="Drag to another element or one of its ports"
                    style={{ left: x, top: y, transform: `translate(-50%, -50%) scale(${1 / zoom})` }}
                    onPointerDown={(ev) => onEndDown(ev, selIndex, end)}
                    onKeyDown={(ev) => {
                      if (ev.key !== 'Enter' && ev.key !== ' ') return;
                      ev.preventDefault();
                      ev.stopPropagation();
                      startReconnect(selIndex, end, true);
                    }}
                  />
                );
              })}
            {g?.kind === 'reconnect' && (
              <svg
                className="link-svg"
                data-testid="reconnect-preview"
                width="1"
                height="1"
                aria-hidden="true"
              >
                <line
                  x1={g.anchor.x}
                  y1={g.anchor.y}
                  x2={g.x}
                  y2={g.y}
                  style={{ stroke: 'var(--line)' }}
                  strokeWidth={2 / zoom}
                  strokeDasharray={g.target ? undefined : `${6 / zoom} ${4 / zoom}`}
                />
              </svg>
            )}
            {g?.kind === 'marquee' && (
              <div
                className="marquee"
                style={{
                  left: Math.min(g.x0, g.x),
                  top: Math.min(g.y0, g.y),
                  width: Math.abs(g.x - g.x0),
                  height: Math.abs(g.y - g.y0),
                }}
              />
            )}
            {guides.map((gd) =>
              gd.x !== undefined ? (
                <div
                  key={`gx${gd.x}`}
                  className="guide"
                  style={{
                    left: gd.x,
                    top: render.origin.y - 400,
                    width: 1 / zoom,
                    height: render.size.height + 800,
                  }}
                />
              ) : (
                <div
                  key={`gy${gd.y}`}
                  className="guide"
                  style={{
                    top: gd.y,
                    left: render.origin.x - 400,
                    height: 1 / zoom,
                    width: render.size.width + 800,
                  }}
                />
              ),
            )}
            {editing && editBox && (
              <textarea
                className="text-edit"
                autoFocus
                value={editing.value}
                style={{ left: editBox.x, top: editBox.y, width: Math.max(160, editBox.width) }}
                onPointerDown={(ev) => ev.stopPropagation()}
                onChange={(ev) => setEditing({ ...editing, value: ev.target.value })}
                onBlur={commitText}
                onKeyDown={(ev) => {
                  ev.stopPropagation();
                  if (ev.nativeEvent.isComposing) return; // an IME's Enter/Escape ends the composition only
                  if (ev.key === 'Escape') setEditing(null);
                  if (ev.key === 'Enter' && !ev.shiftKey) {
                    ev.preventDefault();
                    commitText();
                  }
                }}
              />
            )}
            {labelEdit && labelAt && (
              <input
                className="text-edit label-edit"
                aria-label="Connection label"
                autoFocus
                value={labelEdit.value}
                style={{ left: labelAt.x, top: labelAt.y }}
                onPointerDown={(ev) => ev.stopPropagation()}
                onChange={(ev) => setLabelEdit({ ...labelEdit, value: ev.target.value })}
                onBlur={commitLabel}
                onKeyDown={(ev) => {
                  // Keys stay in the field: ⌘Z, ⌘C, Delete and arrows never reach the canvas shortcuts.
                  ev.stopPropagation();
                  if (ev.nativeEvent.isComposing) return; // an IME's Enter/Escape ends the composition only
                  if (ev.key === 'Escape') cancelLabel();
                  if (ev.key === 'Enter') {
                    ev.preventDefault();
                    commitLabel();
                  }
                }}
              />
            )}
          </div>
        )}
      </div>

      {doc.entities.length === 0 && (
        <div className="empty">
          <div className="empty-card">
            <h2>Start a diagram</h2>
            <p>
              Drag an icon from the Icons tab, describe a diagram in the AI panel, or paste JSON into the Code
              tab.
            </p>
          </div>
        </div>
      )}
      {errors.length > 0 && (
        <div className="error-pill" onPointerDown={(e) => e.stopPropagation()}>
          {errors.length} error{errors.length > 1 ? 's' : ''} — showing the last valid version.{' '}
          {errors[0]!.message}
        </div>
      )}
      <div className="zoom-ctl" onPointerDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="btn icon"
          aria-label="Zoom out"
          onClick={() => zoomBy(1 / 1.25, view.current)}
        >
          <IconMinus />
        </button>
        <button
          type="button"
          className="btn zoom-pct"
          aria-label="Reset zoom to 100%"
          onClick={() => zoomTo(1, view.current)}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          className="btn icon"
          aria-label="Zoom in"
          onClick={() => zoomBy(1.25, view.current)}
        >
          <IconPlus />
        </button>
        <button type="button" className="btn" onClick={requestFit}>
          Fit
        </button>
      </div>
    </div>
  );
}

function zoomBy(factor: number, v: HTMLDivElement | null): void {
  zoomTo(useUi.getState().zoom * factor, v);
}

/** Zoom to `target` around the board's centre. */
function zoomTo(target: number, v: HTMLDivElement | null): void {
  if (!v) return;
  const { zoom: z, pan: p, set } = useUi.getState();
  const nz = clampZoom(target);
  const cx = v.clientWidth / 2;
  const cy = v.clientHeight / 2;
  easeView('view');
  set({ zoom: nz, pan: { x: cx - ((cx - p.x) * nz) / z, y: cy - ((cy - p.y) * nz) / z } });
}
