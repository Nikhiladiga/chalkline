import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fitContainers } from '../ai/merge';
import {
  CONTAINER_TAGS,
  connect,
  dragEntities,
  getPrimaryText,
  reparent,
  resizeEntity,
  selectionRoots,
  setPrimaryText,
  snap,
  withDescendants,
} from '../doc/ops';
import { docApi, tabState, useDoc, useTabs } from '../doc/store';
import { nearestPort, type Port, portPoint } from '../engine/ports';
import { groundOf } from '../engine/theme';
import { type Box, type Doc, SHEET_PAD } from '../engine/types';
import { insertIconAt } from './actions';
import { ConnectionPorts } from './ConnectionPorts';
import { clearPreview, showPreview } from './dragPreview';
import { ICON_MIME } from './iconCatalog';
import { IconMinus, IconPlus } from './icons';
import { easeView, type RenderInfo, requestFit, useUi } from './uiStore';

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
      moved: boolean;
    }
  | { kind: 'resize'; sx: number; sy: number; id: string; doc0: Doc; box0: Box }
  | {
      kind: 'link';
      from: string;
      fromPort: Port;
      x: number;
      y: number;
      target: { id: string; port: Port } | null;
      keyboard: boolean;
    }
  | { kind: 'marquee'; x0: number; y0: number; x: number; y: number; base: string[] };
type MoveGesture = Extract<Gesture, { kind: 'move' }>;

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
      showPreview(previewTarget(g), { moving: g.moving, dx: g.dx, dy: g.dy, copy: false });
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

  /** Commit a move as one undo step; the preview stays until this drop's render lands. */
  const drop = (g: MoveGesture) => {
    const t = tabState(g.tabId);
    // Nothing moved, or the document changed under the drag (an AI result): keep the document as it is.
    if (!t || t.doc !== g.doc0 || (!g.dx && !g.dy)) return endPreview();
    const { doc: moved, offset } = dragEntities(g.doc0, g.ids, g.dx, g.dy);
    const boxes = Object.fromEntries(
      Object.entries(g.render0.boxes).map(([id, b]) => {
        const k = g.moving.has(id) ? 1 : 0;
        return [id, { ...b, x: b.x + offset.x + k * g.dx, y: b.y + offset.y + k * g.dy }];
      }),
    );
    // Membership changes on drop: each root joins the smallest container under its centre, or the root.
    let d = moved;
    for (const id of g.ids) d = reparent(d, id, boxes);
    const ui = useUi.getState();
    settle.current = {
      render: ui.render,
      errors: ui.errors,
      // A drop past x/y = 0 shifts the whole document; pan by the same amount (in diagram units) once its render lands.
      shift: offset.x || offset.y ? offset : null,
    };
    docApi(g.tabId).commit(fitContainers(d, boxes));
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
        const boxes0 = g.render0.boxes;
        const mine = g.ids.map((id) => boxes0[id]).filter((b): b is Box => !!b);
        let guides: { x?: number; y?: number }[] = [];
        if (mine.length && !e.altKey) {
          const left = Math.min(...mine.map((b) => b.x));
          const top = Math.min(...mine.map((b) => b.y));
          const bounds = {
            x: left + dx,
            y: top + dy,
            width: Math.max(...mine.map((b) => b.x + b.width)) - left,
            height: Math.max(...mine.map((b) => b.y + b.height)) - top,
          };
          const others = Object.entries(boxes0)
            .filter(([id]) => !g.moving.has(id))
            .map(([, b]) => b);
          const s = snap(bounds, others, 6 / z);
          dx += s.dx;
          dy += s.dy;
          guides = s.guides;
        }
        g.dx = Math.round(dx);
        g.dy = Math.round(dy);
        setGuides(guides);
        // No document change and no engine render per move: only the preview moves (dragPreview.ts).
        showPreview(previewTarget(g), { moving: g.moving, dx: g.dx, dy: g.dy, copy: false });
      } else if (g.kind === 'resize') {
        const dx = (e.clientX - g.sx) / z;
        const dy = (e.clientY - g.sy) / z;
        useDoc.getState().replace(resizeEntity(g.doc0, g.id, g.box0.width + dx, g.box0.height + dy));
      } else if (g.kind === 'link' || g.kind === 'marquee') {
        const p = toDoc(e.clientX, e.clientY);
        g.x = p.x;
        g.y = p.y;
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
      if (g?.kind === 'link' && g.keyboard) return;
      gesture.current = null;
      setGuides([]);
      if (!g) return;
      const store = useDoc.getState();
      if (g.kind === 'move') {
        if (g.moved) drop(g);
      } else if (g.kind === 'resize') {
        store.endGesture();
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
      }
      force((n) => n + 1);
    };
    const cancel = () => {
      const g = gesture.current;
      gesture.current = null;
      setGuides([]);
      setDropActive(false);
      if (g?.kind === 'move') endPreview();
      if (g?.kind === 'resize') {
        useDoc.getState().replace(g.doc0);
        useDoc.setState({ gestureStart: null });
      }
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
    if (e.shiftKey) {
      ids = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
      store.select({ entities: ids, connections: [] });
      if (!ids.includes(id)) return;
    } else if (!ids.includes(id)) {
      ids = [id];
      store.select({ entities: ids, connections: [] });
    }
    const r = useUi.getState().render;
    // While a drop is still rendering, a press selects but does not start another move.
    if (!r || settle.current) return;
    // Move only selection roots: a selected child of a selected group moves with the group.
    const roots = selectionRoots(store.doc, ids);
    gesture.current = {
      kind: 'move',
      tabId: useTabs.getState().activeId,
      sx: e.clientX,
      sy: e.clientY,
      ids: roots,
      moving: withDescendants(store.doc, roots),
      doc0: store.doc,
      render0: r,
      dx: 0,
      dy: 0,
      moved: false,
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
    const store = useDoc.getState();
    store.beginGesture();
    gesture.current = { kind: 'resize', sx: e.clientX, sy: e.clientY, id, doc0: store.doc, box0 };
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

  const onKeyboardLink = (id: string, port: Port) => {
    const g = gesture.current;
    const store = useDoc.getState();
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

  const commitText = () => {
    if (!editing) return;
    const store = useDoc.getState();
    const e = store.doc.entities.find((x) => x.id === editing.id);
    if (e && getPrimaryText(e) !== editing.value)
      store.commit(setPrimaryText(store.doc, editing.id, editing.value));
    setEditing(null);
  };

  const g = gesture.current;
  const single = selection.entities.length === 1 ? selection.entities[0]! : null;
  const singleBox = single ? render?.boxes[single] : undefined;
  const singleIcon = doc.entities.find((e) => e.id === single)?.tag === 'Icon';
  const editBox = editing ? render?.boxes[editing.id] : undefined;

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
                  className={`hit${container ? ' container' : ''}${selection.entities.includes(e.id) ? ' sel' : ''}${g?.kind === 'link' && g.target?.id === e.id ? ' connection-target' : ''}`}
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
                return (
                  <path
                    key={cid}
                    data-conn={i}
                    d={geo.d}
                    className={`conn-hit${selection.connections.includes(i) ? ' sel' : ''}`}
                    onPointerDown={(ev) => {
                      ev.stopPropagation();
                      const sel = useDoc.getState().selection;
                      useDoc.getState().select({
                        entities: [],
                        connections: ev.shiftKey ? [...new Set([...sel.connections, i])] : [i],
                      });
                    }}
                  />
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
                    (g?.kind === 'link' && (g.keyboard || g.from === e.id || g.target?.id === e.id));
                  if (!box || !visible) return null;
                  return (
                    <ConnectionPorts
                      key={e.id}
                      id={e.id}
                      box={box}
                      zoom={zoom}
                      target={g?.kind === 'link' && g.target?.id === e.id ? g.target.port : undefined}
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
                  if (ev.key === 'Escape') setEditing(null);
                  if (ev.key === 'Enter' && !ev.shiftKey) {
                    ev.preventDefault();
                    commitText();
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
